import type { AnalysisMetadata, LiteratureEvidenceMatch } from '@/lib/types'
import type { BenchmarkProvider } from './provider'

export interface BenchmarkFixtureCase {
  caseId: string
  protocolText: string
  frozenLiteratureMatches: LiteratureEvidenceMatch[]
  analysisMetadata: Readonly<AnalysisMetadata>
  expectedAnalysis?: unknown
}

export interface BenchmarkModel {
  model: string
  provider: BenchmarkProvider
}

export interface StructuralQuality {
  schemaValid: boolean
  stageCount: number
  failedStageCount: number
  principleCoverage: number
  recommendationCount: number
  flags: string[]
}

export interface BenchmarkRunRecord {
  caseId: string
  model: string
  repetition: number
  wallClockMs: number
  phaseLatencyMs: Record<string, number>
  costUsd?: number
  quality: StructuralQuality
}

export interface BenchmarkOutput {
  version: 1
  repetitions: number
  runs: BenchmarkRunRecord[]
}
