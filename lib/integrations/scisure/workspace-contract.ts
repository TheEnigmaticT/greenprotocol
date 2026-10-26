import type { AnalysisResult, Recommendation } from '@/lib/types'
import type { SciSureSource } from './index'

/** Private review v2. V1 admission remains compatible; source is never public. */
export type SciSureWorkspaceDecision = 'accepted' | 'rejected'
export type SciSureWorkspaceFinding = {
  findingId: string
  recommendationIndex: number
  recommendation: Recommendation
  applicable: boolean
  decision: SciSureWorkspaceDecision | null
}
export type SciSureWorkspace = {
  version: 2
  bridgeSessionId: string
  snapshotId: string
  sourceHash: string
  runId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'uncertain'
  principalKind: 'registered' | 'guest'
  analysisId?: string
  analysisRevision: number
  source: SciSureSource
  analysis: AnalysisResult | null
  findings: SciSureWorkspaceFinding[]
  retentionExpiresAt: string
}
export type PreparedSciSureWriteback = {
  version: 2
  snapshotId: string
  sourceHash: string
  runId: string
  analysisRevision: number
  source: SciSureSource
  title: string
  draftText: string
  evidenceAppendixText: string
  privateAnalysisPath?: string
  privateEvidencePath?: string
  appliedFindingIds: string[]
  acknowledgedFindingIds: string[]
  limitations: string[]
  preparedAt: string
  bundleHash: string
}
export type SciSureWritebackResult = {
  version: 2
  type: 'scisure.gcai.writeback-result'
  nonce: string
  bridgeSessionId: string
  requestId: string
  status: 'saved' | 'conflict' | 'unsupported' | 'failed' | 'uncertain'
  targetId?: string
  targetKind?: 'experiment' | 'protocol'
  message: string
}
export const MAX_SCISURE_WRITEBACK_BYTES = 256 * 1024
