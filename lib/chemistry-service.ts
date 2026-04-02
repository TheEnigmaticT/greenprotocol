/**
 * Client for the chemistry microservice (services/chemistry/).
 * Handles unit conversions and deterministic scoring.
 */

const CHEMISTRY_SERVICE_URL = process.env.CHEMISTRY_SERVICE_URL || 'http://localhost:8000'
const TIMEOUT_MS = 90_000

interface ConvertResult {
  chemical_name: string
  smiles: string | null
  molecular_formula: string | null
  molecular_weight: number | null
  density_g_per_ml: number | null
  quantity_g: number | null
  quantity_kg: number | null
  quantity_mol: number | null
  data_source: string
  cached: boolean
  warnings: string[]
  error: string | null
}

interface BatchResult {
  results: ConvertResult[]
}

interface ScoreResult {
  scores: Array<{
    principle_number: number
    principle_name: string
    score: number
    max_score: number
    normalized: number
    details: Record<string, unknown>
    chemicals_flagged: string[]
    data_sources: string[]
    confidence: 'calculated' | 'benchmark' | 'estimated' | 'partial' | 'unavailable'
  }>
  total_score: number
  max_possible: number
  grade: string
  smiles_extraction: Record<string, unknown>
  yield_extraction: Record<string, unknown>
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal })
    return resp
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Check if the chemistry service is reachable.
 */
export async function isServiceAvailable(): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${CHEMISTRY_SERVICE_URL}/health`, { method: 'GET' })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Batch convert all chemicals to standardized units (g, kg, mol).
 */
export async function batchConvert(
  chemicals: Array<{ name: string; quantity: string }>
): Promise<BatchResult | null> {
  try {
    const resp = await fetchWithTimeout(`${CHEMISTRY_SERVICE_URL}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chemicals: chemicals.map(c => ({
        chemical_name: c.name,
        quantity: c.quantity,
      })) }),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    console.error('[chemistry-service] batch convert failed:', err)
    return null
  }
}

/**
 * Score a protocol against all 12 Green Chemistry Principles.
 */
export async function scoreProtocol(params: {
  chemicals: Array<{
    name: string
    role: string
    quantity_g?: number | null
    quantity_kg?: number | null
    quantity_mol?: number | null
    molecular_weight?: number | null
    step_number?: number
  }>
  steps: Array<Record<string, unknown>>
  protocol_text: string
  reaction_smiles?: string
}): Promise<ScoreResult | null> {
  try {
    const resp = await fetchWithTimeout(`${CHEMISTRY_SERVICE_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    console.error('[chemistry-service] score failed:', err)
    return null
  }
}

export type { ConvertResult, BatchResult, ScoreResult }
