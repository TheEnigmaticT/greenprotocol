import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { findChemical } from '@/lib/chemicals'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { AnalysisResult, ImpactDelta, ProgressEvent } from '@/lib/types'
import { analyzeProtocol, NotChemistryError } from '@/lib/pipeline'

export const maxDuration = 120

export async function POST(request: Request) {
  // Auth check (must happen before streaming — can't send status codes mid-stream)
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // Stream SSE events via ReadableStream — controller.enqueue() is synchronous,
  // avoiding the race condition where TransformStream writer.close() can beat
  // un-awaited writer.write() calls.
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController

  const stream = new ReadableStream({
    start(c) { controller = c },
  })

  function send(event: ProgressEvent) {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    } catch {
      // Stream already closed (client disconnected) — ignore
    }
  }

  // Run pipeline in background, streaming progress
  const pipeline = (async () => {
    try {
      const analysisResult = await analyzeProtocol(protocolText, send)

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

      // Save to database
      const { data: insertedRow } = await supabase.from('gpc_analyses').insert({
        user_id: user.id,
        protocol_text: protocolText,
        analysis_result: analysisResult,
        impact_delta: impactDelta,
      }).select('id').single()

      send({
        type: 'result',
        data: {
          id: insertedRow?.id,
          analysis: analysisResult,
          impactDelta,
          equivalencies,
        },
      })
    } catch (err: unknown) {
      console.error('Analysis error:', err)

      if (err instanceof NotChemistryError) {
        send({ type: 'error', error: err.message, code: 'not_chemistry' })
        return
      }

      const error = err as { status?: number; message?: string; error?: { message?: string } }

      if (error.status === 401 || error.message?.includes('authentication') || error.message?.includes('API key')) {
        send({ type: 'error', error: 'Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY environment variable.' })
        return
      }

      if (error.status === 429) {
        send({ type: 'error', error: 'Rate limited by Claude API. Please wait a moment and try again.' })
        return
      }

      const msg = error.message || error.error?.message || 'Unknown error'
      send({ type: 'error', error: `Analysis failed: ${msg}` })
    } finally {
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
