import { runAnalysis, type RunAnalysisOutcome } from '@/lib/run-analysis'

type Completed = Extract<RunAnalysisOutcome, { kind: 'completed' }>

export const RERUN_INTERRUPTED_MESSAGE =
  "We lost the connection while the new analysis was running. It may still be running, so check your dashboard before trying again. Otherwise you could use another analysis run."

/** Hand-off the analysis page reads on arrival, so the new result shows without another fetch. */
export function stashCompletedAnalysis(outcome: Completed, storage: Pick<Storage, 'setItem'>): void {
  storage.setItem('gpc_analysis', JSON.stringify({
    id: outcome.analysisId,
    analysis: outcome.analysis,
    impactDelta: outcome.impactDelta,
    equivalencies: outcome.equivalencies,
    protocolText: outcome.protocolText,
  }))
  storage.setItem('gpc_protocol', outcome.protocolText)
}

/**
 * Runs the scientist-approved edited procedure as a NEW analysis (one analysis run). The original analysis
 * is never changed. Throws an Error whose message is already plain language, for the chat proposal card.
 */
export async function rerunFromProposal({ proposedText, navigate, storage }: {
  proposedText: string
  navigate: (href: string) => void
  storage: Pick<Storage, 'setItem'>
}): Promise<void> {
  const outcome = await runAnalysis({ protocolText: proposedText })
  if (outcome.kind === 'unauthorized') {
    navigate('/login')
    return
  }
  if (outcome.kind === 'failed') throw new Error(`${outcome.error.title}. ${outcome.error.message}`)
  if (outcome.kind === 'interrupted') throw new Error(RERUN_INTERRUPTED_MESSAGE)
  stashCompletedAnalysis(outcome, storage)
  navigate(`/analyze/${outcome.analysisId}`)
}
