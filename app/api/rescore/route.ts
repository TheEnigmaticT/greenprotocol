import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreProtocol, batchConvert, isServiceAvailable } from '@/lib/chemistry-service'
import { AnalysisResult } from '@/lib/types'

export async function POST(request: Request) {
  // Auth check
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serviceUp = await isServiceAvailable()
  if (!serviceUp) {
    return NextResponse.json({ error: 'Chemistry service unavailable' }, { status: 503 })
  }

  let analysis: AnalysisResult
  try {
    const body = await request.json()
    analysis = body.analysis
    if (!analysis?.steps || !analysis?.recommendations) {
      return NextResponse.json({ error: 'Invalid analysis data' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Build the chemical list with accepted swaps applied
  const accepted = analysis.recommendations.filter(r => r.isAccepted === true)
  const swapMap = new Map<string, string>() // step + original → alternative chemical name
  for (const rec of accepted) {
    swapMap.set(`${rec.stepNumber}:${rec.original.chemical.toLowerCase()}`, rec.alternative.chemical)
  }

  // Collect all chemicals, applying swaps
  const allChemicals: Array<{ name: string; quantity: string }> = []
  for (const step of analysis.steps) {
    for (const chem of step.chemicals) {
      const swappedName = swapMap.get(`${step.stepNumber}:${chem.name.toLowerCase()}`) || chem.name
      allChemicals.push({ name: swappedName, quantity: chem.quantity || '' })
    }
  }

  // Batch convert to get molecular data
  const batchResult = await batchConvert(allChemicals)

  // Build scoring payload
  const scoreChemicals = []
  let batchIdx = 0
  for (const step of analysis.steps) {
    for (const chem of step.chemicals) {
      const swappedName = swapMap.get(`${step.stepNumber}:${chem.name.toLowerCase()}`) || chem.name
      const conv = batchResult?.results?.[batchIdx]
      scoreChemicals.push({
        name: swappedName,
        role: chem.role,
        quantity_g: conv?.quantity_g ?? (chem.quantityKg ? chem.quantityKg * 1000 : null),
        quantity_kg: conv?.quantity_kg ?? chem.quantityKg,
        quantity_mol: conv?.quantity_mol ?? null,
        molecular_weight: conv?.molecular_weight ?? null,
        step_number: step.stepNumber,
      })
      batchIdx++
    }
  }

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
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 })
  }

  return NextResponse.json(scoreResult)
}
