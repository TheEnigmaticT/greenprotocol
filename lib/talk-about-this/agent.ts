import type { ChatMessage, ChatProvider, ChatToolCall } from '@/lib/talk-about-this/chat-provider'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import { buildTalkAboutSystemPrompt } from '@/lib/talk-about-this/prompt'
import {
  buildChatTools,
  scopedChemicals,
  type ScopedToolCall,
  type ToolName,
  type ToolResult,
} from '@/lib/talk-about-this/tools'
import type { Citation, EvidenceSignalGroup, LiteratureEvidenceMatch } from '@/lib/types'

export const MAX_TOOL_ROUNDS = 4
export const MAX_TOOL_CALLS_PER_TURN = 3
const TOOL_CALL_TIMEOUT_MS = 5_000
const TOOL_LOOP_TIMEOUT_MS = 12_000
export type ChatLifecycleEvent = 'activity' | 'delta' | 'tool-start' | 'tool-complete' | 'tool-failed'

export interface ScopedToolChatRequest {
  provider: ChatProvider
  context: TalkAboutContext
  messages: ChatMessage[]
  signal?: AbortSignal
  executeTool: (call: ScopedToolCall, signal?: AbortSignal) => Promise<ToolResult>
  onEvent: (event: ChatLifecycleEvent, data: Record<string, unknown>) => void
}

export interface ChatRunResult {
  answer: string
  citations: Citation[]
  evidence: LiteratureEvidenceMatch[]
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

/** Runs a bounded, frozen-context tool loop and never permits arbitrary model-directed I/O. */
export async function runScopedToolChat({
  provider,
  context,
  messages,
  signal,
  executeTool,
  onEvent,
}: ScopedToolChatRequest): Promise<ChatRunResult> {
  const conversation = [...messages]
  const canonicalSmilesByChemical = new Map<string, string>()
  const toolLoopDeadline = Date.now() + TOOL_LOOP_TIMEOUT_MS

  const citationsById = new Map<string, Citation>()
  const evidenceById = new Map<string, LiteratureEvidenceMatch>()
  const answerParts: string[] = []
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const turnText: string[] = []
    let toolCalls: ChatToolCall[] = []
    onEvent('activity', { state: 'thinking', round })

    for await (const event of provider.stream({
      system: buildTalkAboutSystemPrompt(context, citationsById.keys()),
      messages: conversation,
      signal,
      tools: buildChatTools(context),
    })) {
      if (event.text) {
        turnText.push(event.text)
        answerParts.push(event.text)
        onEvent('delta', { text: event.text })
      }
      if (event.toolCalls) toolCalls = event.toolCalls
    }

    if (!toolCalls.length) {
      const answer = answerParts.join('')
      if (!answer) throw new Error('Model returned neither text nor a tool request')
      return {
        answer,
        citations: [...citationsById.values()],
        evidence: [...evidenceById.values()],
      }
    }
    if (round === MAX_TOOL_ROUNDS) throw new Error('Model exceeded the maximum number of tool rounds')

    conversation.push({ role: 'assistant', content: turnText.join(''), toolCalls })
    for (const [index, call] of toolCalls.entries()) {
      onEvent('tool-start', { callId: call.id, tool: call.name })
      let result: ToolResult
      const remainingMs = toolLoopDeadline - Date.now()
      if (index >= MAX_TOOL_CALLS_PER_TURN || remainingMs <= 0) {
        const reason = index >= MAX_TOOL_CALLS_PER_TURN
          ? `Tool request exceeds the maximum of ${MAX_TOOL_CALLS_PER_TURN} calls per response turn`
          : 'Tool execution deadline exceeded'
        result = failureResult(call, reason)
        onEvent('tool-failed', { callId: call.id, tool: call.name, reason })
      } else {
        try {
          const timeoutSignal = AbortSignal.timeout(Math.min(TOOL_CALL_TIMEOUT_MS, remainingMs))
          const toolSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
          const scopedCall = parseScopedToolCall(context, call, canonicalSmilesByChemical)
          result = await executeTool(scopedCall, toolSignal)
          if (scopedCall.name === 'lookup_pubchem_profile' && result.operation === 'pubchem' && result.status === 'ok') {
            const canonicalSmiles = result.data.canonical_smiles
            if (typeof canonicalSmiles === 'string' && canonicalSmiles) {
              canonicalSmilesByChemical.set(scopedCall.chemical.toLowerCase(), canonicalSmiles)
            }
          }
          if (result.operation === 'literature_evidence') {
            const evidence = Array.isArray(result.data.evidence)
              ? result.data.evidence.filter((item): item is LiteratureEvidenceMatch => item !== null && typeof item === 'object'
                && typeof (item as LiteratureEvidenceMatch).id === 'string').slice(0, 5)
              : []
            for (const match of evidence) evidenceById.set(match.id, match)
            for (const citation of result.citations) citationsById.set(citation.source_id, citation)
            onEvent('tool-complete', { ...activityData(call, result), evidence, citations: result.citations.slice(0, 5) })
          } else {
            onEvent('tool-complete', activityData(call, result))
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Tool request failed'
          result = failureResult(call, reason)
          onEvent('tool-failed', { callId: call.id, tool: call.name, reason })
        }
      }
      conversation.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) })
    }
  }

  throw new Error('Model did not provide a final answer')
}
