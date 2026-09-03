import { createHash } from 'node:crypto'
import type {
  AnalysisResult,
  ChemistryDataStatus,
  DeterministicScores,
  EnrichedChemical,
  WasteAnalysis,
} from '@/lib/types'

/**
 * The protocol text is normalized only for presentation-only whitespace so that
 * re-submitting the same procedure does not trigger fresh model extraction.
 * Material edits intentionally produce a new fingerprint and a new snapshot.
 */
export function normalizeProtocolForFingerprint(protocolText: string): string {
  return protocolText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

export async function protocolFingerprint(protocolText: string): Promise<string> {
  return createHash('sha256')
    .update(normalizeProtocolForFingerprint(protocolText), 'utf8')
    .digest('hex')
}

export interface CanonicalScoringSnapshot {
  protocolFingerprint: string
  deterministicScores: DeterministicScores
  enrichedChemicals?: EnrichedChemical[]
  wasteAnalysis?: WasteAnalysis
  chemistryDataStatus: ChemistryDataStatus
}

function isComplete(analysis: AnalysisResult): analysis is AnalysisResult & {
  deterministicScores: DeterministicScores
  chemistryDataStatus: ChemistryDataStatus
} {
  return Boolean(
    analysis.deterministicScores
    && analysis.chemistryDataStatus
    && analysis.chemistryDataStatus.deterministicScoringAvailable
    && !analysis.chemistryDataStatus.pending
    && analysis.chemistryDataStatus.unresolvedChemicals.length === 0,
  )
}

export async function buildCanonicalScoringSnapshot(
  protocolText: string,
  analysis: AnalysisResult,
): Promise<CanonicalScoringSnapshot | null> {
  if (!isComplete(analysis)) return null

  return {
    protocolFingerprint: await protocolFingerprint(protocolText),
    deterministicScores: analysis.deterministicScores,
    enrichedChemicals: analysis.enrichedChemicals,
    wasteAnalysis: analysis.wasteAnalysis,
    chemistryDataStatus: analysis.chemistryDataStatus,
  }
}

export function shouldReuseStoredDeterministicScores(analysis: AnalysisResult): boolean {
  return Boolean(
    isComplete(analysis)
    && !analysis.recommendations.some(recommendation => recommendation.isAccepted),
  )
}

export async function shouldReuseCanonicalScoring(
  protocolText: string,
  snapshot: CanonicalScoringSnapshot | null | undefined,
): Promise<boolean> {
  if (!snapshot) return false
  return snapshot.protocolFingerprint === await protocolFingerprint(protocolText)
}
