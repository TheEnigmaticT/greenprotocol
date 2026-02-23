import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { GREEN_CHEMISTRY_SYSTEM_PROMPT } from '@/lib/prompts'
import { findChemical } from '@/lib/chemicals'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { AnalysisResult, ImpactDelta } from '@/lib/types'

const anthropic = new Anthropic()

export async function POST(request: Request) {
  // Auth check
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

  try {
    // Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: GREEN_CHEMISTRY_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: protocolText }
      ],
    })

    let responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    // Extract JSON from Claude's response, handling markdown fences and surrounding text
    responseText = extractJson(responseText)

    // Parse JSON response
    let analysisResult: AnalysisResult & { error?: string; message?: string }
    try {
      analysisResult = JSON.parse(responseText)
    } catch {
      console.error('Failed to parse Claude response:', responseText.slice(0, 500))
      return NextResponse.json(
        { error: `Failed to parse analysis response. Claude returned non-JSON: "${responseText.slice(0, 200)}..."` },
        { status: 500 }
      )
    }

    // Check if Claude said it's not chemistry
    if (analysisResult.error === 'not_chemistry') {
      return NextResponse.json({ error: 'not_chemistry', message: analysisResult.message }, { status: 400 })
    }

    // Enrich chemicals with hardcoded data
    for (const step of analysisResult.steps) {
      for (const chem of step.chemicals) {
        const data = findChemical(chem.name)
        if (data) {
          // Estimate quantities in kg if we have mL and density
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

    // Log impact calculation for debugging
    console.log('Impact delta:', JSON.stringify(impactDelta))
    console.log('Recommendations matched:', analysisResult.recommendations.map(r => ({
      original: r.original.chemical,
      foundInDb: !!findChemical(r.original.chemical),
      alt: r.alternative.chemical,
      altFoundInDb: !!findChemical(r.alternative.chemical),
    })))

    return NextResponse.json({
      id: insertedRow?.id,
      analysis: analysisResult,
      impactDelta,
      equivalencies,
    })
  } catch (err: unknown) {
    console.error('Analysis error:', err)

    // Surface specific error details
    const error = err as { status?: number; message?: string; error?: { message?: string } }

    if (error.status === 401 || error.message?.includes('authentication') || error.message?.includes('API key')) {
      return NextResponse.json(
        { error: 'Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY environment variable.' },
        { status: 500 }
      )
    }

    if (error.status === 429) {
      return NextResponse.json(
        { error: 'Rate limited by Claude API. Please wait a moment and try again.' },
        { status: 429 }
      )
    }

    if (error.status === 400) {
      return NextResponse.json(
        { error: `Claude API rejected the request: ${error.message || 'unknown reason'}` },
        { status: 500 }
      )
    }

    const msg = error.message || error.error?.message || 'Unknown error'
    return NextResponse.json(
      { error: `Analysis failed: ${msg}` },
      { status: 500 }
    )
  }
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

    // Estimate quantity from steps — use fuzzy matching since Claude may
    // name chemicals differently in recommendations vs steps
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

    if (quantityKg === 0) quantityKg = 0.1 // fallback

    // CO2e savings
    const originalCo2e = quantityKg * originalData.co2ePerKg
    const altCo2e = altData ? quantityKg * altData.co2ePerKg : 0
    co2eSavedKg += originalCo2e - altCo2e

    // Water savings
    const originalWater = quantityKg * originalData.waterPerKg
    const altWater = altData ? quantityKg * altData.waterPerKg : 0
    waterSavedL += originalWater - altWater

    // Energy savings
    const originalEnergy = quantityKg * originalData.energyPerKg
    const altEnergy = altData ? quantityKg * altData.energyPerKg : 0
    energySavedKwh += originalEnergy - altEnergy

    // Hazardous waste
    if (originalData.isHazardousWaste) {
      hazardousWasteEliminatedKg += quantityKg
    }

    // Carcinogens
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

function extractJson(text: string): string {
  // Try 1: Already valid JSON
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return trimmed

  // Try 2: Strip markdown code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Try 3: Find the first { and last } — extract the JSON object
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  // Give up, return as-is and let the JSON.parse error handler deal with it
  return trimmed
}
