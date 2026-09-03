import type { ChatMessage, ChatProvider, ChatToolCall } from '@/lib/talk-about-this/chat-provider'
import { telemetryForActivity } from '@/lib/talk-about-this/latency'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import {
  buildChatTools,
  scopedChemicals,
  type ScopedToolCall,
  type ToolName,
  type ToolResult,
} from '@/lib/talk-about-this/tools'
import type { RetrievalAttemptTelemetry } from '@/lib/talk-about-this/repository'
import type { CreateToolRunInput, ToolRunReasonCode, ToolRunStatus } from '@/lib/talk-about-this/repository'
import type { Citation, EvidenceSignalGroup, LiteratureEvidenceMatch } from '@/lib/types'

export const MAX_TOOL_ROUNDS = 4
export const MAX_TOOL_CALLS_PER_TURN = 3
const TOOL_CALL_TIMEOUT_MS = 10_000
const TOOL_LOOP_TIMEOUT_MS = 12_000
export type ChatLifecycleEvent = 'activity' | 'delta' | 'tool-start' | 'tool-complete' | 'tool-failed'

export interface ScopedToolChatRequest {
  provider: ChatProvider
  context: TalkAboutContext
  messages: ChatMessage[]
  signal?: AbortSignal
  executeTool: (call: ScopedToolCall, signal?: AbortSignal) => Promise<ToolResult>
  onEvent: (event: ChatLifecycleEvent, data: Record<string, unknown>) => void
  turnId?: string
  onToolRun?: (input: Omit<CreateToolRunInput, 'conversationId' | 'userMessageId'>) => Promise<void>
  now?: () => number
}

export interface ChatRunResult {
  telemetry: ChatLatencyTelemetry
  answer: string
  citations: Citation[]
  diagnosticPersistence: Promise<void>
  evidence: LiteratureEvidenceMatch[]
}

export interface ChatLatencyTelemetry {
  initialProviderFirstTextAt?: number
  finalProviderFirstTextAt?: number
  retrievalAttempts?: RetrievalAttemptTelemetry[]
  scheduling?: {
    requestedCount: number
    dispatchedCount: number
    deduplicatedCount: number
  }
}

function isToolName(name: string): name is ToolName {
  return name === 'lookup_chem21_solvent'
    || name === 'lookup_pubchem_profile'
    || name === 'calculate_rdkit_properties'
    || name === 'lookup_experimental_solvent_evidence'
    || name === 'lookup_solvent_hazard_profile'
    || name === 'screen_solvent_candidates'
    || name === 'search_scoped_literature_evidence'
}

function operationFor(name: string): ToolResult['operation'] {
  switch (name) {
    case 'lookup_chem21_solvent': return 'chem21'
    case 'lookup_pubchem_profile': return 'pubchem'
    case 'calculate_rdkit_properties': return 'rdkit'
    case 'lookup_experimental_solvent_evidence': return 'solvent_evidence'
    case 'lookup_solvent_hazard_profile': return 'solvent_hazard'
    case 'screen_solvent_candidates': return 'solvent_screening'
    case 'search_scoped_literature_evidence': return 'literature_evidence'
    default: return 'rdkit'
  }
}

function failureResult(call: ChatToolCall, reason: string): ToolResult {
  return {
    operation: operationFor(call.name),
    chemical_name: '',
    status: 'unavailable',
    source: 'GC.ai tool boundary',
    data: {},
    citations: [],
    warnings: [reason],
  }
}

interface ToolDiagnostic {
  status: ToolRunStatus
  reasonCode: ToolRunReasonCode
  reasonDetail?: string
  userNote: string
}

const safeReasonDetails: Record<Exclude<ToolRunReasonCode, 'none'>, string> = {
  deadline_exceeded: 'The tool did not finish before its dispatch deadline.',
  client_cancelled: 'The client cancelled the tool request.',
  call_limit_exceeded: 'The tool call limit was reached.',
  invalid_request: 'The tool request was invalid.',
  tool_error: 'The tool could not complete the request.',
  diagnostic_write_failed: 'Tool diagnostic persistence failed.',
}

function sourceForTool(tool: ToolName): string {
  switch (tool) {
    case 'lookup_chem21_solvent': return 'CHEM21'
    case 'lookup_pubchem_profile': return 'PubChem GHS'
    case 'search_scoped_literature_evidence': return 'scoped literature evidence'
    default: return 'local evidence'
  }
}

function diagnosticForFailure(input: {
  tool: ToolName
  source: string
  abortReason: 'deadline' | 'client' | null
  skippedForLimit?: boolean
  invalidRequest?: boolean
}): ToolDiagnostic {
  if (input.skippedForLimit) {
    return {
      status: 'skipped_limit',
      reasonCode: 'call_limit_exceeded',
      reasonDetail: safeReasonDetails.call_limit_exceeded,
      userNote: 'The tool call limit was reached.',
    }
  }
  if (input.abortReason === 'deadline') {
    return {
      status: 'timed_out',
      reasonCode: 'deadline_exceeded',
      reasonDetail: safeReasonDetails.deadline_exceeded,
      userNote: `${input.source} did not finish before the tool deadline.`,
    }
  }
  if (input.abortReason === 'client') {
    return {
      status: 'cancelled',
      reasonCode: 'client_cancelled',
      reasonDetail: safeReasonDetails.client_cancelled,
      userNote: 'The tool request was cancelled.',
    }
  }
  const reasonCode: ToolRunReasonCode = input.invalidRequest ? 'invalid_request' : 'tool_error'
  return {
    status: 'failed',
    reasonCode,
    reasonDetail: safeReasonDetails[reasonCode],
    userNote: `${input.source} could not complete the request.`,
  }
}

function fingerprint(call: ScopedToolCall): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]))
    }
    return value
  }
  const { id: _id, ...normalizedArguments } = call
  return JSON.stringify(normalize({ name: call.name, normalizedArguments }))
}

function dependsOnCanonicalSmiles(call: ChatToolCall): string | null {
  try {
    const argumentsValue = parseArguments(call)
    if (call.name === 'screen_solvent_candidates') return typeof argumentsValue.solute === 'string' ? argumentsValue.solute.trim() : null
    if (call.name === 'lookup_experimental_solvent_evidence'
      && argumentsValue.mode !== 'density'
      && typeof argumentsValue.solute === 'string') return argumentsValue.solute.trim()
  } catch {
    // Full parsing happens in the immutable validation pass.
  }
  return null
}

function parseArguments(call: ChatToolCall): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(call.arguments)
  } catch {
    throw new Error('Tool request arguments must be valid JSON')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool request arguments must be an object')
  }
  return value as Record<string, unknown>
}

function requireOnlyArguments(value: Record<string, unknown>, names: readonly string[]): void {
  if (Object.keys(value).some(name => !names.includes(name))) {
    throw new Error('Tool request contains unsupported arguments')
  }
}

function requireString(value: Record<string, unknown>, name: string): string {
  const argument = value[name]
  if (typeof argument !== 'string' || !argument.trim()) {
    throw new Error(`Tool request requires a ${name}`)
  }
  return argument.trim()
}

function requireFiniteNumber(value: Record<string, unknown>, name: string): number {
  const argument = value[name]
  if (typeof argument !== 'number' || !Number.isFinite(argument)) {
    throw new Error(`Tool request requires a finite ${name}`)
  }
  return argument
}

function optionalString(value: Record<string, unknown>, name: string): string | undefined {
  const argument = value[name]
  if (argument === undefined) return undefined
  if (typeof argument !== 'string' || !argument.trim()) {
    throw new Error(`Tool request requires a ${name}`)
  }
  return argument.trim()
}

function optionalFiniteNumber(value: Record<string, unknown>, name: string): number | undefined {
  const argument = value[name]
  if (argument === undefined) return undefined
  if (typeof argument !== 'number' || !Number.isFinite(argument)) {
    throw new Error(`Tool request requires a finite ${name}`)
  }
  return argument
}

function requireScopedChemical(context: TalkAboutContext, chemical: string): void {
  if (!scopedChemicals(context).some(item => item.toLowerCase() === chemical.toLowerCase())) {
    throw new Error('Requested chemical is outside this scoped discussion')
  }
}

/** Parses closed Qwen arguments and appends only server-authenticated PubChem structures. */
export function parseScopedToolCall(
  context: TalkAboutContext,
  call: ChatToolCall,
  canonicalSmilesByChemical: ReadonlyMap<string, string>,
): ScopedToolCall {
  if (!isToolName(call.name)) throw new Error(`Unsupported tool requested: ${call.name}`)
  const value = parseArguments(call)


  if (call.name === 'search_scoped_literature_evidence') {
    requireOnlyArguments(value, ['query', 'signalGroups'])
    const query = requireString(value, 'query')
    if (query.length > 500) throw new Error('Literature evidence query must contain 1–500 characters')
    const signalGroups = value.signalGroups
    if (signalGroups !== undefined && (!Array.isArray(signalGroups)
      || signalGroups.some(group => group !== 'comparison' && group !== 'process' && group !== 'outcome' && group !== 'hazard'))) {
      throw new Error('Tool request has an unsupported literature evidence signal group')
    }
    const scopeTerms = [
      ...scopedChemicals(context),
      ...context.recommendations.flatMap(recommendation => [
        `${recommendation.original.chemical} ${recommendation.alternative.chemical}`,
        `${recommendation.alternative.chemical} ${recommendation.original.chemical}`,
      ]),
    ]
    if (!scopeTerms.some(term => query.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) {
      throw new Error('Literature evidence query must mention a scoped chemical or recommendation pair')
    }
    return {
      id: call.id,
      name: call.name,
      query,
      ...(signalGroups ? { signalGroups: signalGroups as EvidenceSignalGroup[] } : {}),
    }
  }
  switch (call.name) {
    case 'lookup_chem21_solvent':
    case 'lookup_pubchem_profile':
    case 'calculate_rdkit_properties': {
      requireOnlyArguments(value, ['chemical'])
      const chemical = requireString(value, 'chemical')
      if (call.name !== 'lookup_chem21_solvent') requireScopedChemical(context, chemical)
      return { id: call.id, name: call.name, chemical }
    }
    case 'lookup_solvent_hazard_profile':
      requireOnlyArguments(value, ['solvent'])
      return { id: call.id, name: call.name, solvent: requireString(value, 'solvent') }
    case 'screen_solvent_candidates': {
      requireOnlyArguments(value, ['solute', 'currentSolvent', 'temperatureK'])
      const solute = requireString(value, 'solute')
      const currentSolvent = requireString(value, 'currentSolvent')
      requireScopedChemical(context, solute)
      requireScopedChemical(context, currentSolvent)
      const canonicalSoluteSmiles = canonicalSmilesByChemical.get(solute.toLowerCase())
      if (!canonicalSoluteSmiles) {
        throw new Error('Resolve the scoped solute with PubChem before screening')
      }
      return {
        id: call.id,
        name: call.name,
        solute,
        currentSolvent,
        temperatureK: requireFiniteNumber(value, 'temperatureK'),
        canonicalSoluteSmiles,
      }
    }
    case 'lookup_experimental_solvent_evidence': {
      requireOnlyArguments(value, ['mode', 'solute', 'solvent', 'coSolvent', 'fractionSolvent', 'fractionType', 'temperatureK'])
      const mode = requireString(value, 'mode')
      if (mode !== 'single_solubility' && mode !== 'mixture_solubility' && mode !== 'density') {
        throw new Error('Tool request has an unsupported mode')
      }
      const solvent = requireString(value, 'solvent')
      const temperatureK = requireFiniteNumber(value, 'temperatureK')
      if (mode === 'density') return { id: call.id, name: call.name, mode, solvent, temperatureK }

      const solute = requireString(value, 'solute')
      requireScopedChemical(context, solute)
      requireScopedChemical(context, solvent)
      const canonicalSoluteSmiles = canonicalSmilesByChemical.get(solute.toLowerCase())
      if (!canonicalSoluteSmiles) {
        throw new Error('Resolve the scoped solute with PubChem before looking up solubility')
      }
      const coSolvent = optionalString(value, 'coSolvent')
      const fractionSolvent = optionalFiniteNumber(value, 'fractionSolvent')
      const fractionType = optionalString(value, 'fractionType')
      if (mode === 'mixture_solubility') {
        if (!coSolvent || fractionSolvent === undefined || !fractionType) {
          throw new Error('Mixture solubility requires coSolvent, fractionSolvent, and fractionType')
        }
        requireScopedChemical(context, coSolvent)
      }
      return {
        id: call.id,
        name: call.name,
        mode,
        solute,
        solvent,
        coSolvent,
        fractionSolvent,
        fractionType,
        temperatureK,
        canonicalSoluteSmiles,
      }
    }
  }
}

function objectRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    : []
}

function sourceValues(record: Record<string, unknown> | Citation): string[] {
  return ['source', 'source_id', 'source_name', 'source_url'].flatMap(field => {
    const value = record[field as keyof typeof record]
    return typeof value === 'string' ? [value] : []
  })
}

function datasetForMeasurement(measurement: Record<string, unknown>): string | null {
  if (typeof measurement.density_g_per_cm3 === 'number') return 'density'
  if (typeof measurement.fraction_solvent_1 === 'number') return 'MixtureSolDB'
  if (typeof measurement.solubility_mole_fraction === 'number') return 'BigSolDB'
  return null
}

export function activityData(call: ChatToolCall, result: ToolResult): Record<string, unknown> {
  const directMeasurements = objectRecords(result.data.measurements)
  const candidates = objectRecords(result.data.candidates)
  const candidateMeasurements = candidates.flatMap(candidate => [
    ...objectRecords(candidate.current_measurements),
    ...objectRecords(candidate.candidate_measurements),
  ])
  const measurements = [...directMeasurements, ...candidateMeasurements]
  const citations = [
    ...candidates.flatMap(candidate => objectRecords(candidate.citations)),
    ...result.citations,
  ]
  const measurementSources = measurements.flatMap(measurement => {
    const dataset = datasetForMeasurement(measurement)
    return [...sourceValues(measurement), ...(dataset ? [dataset] : [])]
  })
  const sources = [...measurementSources, ...citations.flatMap(sourceValues)]
  const warnings = [...new Set([
    ...result.warnings,
    ...candidates.flatMap(candidate => (
      Array.isArray(candidate.warnings)
        ? candidate.warnings.filter((warning): warning is string => typeof warning === 'string')
        : []
    )),
  ])]
  return {
    callId: call.id,
    tool: call.name,
    chemical: result.chemical_name,
    status: result.status,
    source: result.source,
    classification: typeof result.data.classification === 'string' ? result.data.classification : undefined,
    measurementCount: measurements.length || undefined,
    datasetSources: [...new Set(sources)],
    warnings,
  }
}

function retrievalAttemptTelemetry(call: ChatToolCall, result: ToolResult): RetrievalAttemptTelemetry | undefined {
  if (result.operation !== 'literature_evidence' || !result.telemetry) return undefined
  const status = result.warnings.includes('Literature evidence retrieval aborted')
    ? 'aborted'
    : result.status === 'ok' ? 'complete' : 'failed'
  return {
    callId: call.id,
    status,
    ...telemetryForActivity(result.telemetry),
  }
}

/** Runs a bounded, frozen-context tool loop and never permits arbitrary model-directed I/O. */
export async function runScopedToolChat({
  provider,
  context,
  messages,
  signal,
  executeTool,
  onEvent,
  turnId = '',
  onToolRun,
  now = performance.now.bind(performance),
}: ScopedToolChatRequest): Promise<ChatRunResult> {
  const conversation = [...messages]
  const canonicalSmilesByChemical = new Map<string, string>()
  const toolLoopDeadline = performance.now() + TOOL_LOOP_TIMEOUT_MS
  // The request budget applies to provider passes as well as tool calls. Without
  // this signal, a stalled streamed model response can outlive the tool budget
  // and wait for an infrastructure timeout measured in minutes.
  const deadlineSignal = AbortSignal.timeout(TOOL_LOOP_TIMEOUT_MS)
  const requestSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal
  const citationsById = new Map<string, Citation>()
  const evidenceById = new Map<string, LiteratureEvidenceMatch>()
  const answerParts: string[] = []
  const telemetry: ChatLatencyTelemetry = {}
  const diagnosticWrites: Promise<void>[] = []

  const emitDiagnostic = (
    call: ChatToolCall,
    providerRound: number,
    validatedArguments: Record<string, unknown>,
    diagnostic: ToolDiagnostic,
    timing: { dispatchBudgetMs?: number, startedAt?: string, elapsedMs?: number, telemetry?: Record<string, unknown> } = {},
  ) => {
    const toolName = isToolName(call.name) ? call.name : 'unsupported_tool'
    const data = {
      callId: call.id,
      tool: toolName,
      source: isToolName(call.name) ? sourceForTool(call.name) : 'local evidence',
      status: diagnostic.status,
      reasonCode: diagnostic.reasonCode,
      userNote: diagnostic.userNote,
    }
    if (diagnostic.status !== 'completed') onEvent('tool-failed', data)
    if (!onToolRun) return
    const diagnosticWrite = Promise.resolve().then(() => onToolRun({
      turnId,
      providerRound,
      callId: call.id,
      toolName,
      validatedArguments,
      status: diagnostic.status,
      reasonCode: diagnostic.reasonCode,
      ...(diagnostic.reasonDetail ? { reasonDetail: diagnostic.reasonDetail } : {}),
      ...(timing.dispatchBudgetMs === undefined ? {} : { dispatchBudgetMs: timing.dispatchBudgetMs }),
      ...(timing.startedAt ? { startedAt: timing.startedAt } : {}),
      completedAt: new Date().toISOString(),
      ...(timing.elapsedMs === undefined ? {} : { elapsedMs: timing.elapsedMs }),
      telemetry: timing.telemetry ?? {},
    })).catch(() => {
      console.error('Scoped tool diagnostic callback failed', { turnId, callId: call.id })
    })
    diagnosticWrites.push(diagnosticWrite)
  }

  const completedDiagnostic: ToolDiagnostic = {
    status: 'completed',
    reasonCode: 'none',
    userNote: 'The tool completed.',
  }

  const diagnosticForResult = (call: ChatToolCall, result: ToolResult): ToolDiagnostic =>
    result.status === 'ok'
      ? completedDiagnostic
      : diagnosticForFailure({
        tool: call.name as ToolName,
        source: sourceForTool(call.name as ToolName),
        abortReason: null,
      })

  const appendToolComplete = (call: ChatToolCall, result: ToolResult) => {
    if (result.operation === 'literature_evidence') {
      const evidence = Array.isArray(result.data.evidence)
        ? result.data.evidence.filter((item): item is LiteratureEvidenceMatch => item !== null && typeof item === 'object'
          && typeof (item as LiteratureEvidenceMatch).id === 'string').slice(0, 5)
        : []
      for (const match of evidence) evidenceById.set(match.id, match)
      for (const citation of result.citations) citationsById.set(citation.source_id, citation)
      const retrievalAttempt = retrievalAttemptTelemetry(call, result)
      if (retrievalAttempt) telemetry.retrievalAttempts = [...(telemetry.retrievalAttempts ?? []), retrievalAttempt].slice(-5)
      onEvent('tool-complete', {
        ...activityData(call, result),
        evidence,
        citations: result.citations.slice(0, 5),
        telemetry: telemetryForActivity(result.telemetry ?? {}),
      })
      return
    }
    onEvent('tool-complete', activityData(call, result))
  }

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const turnText: string[] = []
    let roundFirstTextAt: number | undefined
    let toolCalls: ChatToolCall[] = []
    onEvent('activity', { state: 'thinking', round })

    for await (const event of provider.stream({
      system: buildTalkAboutSystemPrompt(context, citationsById.keys()),
      messages: conversation,
      signal: requestSignal,
      tools: buildChatTools(context),
    })) {
      if (event.text) {
        turnText.push(event.text)
        answerParts.push(event.text)
        if (roundFirstTextAt === undefined) {
          const firstTextAt = now()
          roundFirstTextAt = firstTextAt
          if (round === 0 && telemetry.initialProviderFirstTextAt === undefined) telemetry.initialProviderFirstTextAt = firstTextAt
        }
        onEvent('delta', { text: event.text })
      }
      if (event.toolCalls) toolCalls = event.toolCalls
    }

    if (!toolCalls.length) {
      if (roundFirstTextAt !== undefined && telemetry.finalProviderFirstTextAt === undefined) telemetry.finalProviderFirstTextAt = roundFirstTextAt
      const answer = answerParts.join('')
      if (!answer) throw new Error('Model returned neither text nor a tool request')
      return {
        answer,
        citations: [...citationsById.values()],
        evidence: [...evidenceById.values()],
        telemetry,
        diagnosticPersistence: Promise.all(diagnosticWrites).then(() => undefined),
      }
    }
    if (round === MAX_TOOL_ROUNDS) throw new Error('Model exceeded the maximum number of tool rounds')

    conversation.push({ role: 'assistant', content: turnText.join(''), toolCalls })
    telemetry.scheduling = { requestedCount: toolCalls.length, dispatchedCount: 0, deduplicatedCount: 0 }
    const results = new Map<string, ToolResult>()
    const prevalidated = new Map<string, ScopedToolCall>()
    const dependent = new Set<string>()
    const duplicateOf = new Map<string, string>()
    const primaryByFingerprint = new Map<string, string>()

    for (const [index, call] of toolCalls.entries()) {
      onEvent('tool-start', { callId: call.id, tool: call.name })
      if (index >= MAX_TOOL_CALLS_PER_TURN) {
        const diagnostic = diagnosticForFailure({ tool: call.name as ToolName, source: sourceForTool(call.name as ToolName), abortReason: null, skippedForLimit: true })
        results.set(call.id, failureResult(call, diagnostic.userNote))
        emitDiagnostic(call, round, {}, diagnostic)
        continue
      }
      if (performance.now() >= toolLoopDeadline) {
        const diagnostic = diagnosticForFailure({ tool: call.name as ToolName, source: sourceForTool(call.name as ToolName), abortReason: 'deadline' })
        results.set(call.id, failureResult(call, diagnostic.userNote))
        emitDiagnostic(call, round, {}, diagnostic)
        continue
      }
      try {
        const solute = dependsOnCanonicalSmiles(call)
        const provisionalSmiles = solute ? new Map([[solute.toLowerCase(), '__deferred__']]) : canonicalSmilesByChemical
        const scoped = parseScopedToolCall(context, call, provisionalSmiles)
        prevalidated.set(call.id, scoped)
        if (solute) dependent.add(call.id)
      } catch (error) {
        console.error('Scoped tool request rejected', { turnId, callId: call.id, tool: call.name, error })
        const diagnostic = diagnosticForFailure({ tool: call.name as ToolName, source: sourceForTool(call.name as ToolName), abortReason: null, invalidRequest: true })
        results.set(call.id, failureResult(call, diagnostic.userNote))
        emitDiagnostic(call, round, {}, diagnostic)
      }
    }

    const executeWave = async (ids: string[]) => {
      await Promise.all(ids.map(async id => {
        const call = toolCalls.find(item => item.id === id)!
        let scoped = prevalidated.get(id)!
        if (dependent.has(id)) {
          try {
            scoped = parseScopedToolCall(context, call, canonicalSmilesByChemical)
          } catch {
            const diagnostic = diagnosticForFailure({ tool: call.name as ToolName, source: sourceForTool(call.name as ToolName), abortReason: null })
            results.set(call.id, failureResult(call, diagnostic.userNote))
            emitDiagnostic(call, round, {}, diagnostic)
            return
          }
        }
        const key = fingerprint(scoped)
        const primaryCallId = primaryByFingerprint.get(key)
        const validatedArguments = Object.fromEntries(Object.entries(scoped).filter(([key]) => key !== 'id' && key !== 'name'))
        if (primaryCallId) {
          telemetry.scheduling!.deduplicatedCount += 1
          duplicateOf.set(id, primaryCallId)
          return
        }
        primaryByFingerprint.set(key, id)
        const remainingMs = Math.max(0, toolLoopDeadline - performance.now())
        const timeoutSignal = AbortSignal.timeout(Math.min(TOOL_CALL_TIMEOUT_MS, remainingMs))
        const toolSignal = AbortSignal.any([requestSignal, timeoutSignal])
        const startedAt = new Date().toISOString()
        const startedMs = performance.now()
        telemetry.scheduling!.dispatchedCount += 1
        try {
          if (toolSignal.aborted) throw new Error('aborted')
          const result = await executeTool(scoped, toolSignal)
          if (toolSignal.aborted) throw new Error('aborted')
          results.set(id, result)
          if (scoped.name === 'lookup_pubchem_profile' && result.operation === 'pubchem' && result.status === 'ok') {
            const canonicalSmiles = result.data.canonical_smiles
            if (typeof canonicalSmiles === 'string' && canonicalSmiles) canonicalSmilesByChemical.set(scoped.chemical.toLowerCase(), canonicalSmiles)
          }
          const diagnostic = diagnosticForResult(call, result)
          if (diagnostic.status === 'completed') appendToolComplete(call, result)
          else {
            const retrievalAttempt = retrievalAttemptTelemetry(call, result)
            if (retrievalAttempt) telemetry.retrievalAttempts = [...(telemetry.retrievalAttempts ?? []), retrievalAttempt].slice(-5)
          }
          emitDiagnostic(call, round, validatedArguments, diagnostic, {
            dispatchBudgetMs: Math.round(remainingMs),
            startedAt,
            elapsedMs: Math.round(performance.now() - startedMs),
          })
        } catch (error) {
          console.error('Scoped tool execution failed', { turnId, callId: call.id, tool: call.name, error })
          const abortReason = signal?.aborted ? 'client' : (timeoutSignal.aborted || performance.now() >= toolLoopDeadline ? 'deadline' : null)
          const diagnostic = diagnosticForFailure({ tool: call.name as ToolName, source: sourceForTool(call.name as ToolName), abortReason })
          results.set(id, failureResult(call, diagnostic.userNote))
          emitDiagnostic(call, round, validatedArguments, diagnostic, {
            dispatchBudgetMs: Math.round(remainingMs),
            startedAt,
            elapsedMs: Math.round(performance.now() - startedMs),
          })
        }
      }))
    }

    const firstWave = [...prevalidated.keys()].filter(id => !dependent.has(id))
    await executeWave(firstWave)
    const secondWave = [...prevalidated.keys()].filter(id => dependent.has(id))
    await executeWave(secondWave)
    for (const [id, primaryCallId] of duplicateOf) {
      const call = toolCalls.find(item => item.id === id)!
      const primaryResult = results.get(primaryCallId)
      if (!primaryResult) continue
      results.set(id, primaryResult)
      const scoped = prevalidated.get(id)!
      const validatedArguments = Object.fromEntries(Object.entries(scoped).filter(([key]) => key !== 'id' && key !== 'name'))
      const diagnostic = diagnosticForResult(call, primaryResult)
      if (diagnostic.status === 'completed') appendToolComplete(call, primaryResult)
      emitDiagnostic(call, round, validatedArguments, diagnostic, {
        telemetry: { deduplicatedFromCallId: primaryCallId },
      })
    }
    for (const call of toolCalls) {
      const result = results.get(call.id) ?? failureResult(call, 'The tool could not complete the request.')
      conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) })
    }
  }

  throw new Error('Model did not provide a final answer')
}
