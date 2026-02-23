import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { NextResponse } from 'next/server'
import { CumulativeImpact, ImpactDelta } from '@/lib/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params
  const admin = createAdminClient()

  // Get the profile
  const { data: profile, error: profileError } = await admin
    .from('gpc_profiles')
    .select('*')
    .eq('username', username)
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Get all analyses for this user
  const { data: analyses } = await admin
    .from('gpc_analyses')
    .select('impact_delta')
    .eq('user_id', profile.user_id)

  // Aggregate impact
  const cumulative: CumulativeImpact = {
    totalAnalyses: analyses?.length || 0,
    co2eSavedKg: 0,
    hazardousWasteEliminatedKg: 0,
    carcinogensEliminated: [],
    waterSavedL: 0,
    energySavedKwh: 0,
  }

  for (const row of analyses || []) {
    const d = row.impact_delta as ImpactDelta
    cumulative.co2eSavedKg += d.co2eSavedKg || 0
    cumulative.hazardousWasteEliminatedKg += d.hazardousWasteEliminatedKg || 0
    cumulative.waterSavedL += d.waterSavedL || 0
    cumulative.energySavedKwh += d.energySavedKwh || 0
    for (const c of d.carcinogensEliminated || []) {
      if (!cumulative.carcinogensEliminated.includes(c)) {
        cumulative.carcinogensEliminated.push(c)
      }
    }
  }

  const equivalencies = calculateEquivalencies({
    co2eSavedKg: cumulative.co2eSavedKg,
    hazardousWasteEliminatedKg: cumulative.hazardousWasteEliminatedKg,
    carcinogensEliminated: cumulative.carcinogensEliminated,
    waterSavedL: cumulative.waterSavedL,
    energySavedKwh: cumulative.energySavedKwh,
  })

  return NextResponse.json({
    profile,
    cumulative,
    equivalencies,
  })
}
