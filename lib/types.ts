export interface ChemicalData {
  cas: string
  name: string
  synonyms: string[]
  molecularWeight: number
  densityKgPerL: number
  co2ePerKg: number
  waterPerKg: number
  energyPerKg: number
  ghsHazards: string[]
  isSuspectedCarcinogen: boolean
  isHazardousWaste: boolean
  chem21Class: 'recommended' | 'problematic' | 'hazardous' | 'highly_hazardous'
  greenAlternatives: GreenAlternative[]
  dataSource: string
}

export interface GreenAlternative {
  chemical: string
  context: string
  yieldImpact: string
  source: string
}

export interface AnalysisStep {
  stepNumber: number
  description: string
  chemicals: ParsedChemical[]
  conditions: {
    temperature: string | null
    duration: string | null
    atmosphere: string | null
  }
}

export interface ParsedChemical {
  name: string
  role: string
  quantity: string
  quantityMl: number | null
  quantityKg: number | null
}

export interface Recommendation {
  stepNumber: number
  principleNumbers: number[]
  principleNames: string[]
  severity: 'high' | 'medium' | 'low'
  original: {
    chemical: string
    issue: string
  }
  alternative: {
    chemical: string
    rationale: string
    yieldImpact: string
    caveats: string
    evidenceBasis: string
  }
  confidenceLevel: 'high' | 'medium' | 'low'
  isAccepted?: boolean
}

export interface AnalysisResult {
  protocolTitle: string
  chemistrySubdomain: string
  steps: AnalysisStep[]
  recommendations: Recommendation[]
  revisedProtocol: string
  overallAssessment: {
    greenPrinciplesViolated: number[]
    mostImpactfulChange: string
    experimentalValidationNeeded: boolean
    disclaimer: string
  }
  // v2: deterministic scoring (optional for backward compat)
  deterministicScores?: DeterministicScores
  enrichedChemicals?: EnrichedChemical[]
  chemistryDataStatus?: ChemistryDataStatus
}

export interface ImpactDelta {
  co2eSavedKg: number
  hazardousWasteEliminatedKg: number
  carcinogensEliminated: string[]
  waterSavedL: number
  energySavedKwh: number
}

export interface Equivalency {
  icon: string
  value: string
  description: string
}

export interface GpcProfile {
  id: string
  user_id: string
  username: string
  display_name: string | null
  created_at: string
}

export interface AnalysisSummary {
  id: string
  protocol_text: string
  analysis_result: {
    protocolTitle: string
    chemistrySubdomain: string
    recommendations: Recommendation[]
  }
  impact_delta: ImpactDelta
  created_at: string
}

// SSE progress events streamed during analysis
export type ProgressEvent =
  | { type: 'phase'; phase: 1 | 2 | 3 | 4 | 5; message: string }
  | { type: 'principle'; number: number; name: string; status: 'evaluating' | 'complete' | 'failed'; recommendations?: number }
  | { type: 'score'; principle: number; name: string; score: number; confidence: string }
  | { type: 'result'; data: { id?: string; analysis: AnalysisResult; impactDelta: ImpactDelta; equivalencies: Equivalency[] } }
  | { type: 'error'; error: string; code?: string }

// ─── Deterministic Scoring Types ─────────────────────────────────

export interface PrincipleScore {
  principle_number: number
  principle_name: string
  score: number          // 0-10, or -1 if unavailable
  max_score: number
  normalized: number     // 0-1, or -1
  details: Record<string, unknown>
  chemicals_flagged: string[]
  data_sources: string[]
  confidence: 'calculated' | 'benchmark' | 'estimated' | 'partial' | 'unavailable'
  compatibility_warnings?: string[]
}

export interface DeterministicScores {
  scores: PrincipleScore[]
  total_score: number
  max_possible: number
  dozn_equivalent_score?: number // 0-100 scale for Merck/Sigma-Aldrich calibration
  grade: string
  smiles_extraction: Record<string, unknown>
  yield_extraction: Record<string, unknown>
}

export interface EnrichedChemical extends ParsedChemical {
  molecular_weight?: number
  density_g_per_ml?: number
  smiles?: string
  molecular_formula?: string
  data_source?: string
}

export interface ChemistryDataStatus {
  pending: boolean
  unresolvedChemicals: string[]
  message: string
}

export interface CumulativeImpact {
  totalAnalyses: number
  co2eSavedKg: number
  hazardousWasteEliminatedKg: number
  carcinogensEliminated: string[]
  waterSavedL: number
  energySavedKwh: number
}
