import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseScopedToolCall, runScopedToolChat } from '@/lib/talk-about-this/agent'
import type { ChatProvider } from '@/lib/talk-about-this/chat-provider'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import { hashProcedureText } from '@/lib/talk-about-this/procedure-edit'
import { executeProposalTool, proposalFromResult, proposalResultForModel } from '@/lib/talk-about-this/proposals'
import type { ProposalToolCall } from '@/lib/talk-about-this/tools'

const repository = vi.hoisted(() => ({
  loadOwnedAnalysis: vi.fn(),
  createProcedureProposal: vi.fn(),
}))
vi.mock('@/lib/talk-about-this/repository', () => repository)

const savedProtocol = [
  '1. Dissolve the amine (2.0 g) in 20 mL DMF.',
  '2. Add EDC (1.2 equiv) and stir for 2 h at room temperature.',
  '3. Wash with 30 mL dichloromethane.',
].join('\n')

const conversation = {
  id: 'conversation-1',
  analysis_id: 'analysis-1',
  scope: { kind: 'principle', principleNumber: 5 } as const,
}

function call(edits: ProposalToolCall['edits'], summary = 'Swap the solvent'): ProposalToolCall {
  return { id: 'call-1', name: 'propose_procedure_edit', summary, edits }
}

const swap = { find: '20 mL DMF', replace: '20 mL Cyrene', rationale: 'Less hazardous solvent' }

beforeEach(() => {
  vi.clearAllMocks()
  repository.loadOwnedAnalysis.mockResolvedValue({ id: 'analysis-1', protocol_text: savedProtocol, analysis_result: {}, revision_number: 3 })
  repository.createProcedureProposal.mockResolvedValue({ proposalId: 'proposal-1', baseRevisionNumber: 3 })
})

describe('executeProposalTool', () => {
  it('stores a validated proposal against the hash of the saved text and reports it as not applied', async () => {
    const result = await executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: call([swap]) })

    expect(repository.loadOwnedAnalysis).toHaveBeenCalledWith(expect.anything(), 'user-1', 'analysis-1')
    expect(repository.createProcedureProposal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      conversationId: 'conversation-1',
      summary: 'Swap the solvent',
      baseTextHash: hashProcedureText(savedProtocol),
      proposedText: savedProtocol.replace('20 mL DMF', '20 mL Cyrene'),
      diff: expect.stringContaining('+1. Dissolve the amine (2.0 g) in 20 mL Cyrene.'),
    }))
    expect(result).toMatchObject({ operation: 'procedure_proposal', status: 'ok', data: { status: 'proposed_not_applied' } })
    expect(proposalFromResult(result)).toMatchObject({ proposalId: 'proposal-1', baseRevisionNumber: 3, summary: 'Swap the solvent' })
  })

  it('validates against the FULL saved procedure, not the truncated chat snapshot', async () => {
    const filler = Array.from({ length: 500 }, (_, index) => `Step ${index}: stir gently for 5 minutes.`).join('\n')
    repository.loadOwnedAnalysis.mockResolvedValue({ id: 'analysis-1', protocol_text: `${filler}\nLast: wash with dichloromethane.`, revision_number: 1 })

    const result = await executeProposalTool({
      supabase: {} as never,
      userId: 'user-1',
      conversation,
      call: call([{ find: 'wash with dichloromethane', replace: 'wash with ethyl acetate', rationale: 'Safer' }]),
    })

    expect(result.status).toBe('ok')
  })

  it.each([
    ['zero matches', [{ ...swap, find: '25 mL DMF' }], 'does not appear'],
    ['multiple matches', [{ ...swap, find: 'mL' }], 'more than once'],
    ['overlapping edits', [swap, { ...swap, find: 'mL DMF.' }], 'overlapping'],
  ])('stores nothing and tells the model why for %s', async (_name, edits, reason) => {
    const result = await executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: call(edits) })

    expect(repository.createProcedureProposal).not.toHaveBeenCalled()
    expect(result).toMatchObject({ operation: 'procedure_proposal', status: 'not_found', data: { status: 'not_proposed' } })
    expect(result.warnings[0]).toContain(reason)
    expect(proposalFromResult(result)).toBeNull()
  })

  it('stores nothing when the edited procedure would exceed the size limit', async () => {
    repository.loadOwnedAnalysis.mockResolvedValue({ id: 'analysis-1', protocol_text: `${'a'.repeat(49_990)} MARKER`, revision_number: 1 })

    const result = await executeProposalTool({
      supabase: {} as never,
      userId: 'user-1',
      conversation,
      call: call([{ find: 'MARKER', replace: 'x'.repeat(200), rationale: 'r' }]),
    })

    expect(repository.createProcedureProposal).not.toHaveBeenCalled()
    expect(result.warnings[0]).toContain('50,000')
  })

  it('refuses a read-only conversation without touching the database', async () => {
    const result = await executeProposalTool({
      supabase: {} as never,
      userId: 'user-1',
      conversation: { ...conversation, scope: { kind: 'recommendation', recommendationIndex: 0, readOnly: true } },
      call: call([swap]),
    })

    expect(result.status).toBe('unavailable')
    expect(repository.loadOwnedAnalysis).not.toHaveBeenCalled()
    expect(repository.createProcedureProposal).not.toHaveBeenCalled()
  })

  it('reports an unavailable analysis instead of inventing a proposal', async () => {
    repository.loadOwnedAnalysis.mockResolvedValue(null)

    const result = await executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: call([swap]) })

    expect(result.status).toBe('unavailable')
    expect(repository.createProcedureProposal).not.toHaveBeenCalled()
  })

  it('does not swallow a failed store: the caller sees the error, so no proposal is claimed', async () => {
    repository.createProcedureProposal.mockRejectedValue(new Error('rpc failed'))

    await expect(executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: call([swap]) })).rejects.toThrow('rpc failed')
  })
})

describe('proposalResultForModel', () => {
  it('shows the model the identity and the not-applied notice but neither the diff nor the full text', async () => {
    const result = await executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: call([swap]) })
    const forModel = JSON.stringify(proposalResultForModel(result))

    expect(forModel).toContain('proposal-1')
    expect(forModel).toContain('PROPOSED, NOT APPLIED')
    expect(forModel).toContain('creates a new analysis and uses one analysis run')
    expect(forModel).not.toContain('proposedText')
    expect(forModel).not.toContain('Cyrene')
    expect(forModel).not.toContain('@@')
  })

  it('passes other results through unchanged', () => {
    const lookup = { operation: 'chem21' as const, chemical_name: 'DMF', status: 'ok' as const, source: 'CHEM21', data: {}, citations: [], warnings: [] }

    expect(proposalResultForModel(lookup)).toBe(lookup)
  })
})

describe('parseScopedToolCall propose_procedure_edit', () => {
  const context = {
    protocolTitle: 't',
    protocolText: savedProtocol,
    scope: { kind: 'principle', principleNumber: 5 },
    steps: [],
    recommendations: [],
    scores: [],
    citations: [],
    contextHash: 'h',
    noDirectEvidence: true,
  } as unknown as TalkAboutContext

  function parse(args: unknown, scopedContext: TalkAboutContext = context) {
    return parseScopedToolCall(scopedContext, { id: 'c', name: 'propose_procedure_edit', arguments: JSON.stringify(args) }, new Map())
  }

  it('accepts a bounded summary and edits', () => {
    expect(parse({ summary: ' Swap solvent ', edits: [swap] })).toEqual({ id: 'c', name: 'propose_procedure_edit', summary: 'Swap solvent', edits: [swap] })
  })

  it.each([
    ['no edits', { summary: 's', edits: [] }],
    ['eleven edits', { summary: 's', edits: Array.from({ length: 11 }, () => swap) }],
    ['missing rationale', { summary: 's', edits: [{ find: 'a', replace: 'b' }] }],
    ['unknown edit key', { summary: 's', edits: [{ ...swap, extra: 1 }] }],
    ['unknown top-level key', { summary: 's', edits: [swap], force: true }],
    ['non-string find', { summary: 's', edits: [{ ...swap, find: 3 }] }],
    ['oversized find', { summary: 's', edits: [{ ...swap, find: 'x'.repeat(4_001) }] }],
    ['empty summary', { summary: ' ', edits: [swap] }],
    ['oversized summary', { summary: 'x'.repeat(301), edits: [swap] }],
  ])('rejects %s', (_name, args) => {
    expect(() => parse(args)).toThrow()
  })

  it('rejects the tool in a read-only scope and in a context with no scope', () => {
    const readOnly = { ...context, scope: { kind: 'recommendation', recommendationIndex: 0, readOnly: true } } as unknown as TalkAboutContext
    const noScope = { ...context, scope: undefined } as unknown as TalkAboutContext

    expect(() => parse({ summary: 's', edits: [swap] }, readOnly)).toThrow('read-only')
    expect(() => parse({ summary: 's', edits: [swap] }, noScope)).toThrow('read-only')
  })
})

describe('runScopedToolChat with a procedure proposal', () => {
  const context = {
    protocolTitle: 't',
    protocolText: savedProtocol,
    scope: { kind: 'principle', principleNumber: 5 },
    steps: [{ stepNumber: 1, description: 'd', chemicals: [{ name: 'DMF', role: 'solvent' }] }],
    recommendations: [],
    scores: [],
    citations: [],
    contextHash: 'h',
    noDirectEvidence: true,
  } as unknown as TalkAboutContext

  interface RecordedRequest {
    messages: Array<{ role: string; content?: string }>
    tools: Array<{ function: { name: string } }>
  }

  function providerThatProposes(requests: RecordedRequest[]): ChatProvider {
    return {
      async *stream(request) {
        requests.push({ messages: request.messages as RecordedRequest['messages'], tools: request.tools ?? [] })
        if (requests.length === 1) {
          yield { toolCalls: [{ id: 'p-1', name: 'propose_procedure_edit', arguments: JSON.stringify({ summary: 'Swap the solvent', edits: [swap] }) }] }
          return
        }
        yield { text: 'I prepared a change for your review.' }
      },
    }
  }

  it('emits a procedure-proposal event with the server diff and keeps the full text away from the model', async () => {
    const requests: RecordedRequest[] = []
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const diagnostics: Array<{ toolName: string; validatedArguments: Record<string, unknown>; status: string }> = []

    await runScopedToolChat({
      provider: providerThatProposes(requests),
      context,
      messages: [{ role: 'user', content: 'Swap DMF for Cyrene in the procedure.' }],
      executeTool: (toolCall) => executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: toolCall as ProposalToolCall }),
      onToolRun: async input => { diagnostics.push(input) },
      onEvent: (event, data) => events.push({ event, data }),
    })

    const proposal = events.find(event => event.event === 'procedure-proposal')
    expect(proposal?.data).toMatchObject({
      proposalId: 'proposal-1',
      summary: 'Swap the solvent',
      baseRevisionNumber: 3,
      diff: expect.stringContaining('+1. Dissolve the amine (2.0 g) in 20 mL Cyrene.'),
      proposedText: expect.stringContaining('Cyrene'),
    })
    const toolMessage = requests[1].messages.find(message => message.role === 'tool')
    expect(toolMessage?.content).toContain('PROPOSED, NOT APPLIED')
    expect(toolMessage?.content).not.toContain('proposedText')
    expect(diagnostics[0]).toMatchObject({ toolName: 'propose_procedure_edit', status: 'completed', validatedArguments: { summary: 'Swap the solvent', editCount: 1 } })
    expect(JSON.stringify(diagnostics)).not.toContain('Cyrene')
  })

  it('reports an edit that could not be matched as a failed lookup with plain wording, and emits no proposal', async () => {
    const requests: unknown[] = []
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream(request) {
        requests.push(request)
        if (requests.length === 1) {
          yield { toolCalls: [{ id: 'p-1', name: 'propose_procedure_edit', arguments: JSON.stringify({ summary: 's', edits: [{ ...swap, find: 'nonexistent text' }] }) }] }
          return
        }
        yield { text: 'That passage is not in the procedure.' }
      },
    }

    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Edit it.' }],
      executeTool: (toolCall) => executeProposalTool({ supabase: {} as never, userId: 'user-1', conversation, call: toolCall as ProposalToolCall }),
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(events.some(event => event.event === 'procedure-proposal')).toBe(false)
    expect(events.find(event => event.event === 'tool-failed')?.data).toMatchObject({
      tool: 'propose_procedure_edit',
      userNote: 'The proposed edit could not be matched to the saved procedure.',
    })
    expect(JSON.stringify(requests[1])).toContain('does not appear in the saved procedure')
  })

  it('stays unavailable in a read-only scope: the model cannot even call the tool', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const readOnly = { ...context, scope: { kind: 'recommendation', recommendationIndex: 0, readOnly: true } } as unknown as TalkAboutContext
    const requests: RecordedRequest[] = []
    const executeTool = vi.fn()

    await runScopedToolChat({
      provider: providerThatProposes(requests),
      context: readOnly,
      messages: [{ role: 'user', content: 'Edit it.' }],
      executeTool,
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(executeTool).not.toHaveBeenCalled()
    expect(events.some(event => event.event === 'procedure-proposal')).toBe(false)
    expect(requests[0].tools.map(tool => tool.function.name)).not.toContain('propose_procedure_edit')
  })
})
