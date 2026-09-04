import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { findChemical } from '@/lib/chemicals'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { AnalysisResult, ImpactDelta, ProgressEvent } from '@/lib/types'
import { analyzeProtocol, NotChemistryError } from '@/lib/pipeline'
import { getAnalysisMetadata } from '@/lib/version'
import { buildCanonicalScoringSnapshot, protocolFingerprint } from '@/lib/scoring-snapshot'
import { notifyAnalysis } from '@/lib/operational-alerts'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 300

const DEFAULT_RUN_LIMIT = parseInt(process.env.ANALYSIS_RUN_LIMIT || '10', 10)
const UNLIMITED_ANALYSIS_EMAILS = new Set([
  'trevor.longino+gc1@gmail.com',
  'alana@concannon.ie',
])

function hasUnlimitedAnalyses(email?: string): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return UNLIMITED_ANALYSIS_EMAILS.has(normalized) || normalized.endsWith('@greenchemistry.ai')
}

function isSentinelRequest(request: Request): boolean {
  const key = process.env.SENTINEL_ANALYSIS_KEY
  return Boolean(key) && request.headers.get('x-gcai-sentinel-key') === key
}

async function countProtocolTokens(protocolText: string): Promise<number | null> {
  try {
    const result = await new Anthropic().messages.countTokens({
      model: 'claude-sonnet-4-5-20250929',
      messages: [{ role: 'user', content: protocolText }],
    })
    return result.input_tokens
  } catch (error) {
    console.error('[analyze] protocol token count failed:', error)
    return null
  }
}

export async function POST(request: Request) {
  // Auth check (must happen before streaming — can't send status codes mid-stream)
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!hasUnlimitedAnalyses(user.email)) {
    // Usage limit check — count existing analyses for this user
    const { count, error: countError } = await supabase
      .from('gpc_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (countError) {
      return NextResponse.json({ error: 'Failed to check usage limits' }, { status: 500 })
    }

    if (count !== null && count >= DEFAULT_RUN_LIMIT) {
      return NextResponse.json({
        error: 'run_limit_reached',
        message: `You've reached your analysis limit of ${DEFAULT_RUN_LIMIT} runs. Contact us to get more.`,
        current: count,
        limit: DEFAULT_RUN_LIMIT,
      }, { status: 429 })
    }
  }

  // Parse request
  let protocolText: string
  try {
    const body = await request.json()
    protocolText = body.protocolText
    if (!protocolText || typeof protocolText !== 'string' || protocolText.trim().length < 20) {
      return NextResponse.json({ error: 'Protocol text is required (minimum 20 characters)' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const protocolFingerprintValue = await protocolFingerprint(protocolText)
  const protocolInputTokens = await countProtocolTokens(protocolText)
  const runSource = isSentinelRequest(request) ? 'sentinel' : 'human'

  const { data: analysisRun, error: analysisRunError } = await supabase
    .from('gpc_analysis_runs')
    .insert({
      user_id: user.id,
      status: 'running',
      run_source: runSource,
      protocol_input_tokens: protocolInputTokens,
    })
    .select('id')
    .single()

  if (analysisRunError || !analysisRun?.id) {
    return NextResponse.json({ error: 'Failed to create analysis audit run' }, { status: 500 })
  }

  // Stream SSE events via ReadableStream — controller.enqueue() is synchronous,
  // avoiding the race condition where TransformStream writer.close() can beat
  // un-awaited writer.write() calls.
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController

  const stream = new ReadableStream({
    start(c) { controller = c },
  })

  const t0 = Date.now()
  function elapsed() { return ((Date.now() - t0) / 1000).toFixed(1) }

  // Send SSE heartbeat every 5s to prevent Vercel from killing idle streams
  const heartbeat = setInterval(() => {
    try {
      controller.enqueue(encoder.encode(`: heartbeat ${elapsed()}s\n\n`))
    } catch {
      clearInterval(heartbeat)
    }
  }, 5000)

  function send(event: ProgressEvent) {
    try {
      console.log(`[SSE ${elapsed()}s] sending ${event.type}${event.type === 'principle' ? ` #${event.number} ${event.status}` : ''}`)
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch (err) {
      console.error(`[SSE ${elapsed()}s] enqueue failed:`, err)
    }
  }

  // Run pipeline in background, streaming progress
  const pipeline = (async () => {
    let analysisRunCompleted = false
    let analysisName: string | null = null
    let analysisId: string | null = null
    const pipelineErrors: string[] = []
    try {
      console.log(`[pipeline ${elapsed()}s] starting analyzeProtocol`)
      const analysisResult = await analyzeProtocol(protocolText, send, {
        userId: user.id,
        analysisRunId: analysisRun.id,
        supabase,
      })
      console.log(`[pipeline ${elapsed()}s] analyzeProtocol complete`)
      analysisName = analysisResult.protocolTitle || null

      // Enrich chemicals with hardcoded data
      for (const step of analysisResult.steps) {
        for (const chem of step.chemicals) {
          const data = findChemical(chem.name)
          if (data) {
            if (chem.quantityMl && !chem.quantityKg) {
              chem.quantityKg = (chem.quantityMl / 1000) * data.densityKgPerL
            }
          }
        }
      }

      // Calculate impact delta
      const impactDelta = calculateImpactDelta(analysisResult)

      // Generate equivalencies
      const equivalencies = calculateEquivalencies(impactDelta)

      // Stamp version metadata
      analysisResult.analysisMetadata = getAnalysisMetadata()

      // Store only complete scores. Incomplete chemistry data remains visible as
      // unavailable and is never promoted into a canonical repeatable snapshot.
      const canonicalSnapshot = await buildCanonicalScoringSnapshot(protocolText, analysisResult)
      if (canonicalSnapshot) {
        const { error: snapshotUpsertError } = await supabase
          .from('gpc_canonical_scoring_snapshots')
          .upsert({
            user_id: user.id,
            protocol_fingerprint: protocolFingerprintValue,
            snapshot: canonicalSnapshot,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id,protocol_fingerprint' })
        if (snapshotUpsertError) {
          console.error('[analyze] canonical scoring snapshot persistence failed:', snapshotUpsertError.message)
        }
      }

      // Save to database
      const { data: insertedRow, error: insertError } = await supabase.from('gpc_analyses').insert({
        user_id: user.id,
        protocol_text: protocolText,
        analysis_result: analysisResult,
        impact_delta: impactDelta,
      }).select('id').single()

      if (insertError || !insertedRow?.id) {
        throw new Error(insertError?.message || 'Failed to persist analysis')
      }
      analysisId = insertedRow.id

      const { error: analysisRunUpdateError } = await supabase
        .from('gpc_analysis_runs')
        .update({
          analysis_id: insertedRow.id,
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', analysisRun.id)
        .eq('user_id', user.id)

      if (analysisRunUpdateError) {
        throw new Error(`Failed to complete analysis audit run: ${analysisRunUpdateError.message}`)
      }

      analysisRunCompleted = true

      send({
        type: 'result',
        data: {
          id: insertedRow.id,
          analysis: analysisResult,
          impactDelta,
          equivalencies,
        },
      })
    } catch (err: unknown) {
      console.error(`[pipeline ${elapsed()}s] CAUGHT ERROR:`, err)

      if (err instanceof NotChemistryError) {
        pipelineErrors.push(err.message)
        send({ type: 'error', error: err.message, code: 'not_chemistry' })
        return
      }

      const error = err as { status?: number; message?: string; error?: { message?: string } }

      if (error.status === 401 || error.message?.includes('authentication') || error.message?.includes('API key')) {
        pipelineErrors.push('Anthropic API key is missing or invalid.')
        send({ type: 'error', error: 'Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY environment variable.' })
        return
      }

      if (error.status === 429) {
        send({ type: 'error', error: 'Rate limited by Claude API. Please wait a moment and try again.' })
        return
      }

      const msg = error.message || error.error?.message || 'Unknown error'
      pipelineErrors.push(msg)
      send({ type: 'error', error: `Analysis failed: ${msg}` })
    } finally {
      if (!analysisRunCompleted) {
        await supabase
          .from('gpc_analysis_runs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', analysisRun.id)
          .eq('user_id', user.id)
      }
      if (runSource === 'human') {
        const { data: traces, error: tracesError } = await supabase
          .from('gpc_analysis_traces')
          .select('output_tokens, error_message')
          .eq('analysis_run_id', analysisRun.id)
        if (tracesError) pipelineErrors.push(`Trace lookup failed: ${tracesError.message}`)
        for (const trace of traces || []) {
          if (trace.error_message) pipelineErrors.push(trace.error_message)
        }
        await notifyAnalysis({
          status: analysisRunCompleted ? 'completed' : 'failed',
          analysisName,
          analysisId,
          analysisRunId: analysisRun.id,
          userEmail: user.email || null,
          protocolInputTokens,
          processingMilliseconds: Date.now() - t0,
          generatedOutputTokens: (traces || []).reduce((total, trace) => total + (trace.output_tokens || 0), 0),
          errorMessages: [...new Set(pipelineErrors)],
        })
      }
      clearInterval(heartbeat)
      console.log(`[pipeline ${elapsed()}s] closing stream`)
      try { controller.close() } catch { /* already closed */ }
    }
  })()

  // Don't await — the response streams while the pipeline runs
  void pipeline

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

function calculateImpactDelta(result: AnalysisResult): ImpactDelta {
  let co2eSavedKg = 0
  let hazardousWasteEliminatedKg = 0
  const carcinogensEliminated: string[] = []
  let waterSavedL = 0
  let energySavedKwh = 0

  for (const rec of result.recommendations) {
    const originalData = findChemical(rec.original.chemical)
    const altData = findChemical(rec.alternative.chemical)

    if (!originalData) continue

    let quantityKg = 0
    const recNameLower = rec.original.chemical.toLowerCase()
    for (const step of result.steps) {
      if (step.stepNumber === rec.stepNumber) {
        for (const chem of step.chemicals) {
          const chemLower = chem.name.toLowerCase()
          const isMatch =
            chemLower === recNameLower ||
            chemLower.includes(recNameLower) ||
            recNameLower.includes(chemLower) ||
            (originalData.synonyms.some(s => chemLower.includes(s.toLowerCase())))
          if (isMatch) {
            if (chem.quantityKg) {
              quantityKg = chem.quantityKg
            } else if (chem.quantityMl) {
              quantityKg = (chem.quantityMl / 1000) * originalData.densityKgPerL
            } else {
              quantityKg = chem.role === 'solvent' ? 0.5 : 0.1
            }
          }
        }
      }
    }

    if (quantityKg === 0) quantityKg = 0.1

    const originalCo2e = quantityKg * originalData.co2ePerKg
    const altCo2e = altData ? quantityKg * altData.co2ePerKg : 0
    co2eSavedKg += originalCo2e - altCo2e

    const originalWater = quantityKg * originalData.waterPerKg
    const altWater = altData ? quantityKg * altData.waterPerKg : 0
    waterSavedL += originalWater - altWater

    const originalEnergy = quantityKg * originalData.energyPerKg
    const altEnergy = altData ? quantityKg * altData.energyPerKg : 0
    energySavedKwh += originalEnergy - altEnergy

    if (originalData.isHazardousWaste) {
      hazardousWasteEliminatedKg += quantityKg
    }

    if (originalData.isSuspectedCarcinogen && !carcinogensEliminated.includes(originalData.name)) {
      carcinogensEliminated.push(originalData.name)
    }
  }

  return {
    co2eSavedKg: Math.max(0, co2eSavedKg),
    hazardousWasteEliminatedKg: Math.max(0, hazardousWasteEliminatedKg),
    carcinogensEliminated,
    waterSavedL: Math.max(0, waterSavedL),
    energySavedKwh: Math.max(0, energySavedKwh),
  }
}
