import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { aggregateClaimableImpact } from '@/lib/impact-inventory'
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
  const aggregate = aggregateClaimableImpact((analyses || []).map((row) => row.impact_delta as ImpactDelta))
  const cumulative: CumulativeImpact = {
    totalAnalyses: analyses?.length || 0,
    ...aggregate,
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
