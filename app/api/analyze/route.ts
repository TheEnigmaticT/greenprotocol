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
      model: 'claude-sonnet-4-5-20250514',
      max_tokens: 4096,
      system: GREEN_CHEMISTRY_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: protocolText }
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    // Parse JSON response
    let analysisResult: AnalysisResult & { error?: string; message?: string }
    try {
      analysisResult = JSON.parse(responseText)
    } catch {
      return NextResponse.json({ error: 'Failed to parse analysis response' }, { status: 500 })
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
    await supabase.from('gpc_analyses').insert({
      user_id: user.id,
      protocol_text: protocolText,
      analysis_result: analysisResult,
      impact_delta: impactDelta,
    })

    return NextResponse.json({
      analysis: analysisResult,
      impactDelta,
      equivalencies,
    })
  } catch (err) {
    console.error('Analysis error:', err)
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
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

    // Estimate quantity from steps
    let quantityKg = 0
    for (const step of result.steps) {
      if (step.stepNumber === rec.stepNumber) {
        for (const chem of step.chemicals) {
          if (chem.name.toLowerCase() === rec.original.chemical.toLowerCase()) {
            if (chem.quantityKg) {
              quantityKg = chem.quantityKg
            } else if (chem.quantityMl) {
              quantityKg = (chem.quantityMl / 1000) * originalData.densityKgPerL
            } else {
              // Default estimate: 0.1 kg for reagents, 0.5 kg for solvents
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
