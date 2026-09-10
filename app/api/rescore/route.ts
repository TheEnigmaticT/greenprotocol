import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { scoreProtocol, batchConvert, isServiceAvailable } from '@/lib/chemistry-service'
import { AnalysisResult } from '@/lib/types'
import { isEvidenceEligibleChemicalSwap } from '@/lib/recommendation-kind'

function identity(value: string | undefined): string {
  return (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

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

  // The current recommendation contract does not carry a validated replacement
  // quantity. Do not reuse original mass/volume to invent a swap scenario.
  const applicableSwaps = analysis.recommendations.filter(
    recommendation => recommendation.isAccepted === true && isEvidenceEligibleChemicalSwap(recommendation),
  )
  if (applicableSwaps.length) {
    return NextResponse.json(
      { error: 'Replacement scenario quantities are required before rescoring' },
      { status: 422 },
    )
  }

  // Baseline rescoring retains the submitted protocol verbatim. Unsupported
  // hypotheses and non-substitution tips must never change its inventory.
  const allChemicals: Array<{ name: string; quantity: string; requestId: string }> = []
  for (const step of analysis.steps) {
    for (const [chemicalIndex, chem] of step.chemicals.entries()) {
      allChemicals.push({ name: chem.name, quantity: chem.quantity || '', requestId: `${step.stepNumber}:${chemicalIndex}` })
    }
  }

  // Batch convert to get molecular data
  const batchResult = await batchConvert(allChemicals)

  const conversionsByRequestId = new Map(
    (batchResult?.results || [])
      .filter(conversion => Boolean(conversion.request_id))
      .map(conversion => [conversion.request_id!, conversion]),
  )
  const legacyConversionsByIdentity = new Map<string, NonNullable<typeof batchResult>['results']>()
  for (const conversion of batchResult?.results || []) {
    if (conversion.request_id) continue
    const key = identity(conversion.chemical_name)
    if (!key) continue
    const queue = legacyConversionsByIdentity.get(key) || []
    queue.push(conversion)
    legacyConversionsByIdentity.set(key, queue)
  }

  // Build scoring payload. The id is an occurrence association, so reordered
  // aliases and duplicate materials cannot inherit a neighbor's quantity.
  const scoreChemicals = []
  for (const step of analysis.steps) {
    for (const [chemicalIndex, chem] of step.chemicals.entries()) {
      const requestId = `${step.stepNumber}:${chemicalIndex}`
      const identified = conversionsByRequestId.get(requestId)
      const conv = identified && identity(identified.requested_chemical_name) === identity(chem.name)
        ? identified
        : legacyConversionsByIdentity.get(identity(chem.name))?.shift()
      scoreChemicals.push({
        name: chem.name,
        role: chem.role,
        quantity_g: conv?.quantity_g ?? (chem.quantityKg ? chem.quantityKg * 1000 : null),
        quantity_kg: conv?.quantity_kg ?? chem.quantityKg,
        quantity_mol: conv?.quantity_mol ?? null,
        molecular_weight: conv?.molecular_weight ?? null,
        step_number: step.stepNumber,
      })
    }
  }

  // LLM-assisted scorers receive the same unmodified baseline inventory.
  let protocolText = ''
  for (const step of analysis.steps) {
    const chems = step.chemicals.map(c => c.name).join(', ')
    protocolText += `Step ${step.stepNumber}: ${step.description} [${chems}]\n`
  }

  const scoreResult = await scoreProtocol({
    chemicals: scoreChemicals,
    steps: analysis.steps.map(s => ({
      stepNumber: s.stepNumber,
      description: s.description,
      chemicals: s.chemicals.map(c => ({
        name: c.name,
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
