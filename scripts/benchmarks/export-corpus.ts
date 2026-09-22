import { lstatSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

export const BENCHMARK_ROOT = resolve(process.cwd(), 'tmp/benchmarks')
const PROJECT_HOST = 'jjxvlofcnyiqrtvwccsq.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const TOKEN = /\b(?:sk|pk|eyJ)[A-Za-z0-9_.-]{12,}\b/g
const ID = /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi
const MIN_VIABLE_PROTOCOL_LENGTH = 20
const SENSITIVE_FIELD_NAMES = new Set([
  'prompt', 'prompttext', 'promptmetadata', 'response', 'responsetext', 'responsemetadata',
  'completion', 'completiontext', 'completionmetadata', 'traceid', 'requestid', 'requestmetadata',
  'message', 'messages', 'metadata', 'system', 'assistant', 'user', 'sourceid', 'sourcedocumentid',
  'authorization', 'xapikey', 'apikey', 'token', 'credential', 'secret', 'password',
])
const SENSITIVE_FIELD = /\b([a-z][a-z0-9]*(?:[\s_-]+[a-z0-9]+)*)\s*[:=]\s*(?:bearer\s+)?(?!\[REDACTED_SECRET\])[^\s,;]+/gi
const AUTHORIZATION_SCHEME = /(\bauthorization\s+(?:bearer|basic|token))(?:(?:\s*=\s*)+|\s+)[^\s,;.]+/gi
const AUTHORIZATION_FIELD = /\bauthorization(?:[\s_-]+[a-z0-9]+)*\s*[:=]\s*(?:bearer|basic|token)(?:(?:\s*=\s*)+|\s+)[^\s,;.]+/gi
const SENSITIVE_LINE_LABEL = /^\s*(?:[-*]\s*)?([a-z][a-z0-9]*(?:[\s_-]+[a-z0-9]+)*)\s*[:=]/i
const normalizeFieldName = (value: string): string => value.replace(/[\s_-]/g, '').toLowerCase()
const isSensitiveField = (value: string): boolean => {
  const normalized = normalizeFieldName(value)
  return SENSITIVE_FIELD_NAMES.has(normalized) || normalized.startsWith('authorization')
}

function redactSensitiveFields(line: string): string {
  return line.replace(SENSITIVE_FIELD, (match, field: string) => {
    const words = [...field.matchAll(/[a-z0-9]+/gi)]
    const sensitiveWord = words.findIndex((_, index) => isSensitiveField(words.slice(index).map(word => word[0]).join('')))
    return sensitiveWord < 0 ? match : `${field.slice(0, words[sensitiveWord].index)}[REDACTED_SECRET]`
  })
}

export interface BenchmarkAuth { key: string; kind: 'reader' | 'service-role' }
export function resolveBenchmarkAuth(args: string[], env: Record<string, string | undefined> = process.env): BenchmarkAuth {
  const service = args.includes('--service-role')
  if (service) {
    if (env.GCAI_BENCHMARK_ALLOW_SERVICE_ROLE !== '1') throw new Error('An explicit gate is required for service-role benchmark reads')
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Service-role credential is required')
    return { key: env.SUPABASE_SERVICE_ROLE_KEY, kind: 'service-role' }
  }
  if (!env.GCAI_BENCHMARK_READ_KEY) throw new Error('An allowed read credential is required')
  return { key: env.GCAI_BENCHMARK_READ_KEY, kind: 'reader' }
}

export function validateBenchmarkSupabaseUrl(value: string, options: { allowLoopback?: boolean } = {}): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Configured Supabase URL is invalid') }
  const loopback = options.allowLoopback && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  if (url.protocol !== 'https:' && !loopback) throw new Error('Configured Supabase URL must use HTTPS')
  if (url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/') throw new Error('Configured Supabase URL contains disallowed components')
  if (!loopback && url.hostname !== PROJECT_HOST) throw new Error('Configured Supabase URL has an unexpected host')
  return url.origin
}

function existingPathComponents(path: string): string[] {
  const components: string[] = []
  let current = resolve(path)
  while (current.startsWith(`${BENCHMARK_ROOT}/`) || current === BENCHMARK_ROOT) {
    try { lstatSync(current); components.push(current) } catch { /* not created yet */ }
    if (current === BENCHMARK_ROOT) break
    current = resolve(current, '..')
  }
  return components
}

export function assertBenchmarkPath(path: string): string {
  const target = resolve(path)
  if (target !== BENCHMARK_ROOT && !target.startsWith(`${BENCHMARK_ROOT}/`)) throw new Error('Benchmark artifact path is outside tmp/benchmarks')
  for (const component of existingPathComponents(target)) if (lstatSync(component).isSymbolicLink()) throw new Error('Benchmark artifact path contains a symlink')
  try {
    const realRoot = realpathSync(BENCHMARK_ROOT)
    const realParent = realpathSync(resolve(target, '..'))
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}/`)) throw new Error('Benchmark artifact path escapes benchmark root')
  } catch (error) {
    if (error instanceof Error && /escapes benchmark root/.test(error.message)) throw error
  }
  return target
}

export function parseExplicitFixtureIds(args: string[]): string[] {
  const ids = args.filter(arg => arg.length > 0 && !arg.startsWith('--'))
  if (ids.length === 0 || ids.some(id => !UUID.test(id))) throw new Error('Explicit fixture UUID IDs are required')
  return [...new Set(ids)]
}

function sanitizeProtocol(protocol: string): string {
  return protocol.split(/\r?\n/)
    .filter(line => {
      const label = line.match(SENSITIVE_LINE_LABEL)?.[1]
      return !label || !isSensitiveField(label)
    })
    .map(line => line.replace(AUTHORIZATION_FIELD, '[REDACTED_SECRET]'))
    .map(redactSensitiveFields)
    .join('\n')
    .replace(AUTHORIZATION_SCHEME, (_match, prefix: string) => `${prefix} [REDACTED_SECRET]`)
    .replace(EMAIL, '[REDACTED_EMAIL]').replace(ID, '[REDACTED_ID]').replace(TOKEN, '[REDACTED_TOKEN]')
    .replace(/\b(?:alice|bob|user|patient|subject)\b/gi, '[REDACTED_PERSON]').trim()
}

export function validateSanitizedProtocol(protocolText: unknown): asserts protocolText is string {
  if (typeof protocolText !== 'string' || protocolText.trim().length === 0) throw new Error('Benchmark fixture protocolText must be non-empty text')
  if (sanitizeProtocol(protocolText) !== protocolText) throw new Error('Benchmark fixture protocolText is not safely sanitized')
  if (protocolText.length < MIN_VIABLE_PROTOCOL_LENGTH) throw new Error('Benchmark fixture protocolText is not viable after safety redaction')
}


export function sanitizeCorpusRecord(record: { protocol_text: string; analysis_result: unknown }): Pick<BenchmarkFixtureArtifact, 'protocolText' | 'frozenLiteratureMatches' | 'analysisMetadata'> {
  if (typeof record.protocol_text !== 'string') throw new Error('Corpus protocol must be text')
  const protocolText = sanitizeProtocol(record.protocol_text)
  if (protocolText.length < MIN_VIABLE_PROTOCOL_LENGTH) throw new Error('Corpus protocol is not viable after safety redaction')
  return { protocolText, frozenLiteratureMatches: [], analysisMetadata: BENCHMARK_ANALYSIS_METADATA }
}

export interface BenchmarkFixtureArtifact {
  caseId: string
  protocolText: string
  frozenLiteratureMatches: []
  analysisMetadata: { generatedAt: string; gcaiVersion: string; methodologyVersion: string }
}

const BENCHMARK_ANALYSIS_METADATA = Object.freeze({ generatedAt: '2026-01-01T00:00:00.000Z', gcaiVersion: 'benchmark-fixture', methodologyVersion: 'benchmark-fixture-v1' })

export interface CorpusTransportRow { id: string; protocol_text: string; analysis_result: unknown }
export interface CorpusReadClient { read(ids: string[]): Promise<CorpusTransportRow[]> }

export function validateCorpusRows(ids: string[], rows: CorpusTransportRow[]): CorpusTransportRow[] {
  if (rows.length !== ids.length) throw new Error('Corpus read did not return exactly the requested fixture IDs')
  const requested = new Set(ids)
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || !requested.has(row.id) || seen.has(row.id)) throw new Error('Corpus read returned unexpected or duplicate fixture IDs')
    seen.add(row.id)
  }
  if (seen.size !== requested.size) throw new Error('Corpus read did not correspond exactly to the requested fixture IDs')
  return rows
}

export async function exportCorpus(ids: string[], client: CorpusReadClient, outputDir = resolve(BENCHMARK_ROOT, 'alana')): Promise<string[]> {
  const explicit = parseExplicitFixtureIds(ids)
  const allowed = (process.env.GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean)
  if (!allowed.length || explicit.some(id => !allowed.includes(id))) throw new Error('Fixture IDs are not present in the explicit benchmark allowlist')
  const records = validateCorpusRows(explicit, await client.read(explicit)).map(row => ({ protocol_text: row.protocol_text, analysis_result: row.analysis_result }))
  const dir = assertBenchmarkPath(outputDir)
  await mkdir(dir, { recursive: true })
  assertBenchmarkPath(dir)
  const paths: string[] = []
  for (let index = 0; index < records.length; index++) {
    const path = assertBenchmarkPath(resolve(dir, `fixture-${index + 1}.json`))
    await writeFile(path, `${JSON.stringify({ caseId: `fixture-${index + 1}`, ...sanitizeCorpusRecord(records[index]) }, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
    paths.push(relative(process.cwd(), path))
  }
  return paths
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const auth = resolveBenchmarkAuth(args)
  const ids = parseExplicitFixtureIds(args)
  const url = validateBenchmarkSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  const client: CorpusReadClient = { async read(explicitIds) {
    const endpoint = `${url}/rest/v1/gpc_analyses?select=id,protocol_text,analysis_result&id=in.(${explicitIds.join(',')})`
    const response = await fetch(endpoint, { headers: { apikey: auth.key, Authorization: `Bearer ${auth.key}` } })
    if (!response.ok) throw new Error(`Corpus read failed with status ${response.status}`)
    const value: unknown = await response.json()
    if (!Array.isArray(value)) throw new Error('Corpus read returned an invalid shape')
    return validateCorpusRows(explicitIds, value as CorpusTransportRow[])
  } }
  await exportCorpus(ids, client)
}

if (import.meta.url === `file://${process.argv[1]}`) void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Corpus export failed'}\n`); process.exitCode = 1 })
