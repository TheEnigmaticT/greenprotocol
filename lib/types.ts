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

export interface Evidence {
  why_flagged: {
    source: string
    content: string
  }[]
  why_replacement: {
    chemical: string
    source: string
    content: string
  }[]
  citations: Citation[]
  // v0.6: optional SDS-backed context (scoring uses GHS/PubChem, not SDS)
  sdsReferences?: SdsReference[]
  sdsNotes?: SdsNote[]
}

export interface Citation {
  source_id: string
  source_name: string
  citation: string
  url?: string
  doi?: string
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
  evidence?: Evidence
  confidenceLevel: 'high' | 'medium' | 'low'
  isAccepted?: boolean
  // v0.6: waste + citability
  primaryBenefit?: string
  secondaryBenefits?: string[]
  wasteDelta?: Record<string, unknown>
  citationMetadata?: RecommendationCitationMetadata
  evidenceTier?: 'sourced' | 'inferred'
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
    processComplexity?: {
      score: number
      metrics: {
        transfer_count: number
        vessel_count: number
        prep_count: number
        purification_count: number
        step_count: number
      }
      level: string
    }
  }
  // v2: deterministic scoring (optional for backward compat)
  deterministicScores?: DeterministicScores
  enrichedChemicals?: EnrichedChemical[]
  chemistryDataStatus?: ChemistryDataStatus
  // v0.6: waste analysis + citability
  analysisMetadata?: AnalysisMetadata
  wasteAnalysis?: WasteAnalysis
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
  ghs_hazards?: { code: string; description: string; source: string }[]
  green_alternatives?: { chemical: string; source: string; content: string }[]
  citations?: Citation[]
  data_source?: string
}

export interface ChemistryDataStatus {
  pending: boolean
  unresolvedChemicals: string[]
  message: string
}

// ─── v0.6: Waste Analysis & Citability Types ─────────────────────

export interface AnalysisMetadata {
  generatedAt: string
  gcaiVersion: string
  methodologyVersion: string
}

export interface WasteSummary {
  wasteImpactScore: number    // 0-10
  grade: string               // A-F
  primaryDriver: string       // one-sentence explanation
  bestNextAction?: string
  confidence: 'calculated' | 'partial' | 'estimated'
}

export interface HazardBucket {
  category: string            // toxic, cmr, flammable, corrosive, environmental
  totalKg: number
  chemicalsCount: number
  chemicals: string[]
}

export interface WasteAnalysis {
  summary: WasteSummary
  directWaste: {
    totalWasteKg: number
    solventWasteKg: number
    nonSolventWasteKg: number
  }
  hazardSegments: HazardBucket[]
  liquidBurden: {
    totalLiquidHandledKg: number
    totalLiquidDiscardedKg: number
  }
  processBurden: {
    transferCount: number
    vesselCount: number
    purificationCount: number
    washStepCount: number
    workflowComplexity: number
  }
  upstream: {
    lcaAvailable: boolean
    notes: string
  }
  evidenceSources: string[]
  regulatoryContext?: RegulatoryContext
}

// US RCRA regulatory-context evidence layer. Compliance context, NOT a scoring
// input and not legal advice. See services/chemistry/scoring/rcra.py.
export interface RcraSignal {
  code: string                 // e.g. "U044", "D022", "D001"
  type:
    | 'listed_acute'
    | 'listed_toxic'
    | 'characteristic_toxicity'
    | 'characteristic_ignitability'
    | 'characteristic_corrosivity'
    | 'characteristic_reactivity'
  label: string
  basis: string
  regulatoryLevel?: string | null   // TCLP level, e.g. "6.0 mg/L"
}

export interface RegulatoryChemical {
  chemical: string
  cas?: string | null
  signals: RcraSignal[]
}

export interface RegulatoryContext {
  framework: string
  disclaimer: string
  coverageComplete: boolean
  chemicalsScreened: number
  chemicalsWithSignals: number
  distinctCodes: string[]
  chemicals: RegulatoryChemical[]
}

export interface SdsReference {
  supplier: string           // e.g. "Sigma-Aldrich", "TCI"
  productNumber?: string
  url?: string
  retrievedAt?: string
}

export interface SdsNote {
  section: string            // e.g. "Handling", "Disposal", "First Aid"
  content: string
  source: string
}

export interface RecommendationCitationMetadata {
  gcaiVersion: string
  analysisId?: string
  generatedAt: string
}

export interface CumulativeImpact {
  totalAnalyses: number
  co2eSavedKg: number
  hazardousWasteEliminatedKg: number
  carcinogensEliminated: string[]
  waterSavedL: number
  energySavedKwh: number
}
