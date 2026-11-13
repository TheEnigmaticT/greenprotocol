import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreProtocol, batchConvert, isServiceAvailable } from '@/lib/chemistry-service'
import { AnalysisResult } from '@/lib/types'
import { prepareChemicalInputs } from '@/lib/chemical-inputs'
import { humanErrorPayload } from '@/lib/errors/humanize'

export async function POST(request: Request) {
  // Auth check
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json(humanErrorPayload('unauthorized'), { status: 401 })
  }

  const serviceUp = await isServiceAvailable()
  if (!serviceUp) {
    return NextResponse.json(humanErrorPayload('chemistry_service_unavailable'), { status: 503 })
  }

  let analysis: AnalysisResult
  try {
    const body = await request.json()
    analysis = body.analysis
    if (!analysis?.steps || !analysis?.recommendations) {
      return NextResponse.json(humanErrorPayload('invalid_analysis'), { status: 400 })
    }
  } catch {
    return NextResponse.json(humanErrorPayload('invalid_analysis'), { status: 400 })
  }

  // Build the chemical list with accepted swaps applied
  const accepted = analysis.recommendations.filter(r => r.isAccepted === true)
  const swapMap = new Map<string, string>() // step + original → alternative chemical name
  for (const rec of accepted) {
    swapMap.set(`${rec.stepNumber}:${rec.original.chemical.toLowerCase()}`, rec.alternative.chemical)
  }

  // Reuse the occurrence-aware conversion contract from initial analysis.
  // Fresh conversions, not client/model quantityKg values, are authoritative.
  const swappedSteps = analysis.steps.map(step => ({
    ...step,
    chemicals: step.chemicals.map(chemical => ({
      ...chemical,
      name: swapMap.get(`${step.stepNumber}:${chemical.name.toLowerCase()}`) || chemical.name,
    })),
  }))
  const allChemicals = swappedSteps.flatMap(step => step.chemicals.map(chemical => ({ name: chemical.name, quantity: chemical.quantity || '' })))
  const batchResult = await batchConvert(allChemicals)
  const { scoreChemicals } = prepareChemicalInputs(swappedSteps, batchResult)

  // Build protocol text with swaps for the LLM-based scorers
  let protocolText = ''
  for (const step of analysis.steps) {
    const chems = step.chemicals.map(c => {
      const swapped = swapMap.get(`${step.stepNumber}:${c.name.toLowerCase()}`)
      return swapped || c.name
    }).join(', ')
    protocolText += `Step ${step.stepNumber}: ${step.description} [${chems}]\n`
  }

  const scoreResult = await scoreProtocol({
    chemicals: scoreChemicals,
    steps: analysis.steps.map(s => ({
      stepNumber: s.stepNumber,
      description: s.description,
      chemicals: s.chemicals.map(c => ({
        name: swapMap.get(`${s.stepNumber}:${c.name.toLowerCase()}`) || c.name,
        role: c.role,
      })),
      conditions: s.conditions,
    })),
    protocol_text: protocolText,
  })

  if (!scoreResult) {
    return NextResponse.json(humanErrorPayload('scoring_failed'), { status: 500 })
  }

  return NextResponse.json(scoreResult)
}
