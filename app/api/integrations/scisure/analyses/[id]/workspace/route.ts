import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { workspaceFindings } from '@/lib/integrations/scisure/workspace'
import type { SciSureWorkspace, SciSureWorkspaceDecision } from '@/lib/integrations/scisure/workspace-contract'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
const unavailable = () => NextResponse.json({ error: 'Saved private workspace not found or retention expired.' }, { status: 404, headers })

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await createClient()
  const { data: { user }, error: authError } = await session.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Sign in as the saved analysis owner. SMTP guest recovery is deferred.' }, { status: 401, headers })
  const { id } = await context.params
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return unavailable()
  try {
    const { data, error } = await createAdminClient().rpc('gpc_get_owned_scisure_workspace' as never, { p_analysis_id: id, p_owner_user_id: user.id } as never)
    if (error || !data) return unavailable()
    const raw = data as unknown as SciSureWorkspace & { decisions: Record<string, SciSureWorkspaceDecision> }
    if (raw.version !== 2 || raw.analysisId !== id || raw.principalKind !== 'registered' || raw.status !== 'completed' || !raw.analysis || !Array.isArray(raw.analysis.recommendations) || !Array.isArray(raw.analysis.steps) || !raw.decisions || !Number.isFinite(Date.parse(raw.retentionExpiresAt)) || Date.parse(raw.retentionExpiresAt) <= Date.now()) return unavailable()
    const findings = workspaceFindings(raw.analysis, raw.decisions)
    const { decisions, ...workspace } = raw
    void decisions // Strip raw decision-map transport metadata from the public DTO.
    return NextResponse.json({ ...workspace, findings }, { headers })
  } catch {
    return unavailable()
  }
}
