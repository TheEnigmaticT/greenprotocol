/**
 * Isolated direct-engine candidate probe. It never uses an authenticated user,
 * saved analysis API, dotenv file, or unbounded network destination.
 *
 * Live use (after starting scripts/run-engine-chemistry.py):
 *   GCAI_ENGINE_CANDIDATE=1 GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1 \
 *   GCAI_LLM_MODEL=qwen/qwen3.8-27b OPENROUTER_API_KEY=... \
 *   CHEMISTRY_SERVICE_TOKEN=... npx tsx scripts/run-engine-candidate.ts \
 *   --case suzuki --output /absolute/new/output-directory
 *
 * Optional public research needs all five explicit settings:
 * GCAI_PUBLIC_EVIDENCE_RPC_URL, GCAI_PUBLIC_EVIDENCE_RPC_KEY,
 * GCAI_EMBEDDING_BASE_URL, GCAI_EMBEDDING_MODEL, and
 * GCAI_EMBEDDING_API_KEY (or the exact OpenRouter fallback).
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnalysisResult, ProgressEvent } from '../lib/types'

const OPENROUTER_V1 = 'https://openrouter.ai/api/v1'
const CHEMISTRY_ORIGIN = 'http://127.0.0.1:8007'
const EVIDENCE_RPC_PATH = '/rest/v1/rpc/match_literature_evidence_units'
const FIXTURE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'benchmarks', 'engine-candidate')
const FIXTURE_FILES = {
  'fixture-1': 'fixture-1.json',
  'fixture-2': 'fixture-2.json',
  'fixture-3': 'fixture-3.json',
  suzuki: 'suzuki.json',
  'aspirin-demo': 'aspirin-demo.json',
} as const

type Environment = Readonly<Record<string, string | undefined>>
type ResearchStatus = 'configured' | 'unavailable'

export interface CandidateEndpoint {
  baseURL: string
  model: string
  apiKey: string
  apiKeySource: 'explicit' | 'openrouter-fallback'
}

export interface CandidateResearchConfig {
  status: ResearchStatus
  reason?: 'public_evidence_rpc_not_configured'
  rpcURL?: string
  rpcKey?: string
  embedding?: CandidateEndpoint
}

export interface CandidateRunConfig {
  model: CandidateEndpoint
  research: CandidateResearchConfig
  chemistryToken: string
  secrets: string[]
}

export interface CandidateRequest {
  url: string
  method: string
  body?: unknown
}

interface CandidateFixture {
  caseId: string
  protocolText: string
  provenance: Record<string, unknown>
}

interface ParsedArguments {
  caseId?: string
  protocolFile?: string
  output?: string
  preflight: boolean
  help: boolean
}

function configuredValue(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim()
  return value || undefined
}

function requireConfiguredValue(env: Environment, name: string): string {
  const value = configuredValue(env, name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parseVersionedBaseURL(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL ending in /v1`)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/v1')
  ) {
    throw new Error(`${name} must be an absolute http(s) URL ending in /v1`)
  }
  return url.toString().replace(/\/$/, '')
}

function parsePublicEvidenceRPCURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('GCAI_PUBLIC_EVIDENCE_RPC_URL must be the exact public HTTPS evidence RPC endpoint')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== EVIDENCE_RPC_PATH
  ) {
    throw new Error('GCAI_PUBLIC_EVIDENCE_RPC_URL must be the exact public HTTPS evidence RPC endpoint')
  }
  return url.toString()
}

function resolveEndpoint(
  env: Environment,
  baseURLName: string,
  modelName: string,
  apiKeyName: string,
  explicitKeyRequiredMessage: string,
): CandidateEndpoint {
  const baseURL = parseVersionedBaseURL(requireConfiguredValue(env, baseURLName), baseURLName)
  const model = requireConfiguredValue(env, modelName)
  const explicitKey = configuredValue(env, apiKeyName)
  const openRouterFallback = baseURL === OPENROUTER_V1 ? configuredValue(env, 'OPENROUTER_API_KEY') : undefined
  const apiKey = explicitKey ?? openRouterFallback
  if (!apiKey) throw new Error(explicitKeyRequiredMessage)
  return {
    baseURL,
    model,
    apiKey,
    apiKeySource: explicitKey ? 'explicit' : 'openrouter-fallback',
  }
}

/** Parse explicit runtime-only configuration without reading dotenv or files. */
export function parseCandidateRunConfig(env: Environment = process.env): CandidateRunConfig {
  if (env.GCAI_ENGINE_CANDIDATE !== '1') {
    throw new Error('GCAI_ENGINE_CANDIDATE=1 is required')
  }

  const model = resolveEndpoint(
    env,
    'GCAI_LLM_BASE_URL',
    'GCAI_LLM_MODEL',
    'GCAI_LLM_API_KEY',
    'GCAI_LLM_API_KEY is required for a non-OpenRouter candidate endpoint',
  )
  const chemistryToken = requireConfiguredValue(env, 'CHEMISTRY_SERVICE_TOKEN')

  const rpcURLValue = configuredValue(env, 'GCAI_PUBLIC_EVIDENCE_RPC_URL')
  const rpcKey = configuredValue(env, 'GCAI_PUBLIC_EVIDENCE_RPC_KEY')
  const embeddingBaseURL = configuredValue(env, 'GCAI_EMBEDDING_BASE_URL')
  const embeddingModel = configuredValue(env, 'GCAI_EMBEDDING_MODEL')
  const embeddingKey = configuredValue(env, 'GCAI_EMBEDDING_API_KEY')
  const embeddingValues = [
    embeddingBaseURL,
    embeddingModel,
    embeddingKey ?? configuredValue(env, 'OPENROUTER_API_KEY'),
  ]
  const hasAnyEvidenceConfig = Boolean(rpcURLValue || rpcKey || embeddingBaseURL || embeddingModel || embeddingKey)

  if (!hasAnyEvidenceConfig) {
    return {
      model,
      chemistryToken,
      research: {
        status: 'unavailable',
        reason: 'public_evidence_rpc_not_configured',
      },
      secrets: [model.apiKey, chemistryToken],
    }
  }

  if (!rpcURLValue || !rpcKey) {
    throw new Error('GCAI_PUBLIC_EVIDENCE_RPC_URL and GCAI_PUBLIC_EVIDENCE_RPC_KEY must be configured together')
  }
  if (!embeddingValues[0] || !embeddingValues[1] || !embeddingValues[2]) {
    throw new Error('Explicit embedding base URL, model, and key are required when public evidence is configured')
  }

  const embedding = resolveEndpoint(
    env,
    'GCAI_EMBEDDING_BASE_URL',
    'GCAI_EMBEDDING_MODEL',
    'GCAI_EMBEDDING_API_KEY',
    'GCAI_EMBEDDING_API_KEY is required for a non-OpenRouter candidate endpoint',
  )
  const rpcURL = parsePublicEvidenceRPCURL(rpcURLValue)
  return {
    model,
    chemistryToken,
    research: { status: 'configured', rpcURL, rpcKey, embedding },
    secrets: [...new Set([model.apiKey, chemistryToken, rpcKey, embedding.apiKey])],
  }
}

function sameEndpoint(url: URL, endpoint: string): boolean {
  const expected = new URL(endpoint)
  return (
    url.protocol === expected.protocol &&
    url.hostname === expected.hostname &&
    url.port === expected.port &&
    url.pathname === expected.pathname &&
    url.search === '' &&
    url.hash === '' &&
    !url.username &&
    !url.password
  )
}

function bodyModel(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const value = (body as Record<string, unknown>).model
  return typeof value === 'string' ? value : undefined
}

function requestedPublicVisibility(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  return (body as Record<string, unknown>).requested_visibility === 'public'
}

/** True only for known, bounded network requests from this direct probe. */
export function isAllowedCandidateRequest(config: CandidateRunConfig, request: CandidateRequest): boolean {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return false
  }
  const method = request.method.toUpperCase()

  if (
    method === 'POST' &&
    sameEndpoint(url, `${config.model.baseURL}/chat/completions`) &&
    bodyModel(request.body) === config.model.model
  ) {
    return true
  }

  const embedding = config.research.embedding
  if (
    embedding &&
    method === 'POST' &&
    sameEndpoint(url, `${embedding.baseURL}/embeddings`) &&
    bodyModel(request.body) === embedding.model
  ) {
    return true
  }

  if (
    config.research.status === 'configured' &&
    config.research.rpcURL &&
    method === 'POST' &&
    sameEndpoint(url, config.research.rpcURL) &&
    requestedPublicVisibility(request.body)
  ) {
    return true
  }

  if (url.origin !== CHEMISTRY_ORIGIN || url.search || url.hash || url.username || url.password) return false
  if (method === 'GET' && url.pathname === '/health') return true
  return method === 'POST' && (url.pathname === '/batch' || url.pathname === '/score')
}

function redactString(value: string, secrets: readonly string[]): string {
  let sanitized = value
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.split(secret).join('[REDACTED]')
  }
  return sanitized.replace(/(authorization\s*:\s*bearer\s+)[^\s,"}]+/gi, '$1[REDACTED]')
}

function sensitiveKey(key: string): boolean {
  return /(?:authorization|api[-_]?key|token|secret|password|cookie)/i.test(key)
}

/** Remove known credential values and credential-shaped fields before persistence. */
export function sanitizeReceiptValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactString(value, secrets)
  if (Array.isArray(value)) return value.map(item => sanitizeReceiptValue(item, secrets))
  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      sanitized[key] = sensitiveKey(key) ? '[REDACTED]' : sanitizeReceiptValue(nested, secrets)
    }
    return sanitized
  }
  return value
}

function parseRequestBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error'
}

function writeArtifact(output: string, name: string, value: unknown, secrets: readonly string[]): void {
  const safeValue = sanitizeReceiptValue(value, secrets)
  writeFileSync(join(output, name), `${JSON.stringify(safeValue, null, 2)}\n`, { mode: 0o600 })
}

function requiredOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = { preflight: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--case') {
      if (parsed.caseId) throw new Error('--case may only be provided once')
      parsed.caseId = requiredOptionValue(argv, index, '--case')
      index += 1
    } else if (argument === '--protocol-file') {
      if (parsed.protocolFile) throw new Error('--protocol-file may only be provided once')
      parsed.protocolFile = requiredOptionValue(argv, index, '--protocol-file')
      index += 1
    } else if (argument === '--output') {
      if (parsed.output) throw new Error('--output may only be provided once')
      parsed.output = requiredOptionValue(argv, index, '--output')
      index += 1
    } else if (argument === '--preflight') {
      if (parsed.preflight) throw new Error('--preflight may only be provided once')
      parsed.preflight = true
    } else if (argument === '--help' || argument === '-h') {
      parsed.help = true
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (parsed.help) return parsed
  if (parsed.caseId && parsed.protocolFile) throw new Error('--case and --protocol-file are mutually exclusive')
  if (!parsed.caseId && !parsed.protocolFile) throw new Error('Exactly one of --case or --protocol-file is required')
  if (!parsed.preflight && !parsed.output) throw new Error('--output is required unless --preflight is used')
  return parsed
}

function usage(): string {
  return [
    'Run: npx tsx scripts/run-engine-candidate.ts (--case <case> | --protocol-file <absolute-path.txt>) --output <new-absolute-directory>',
    'Preflight: npx tsx scripts/run-engine-candidate.ts (--case <case> | --protocol-file <absolute-path.txt>) --preflight',
    'Cases: fixture-1, fixture-2, fixture-3, suzuki, aspirin-demo',
    'Use --preflight to validate runtime configuration and the selected input without running the engine.',
  ].join('\n')
}

function loadFixture(caseId: string | undefined): CandidateFixture {
  if (!caseId || !(caseId in FIXTURE_FILES)) {
    throw new Error(`--case must be one of: ${Object.keys(FIXTURE_FILES).join(', ')}`)
  }
  const fixturePath = join(FIXTURE_DIRECTORY, FIXTURE_FILES[caseId as keyof typeof FIXTURE_FILES])
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Partial<CandidateFixture>
  if (fixture.caseId !== caseId || typeof fixture.protocolText !== 'string' || !fixture.protocolText || !fixture.provenance) {
    throw new Error(`Fixture ${caseId} is malformed`)
  }
  return fixture as CandidateFixture
}

function loadProtocolFile(path: string | undefined): CandidateFixture {
  if (!path || !isAbsolute(path)) throw new Error('--protocol-file must be an absolute path')
  let protocolText: string
  try {
    protocolText = readFileSync(resolve(path), 'utf8')
  } catch {
    throw new Error('--protocol-file must be a readable UTF-8 text file')
  }
  if (!protocolText.trim()) throw new Error('--protocol-file must not be empty')
  return {
    caseId: 'protocol-file',
    protocolText,
    provenance: { source: 'protocol-file' },
  }
}

function loadInput(args: ParsedArguments): CandidateFixture {
  return args.protocolFile ? loadProtocolFile(args.protocolFile) : loadFixture(args.caseId)
}

function createNewOutputDirectory(path: string | undefined): string {
  if (!path || !isAbsolute(path)) throw new Error('--output must be a new absolute directory path')
  const output = resolve(path)
  if (existsSync(output)) throw new Error('--output directory already exists; a unique path is required')
  mkdirSync(output, { recursive: false, mode: 0o700 })
  return output
}

function configureIsolatedRuntime(config: CandidateRunConfig): void {
  const inheritedChemistryURL = configuredValue(process.env, 'CHEMISTRY_SERVICE_URL')
  if (inheritedChemistryURL && inheritedChemistryURL !== CHEMISTRY_ORIGIN) {
    throw new Error('CHEMISTRY_SERVICE_URL must be unset or http://127.0.0.1:8007 for the candidate probe')
  }

  process.env.CHEMISTRY_SERVICE_URL = CHEMISTRY_ORIGIN
  process.env.GCAI_ENGINE_CANDIDATE = '1'
  delete process.env.GCAI_QWEN_PARITY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.LOCAL_LLM_URL
  delete process.env.LLM_PROVIDER

  // Prevent SDK defaults from reaching saved analyses, trace tables, or a
  // chemistry reference store. The only opt-in database call is the public RPC.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  if (config.research.status === 'configured' && config.research.rpcURL && config.research.rpcKey) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = new URL(config.research.rpcURL).origin
    process.env.SUPABASE_SERVICE_ROLE_KEY = config.research.rpcKey
  }
}

function publicManifest(config: CandidateRunConfig, fixture: CandidateFixture): Record<string, unknown> {
  return {
    runner: 'engine-candidate-direct-probe',
    startedAt: new Date().toISOString(),
    caseId: fixture.caseId,
    protocolSha256: createHash('sha256').update(fixture.protocolText).digest('hex'),
    fixtureProvenance: fixture.provenance,
    candidate: {
      flag: true,
      model: {
        baseURL: config.model.baseURL,
        model: config.model.model,
        apiKeySource: config.model.apiKeySource,
      },
      chemistryService: CHEMISTRY_ORIGIN,
      chemistryTokenConfigured: true,
      research: config.research.status === 'configured'
        ? {
            status: 'configured',
            evidenceRpcURL: config.research.rpcURL,
            embedding: {
              baseURL: config.research.embedding?.baseURL,
              model: config.research.embedding?.model,
              apiKeySource: config.research.embedding?.apiKeySource,
            },
          }
        : { status: 'unavailable', reason: config.research.reason },
    },
    isolation: {
      userContext: 'none',
      savedAnalysisWrites: 'blocked_by_no_context_and_network_allowlist',
      supabaseRuntime: config.research.status === 'configured' ? 'public_rpc_only' : 'disabled',
    },
  }
}

function researchSummary(config: CandidateRunConfig, receipts: Array<Record<string, unknown>>): Record<string, unknown> {
  if (config.research.status === 'unavailable') {
    return { status: 'unavailable', reason: config.research.reason, matchCount: null }
  }
  const evidenceReceipts = receipts.filter(receipt => receipt.endpoint === config.research.rpcURL)
  if (!evidenceReceipts.length) return { status: 'not_attempted', reason: 'pipeline_did_not_issue_a_public_evidence_rpc', matchCount: null }

  const successful = evidenceReceipts.filter(receipt => receipt.status === 200)
  if (!successful.length) {
    return {
      status: 'unavailable',
      reason: 'public_evidence_rpc_did_not_return_200',
      matchCount: null,
      responseStatuses: evidenceReceipts.map(receipt => receipt.status ?? 'transport_error'),
    }
  }
  const matchCount = successful.reduce<number | null>((total, receipt) => {
    if (typeof receipt.rawResponse !== 'string') return total
    try {
      const response = JSON.parse(receipt.rawResponse)
      return Array.isArray(response) ? (total ?? 0) + response.length : total
    } catch {
      return total
    }
  }, 0)
  return { status: 'available', matchCount }
}

function summarizePrincipleOutcomes(progress: readonly ProgressEvent[]): Array<Record<string, unknown>> {
  const terminalOutcomes = new Map<number, Extract<ProgressEvent, { type: 'principle' }>>()
  for (const event of progress) {
    if (event.type === 'principle' && event.status !== 'evaluating') terminalOutcomes.set(event.number, event)
  }
  return Array.from({ length: 12 }, (_, index) => {
    const principle = index + 1
    const outcome = terminalOutcomes.get(principle)
    return outcome
      ? {
          principle,
          name: outcome.name,
          status: outcome.status,
          recommendations: outcome.recommendations ?? null,
        }
      : { principle, name: `Principle ${principle}`, status: 'not_reported', recommendations: null }
  })
}

function pipelineRuntime(result: AnalysisResult, principleOutcomes: readonly Record<string, unknown>[]): {
  status: 'complete' | 'degraded'
  revisedProtocolPresent: boolean
} {
  const revisedProtocolPresent = Boolean(result.revisedProtocol.trim())
  const allPrinciplesComplete = principleOutcomes.every(outcome => outcome.status === 'complete')
  return {
    status: revisedProtocolPresent && allPrinciplesComplete ? 'complete' : 'degraded',
    revisedProtocolPresent,
  }
}

export async function run(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }
  const config = parseCandidateRunConfig()
  const fixture = loadInput(args)

  if (args.preflight) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'preflight',
      caseId: fixture.caseId,
      research: config.research.status,
      chemistryService: CHEMISTRY_ORIGIN,
    }))
    return
  }

  const output = createNewOutputDirectory(args.output)
  const receipts: Array<Record<string, unknown>> = []
  const progress: ProgressEvent[] = []
  const startedAt = Date.now()
  writeArtifact(output, 'manifest.json', publicManifest(config, fixture), config.secrets)

  try {
    configureIsolatedRuntime(config)
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      const body = parseRequestBody(request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text())
      if (!isAllowedCandidateRequest(config, { url: request.url, method: request.method, body })) {
        throw new Error('Candidate network destination blocked by direct-probe allowlist')
      }

      const receipt: Record<string, unknown> = {
        id: receipts.length + 1,
        endpoint: url.origin + url.pathname,
        method: request.method,
        startedAt: new Date().toISOString(),
        request: body,
      }
      receipts.push(receipt)
      const name = `call-${String(receipt.id).padStart(3, '0')}.json`
      writeArtifact(output, name, receipt, config.secrets)
      try {
        const response = await originalFetch(request)
        receipt.status = response.status
        receipt.rawResponse = await response.clone().text()
        receipt.completedAt = new Date().toISOString()
        writeArtifact(output, name, receipt, config.secrets)
        return response
      } catch (error) {
        receipt.error = safeError(error)
        receipt.completedAt = new Date().toISOString()
        writeArtifact(output, name, receipt, config.secrets)
        throw error
      }
    }

    try {
      // Deliberately omit the CallContext: this creates no user, trace, or saved-analysis write path.
      const { analyzeProtocol } = await import('../lib/pipeline')
      const result = await analyzeProtocol(fixture.protocolText, event => {
        progress.push(event)
        writeArtifact(output, 'progress.json', progress, config.secrets)
        if (event.type === 'phase') console.log(event.message)
      })
      writeArtifact(output, 'result.json', result, config.secrets)
      const scores = result.deterministicScores?.scores ?? []
      const principleOutcomes = summarizePrincipleOutcomes(progress)
      const runtime = pipelineRuntime(result, principleOutcomes)
      const summary = {
        ok: runtime.status === 'complete',
        caseId: fixture.caseId,
        elapsedMs: Date.now() - startedAt,
        stepCount: result.steps.length,
        recommendationCount: result.recommendations.length,
        revisedProtocolPresent: runtime.revisedProtocolPresent,
        pipelineRuntime: { status: runtime.status },
        principleOutcomes,
        availableScores: scores.filter(score => score.score >= 0 && score.confidence !== 'unavailable').length,
        scores: scores.map(score => ({
          principle: score.principle_number,
          score: score.score,
          confidence: score.confidence,
          details: score.details,
        })),
        chemistry: result.chemistryDataStatus,
        chemicalSmilesCount: result.enrichedChemicals?.filter(chemical => Boolean(chemical.smiles)).length ?? 0,
        reactionSmiles: result.deterministicScores?.smiles_extraction,
        research: researchSummary(config, receipts),
        receiptsCaptured: receipts.length,
      }
      writeArtifact(output, 'summary.json', summary, config.secrets)
      console.log(JSON.stringify({ ok: summary.ok, caseId: fixture.caseId, elapsedMs: summary.elapsedMs, output }))
    } finally {
      globalThis.fetch = originalFetch
    }
  } catch (error) {
    writeArtifact(output, 'failure.json', {
      error: safeError(error),
      elapsedMs: Date.now() - startedAt,
      receiptsCaptured: receipts.length,
    }, config.secrets)
    throw error
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(sanitizeReceiptValue({ error: safeError(error) }, []))
    process.exitCode = 1
  })
}
