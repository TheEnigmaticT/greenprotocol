import { describe, expect, it, vi } from 'vitest'
import { parseScopedToolCall, runScopedToolChat } from '@/lib/talk-about-this/agent'
import type { ChatProvider } from '@/lib/talk-about-this/chat-provider'
import type { TalkAboutContext } from '@/lib/talk-about-this/context'
import type { ToolResult } from '@/lib/talk-about-this/tools'

const context = {
  protocolTitle: 'DMF scope',
  protocolText: 'Use DMF.',
  steps: [{ stepNumber: 1, description: 'Dissolve substrate in DMF.', chemicals: [{ name: 'DMF', role: 'solvent' }] }],
  recommendations: [],
  scores: [],
  citations: [],
  contextHash: 'test-context',
  noDirectEvidence: true,
} as unknown as TalkAboutContext

const chem21Result: ToolResult = {
  operation: 'chem21',
  chemical_name: 'DMF',
  status: 'ok',
  source: 'CHEM21',
  data: { classification: 'hazardous' },
  citations: [{ source_id: 'chem21:prat', source_name: 'CHEM21', citation: 'Prat et al.' }],
  warnings: [],
}

describe('parseScopedToolCall literature boundary', () => {
  it('accepts a scoped bounded query and rejects an oversized query', () => {
    expect(parseScopedToolCall(context, {
      id: 'lit-1',
      name: 'search_scoped_literature_evidence',
      arguments: JSON.stringify({ query: 'DMF replacement comparison', signalGroups: ['comparison'] }),
    }, new Map())).toEqual({
      id: 'lit-1',
      name: 'search_scoped_literature_evidence',
      query: 'DMF replacement comparison',
      signalGroups: ['comparison'],
    })

    expect(() => parseScopedToolCall(context, {
      id: 'lit-2',
      name: 'search_scoped_literature_evidence',
      arguments: JSON.stringify({ query: 'x'.repeat(501) }),
    }, new Map())).toThrow('500')
  })
})

describe('runScopedToolChat', () => {
  it('executes only validated scoped calls, returns the result to Qwen, and emits lifecycle events', async () => {
    const requests: unknown[] = []
    const provider: ChatProvider = {
      async *stream(request) {
        requests.push(request)
        if (requests.length === 1) {
          yield {
            toolCalls: [{
              id: 'tool-1',
              name: 'lookup_chem21_solvent',
              arguments: JSON.stringify({ chemical: 'DMF' }),
            }],
          }
          return
        }
        yield { text: 'CHEM21 classifies DMF as hazardous.' }
      },
    }
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const executeTool = async () => chem21Result

    const answer = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'What does CHEM21 say about DMF?' }],
      executeTool,
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(answer.answer).toBe('CHEM21 classifies DMF as hazardous.')
    expect(events.map(event => event.event)).toEqual([
      'activity',
      'tool-start',
      'tool-complete',
      'activity',
      'delta',
    ])
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', toolCalls: [expect.objectContaining({ id: 'tool-1' })] }),
        expect.objectContaining({ role: 'tool', toolCallId: 'tool-1', content: expect.stringContaining('hazardous') }),
      ]),
    })
  })

  it('records initial and final provider first text separately and carries retrieval timing in tool activity', async () => {
    let requests = 0
    let clock = 100
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield { text: 'I will check the literature. ' }
          yield {
            toolCalls: [{
              id: 'lit-1',
              name: 'search_scoped_literature_evidence',
              arguments: JSON.stringify({ query: 'DMF comparison' }),
            }],
          }
          return
        }
        yield { text: 'The evidence is available.' }
      },
    }

    const result = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Compare DMF.' }],
      executeTool: async () => ({
        operation: 'literature_evidence',
        chemical_name: '',
        status: 'ok',
        source: 'Literature evidence index',
        data: { evidence: [] },
        telemetry: {
          embeddingStartedAt: 110,
          embeddingFinishedAt: 120,
          rpcStartedAt: 130,
          rpcFinishedAt: 140,
        },
        citations: [],
        warnings: [],
      }),
      onEvent: (event, data) => events.push({ event, data }),
      now: () => clock += 100,
    })

    expect(result.telemetry).toMatchObject({
      initialProviderFirstTextAt: 200,
      retrievalAttempts: [{
        callId: 'lit-1',
        status: 'complete',
        embeddingStartedAt: 110,
        embeddingFinishedAt: 120,
        rpcStartedAt: 130,
        rpcFinishedAt: 140,
      }],
      finalProviderFirstTextAt: 300,
      scheduling: { requestedCount: 1, dispatchedCount: 1, deduplicatedCount: 0 },
    })
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-complete',
      data: expect.objectContaining({
        telemetry: {
          embeddingStartedAt: 110,
          embeddingFinishedAt: 120,
          rpcStartedAt: 130,
          rpcFinishedAt: 140,
        },
      }),
    }))
  })

  it('keeps each literature retrieval attempt atomic when a later attempt aborts', async () => {
    let requests = 0
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests <= 2) {
          yield {
            toolCalls: [{
              id: `lit-${requests}`,
              name: 'search_scoped_literature_evidence',
              arguments: JSON.stringify({ query: 'DMF comparison' }),
            }],
          }
          return
        }
        yield { text: 'Final answer.' }
      },
    }
    let calls = 0

    const result = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Compare DMF.' }],
      executeTool: async () => {
        calls += 1
        return {
          operation: 'literature_evidence',
          chemical_name: '',
          status: calls === 1 ? 'ok' : 'unavailable',
          source: 'Literature evidence index',
          data: { evidence: [] },
          citations: [],
          warnings: calls === 1 ? [] : ['Literature evidence retrieval aborted'],
          telemetry: calls === 1
            ? { embeddingStartedAt: 10, embeddingFinishedAt: 20, rpcStartedAt: 30, rpcFinishedAt: 40 }
            : { embeddingStartedAt: 100 },
        }
      },
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(result.telemetry.retrievalAttempts).toEqual([
      {
        callId: 'lit-1',
        status: 'complete',
        embeddingStartedAt: 10,
        embeddingFinishedAt: 20,
        rpcStartedAt: 30,
        rpcFinishedAt: 40,
      },
      {
        callId: 'lit-2',
        status: 'aborted',
        embeddingStartedAt: 100,
      },
    ])
    expect(events.filter(({ event }) => event === 'tool-failed').at(-1)).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        callId: 'lit-2',
        status: 'failed',
        reasonCode: 'tool_error',
      }),
    }))
  })
  it('promotes first text only from the final provider pass after multiple tool rounds', async () => {
    let requests = 0
    let clock = 100
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests < 3) {
          yield { text: `Working round ${requests}. ` }
          yield {
            toolCalls: [{
              id: `tool-${requests}`,
              name: 'lookup_chem21_solvent',
              arguments: JSON.stringify({ chemical: 'DMF' }),
            }],
          }
          return
        }
        yield { text: 'Final answer.' }
      },
    }

    const result = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => chem21Result,
      onEvent: () => undefined,
      now: () => clock += 100,
    })

    expect(result.telemetry).toMatchObject({
      initialProviderFirstTextAt: 200,
      finalProviderFirstTextAt: 400,
      scheduling: { requestedCount: 1, dispatchedCount: 1, deduplicatedCount: 0 },
    })
  })

  it('caps each model turn at three tool calls and returns unavailable results for excess calls', async () => {
    let requests = 0
    let executions = 0
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield {
            toolCalls: [0, 1, 2, 3].map(index => ({
              id: `tool-${index}`,
              name: 'lookup_chem21_solvent' as const,
              arguments: JSON.stringify({ chemical: 'DMF' }),
            })),
          }
          return
        }
        yield { text: 'The scoped result is available.' }
      },
    }
    const events: Array<{ event: string; data: Record<string, unknown> }> = []

    await expect(runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => {
        executions += 1
        return chem21Result
      },
      onEvent: (event, data) => events.push({ event, data }),
    })).resolves.toMatchObject({ answer: 'The scoped result is available.' })

    expect(executions).toBe(1)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({ callId: 'tool-3', status: 'skipped_limit', reasonCode: 'call_limit_exceeded' }),
    }))
  })

  it('returns an unavailable tool result for an out-of-scope request without invoking the executor', async () => {
    let requests = 0
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield { toolCalls: [{ id: 'tool-1', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'benzene' }) }] }
          return
        }
        yield { text: 'That chemical is outside the scoped discussion.' }
      },
    }
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const executeTool = async () => {
      throw new Error('must not execute')
    }

    await expect(runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'What about benzene?' }],
      executeTool,
      onEvent: (event, data) => events.push({ event, data }),
    })).resolves.toMatchObject({ answer: expect.stringContaining('outside the scoped discussion') })

    expect(events).toContainEqual(expect.objectContaining({ event: 'tool-failed' }))
  })

  it('requires a scoped PubChem result before screening and does not invoke the executor first', async () => {
    let requests = 0
    let executions = 0
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield {
            toolCalls: [{
              id: 'screen-1',
              name: 'screen_solvent_candidates',
              arguments: JSON.stringify({ solute: 'DMF', currentSolvent: 'DMF', temperatureK: 298.15 }),
            }],
          }
          return
        }
        yield { text: 'Resolve DMF with PubChem first.' }
      },
    }

    await expect(runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Screen replacements for DMF.' }],
      executeTool: async () => {
        executions += 1
        return chem21Result
      },
      onEvent: (event, data) => events.push({ event, data }),
    })).resolves.toMatchObject({ answer: 'Resolve DMF with PubChem first.' })

    expect(executions).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({
        callId: 'screen-1',
        status: 'failed',
        reasonCode: 'tool_error',
      }),
    }))
  })

  it('passes only the canonical SMILES received from the scoped PubChem result to screening', async () => {
    let requests = 0
    const executed: unknown[] = []
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield {
            toolCalls: [{
              id: 'pubchem-1',
              name: 'lookup_pubchem_profile',
              arguments: JSON.stringify({ chemical: 'DMF' }),
            }],
          }
          return
        }
        if (requests === 2) {
          yield {
            toolCalls: [{
              id: 'screen-1',
              name: 'screen_solvent_candidates',
              arguments: JSON.stringify({ solute: 'DMF', currentSolvent: 'DMF', temperatureK: 298.15 }),
            }],
          }
          return
        }
        yield { text: 'The screening result is available.' }
      },
    }
    const pubchemResult = {
      operation: 'pubchem',
      chemical_name: 'DMF',
      status: 'ok',
      source: 'PubChem',
      data: { canonical_smiles: 'CN(C)C=O' },
      citations: [],
      warnings: [],
    } as ToolResult

    await expect(runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Screen replacements for DMF.' }],
      executeTool: async call => {
        executed.push(call)
        return call.name === 'lookup_pubchem_profile' ? pubchemResult : chem21Result
      },
      onEvent: () => {},
    })).resolves.toMatchObject({ answer: 'The screening result is available.' })

    expect(executed).toHaveLength(2)
    expect(executed[1]).toMatchObject({
      name: 'screen_solvent_candidates',
      solute: 'DMF',
      currentSolvent: 'DMF',
      temperatureK: 298.15,
      canonicalSoluteSmiles: 'CN(C)C=O',
    })
    expect(executed[1]).not.toHaveProperty('soluteSmiles')
  })
})

describe('literature evidence propagation', () => {
  it('keeps visible pre-tool text in the terminal answer and authorizes retrieved evidence citations next round', async () => {
    let requests = 0
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream(request) {
        requests += 1
        if (requests === 1) {
          yield { text: 'I will check the literature. ' }
          yield {
            toolCalls: [{
              id: 'lit-1',
              name: 'search_scoped_literature_evidence',
              arguments: JSON.stringify({ query: 'DMF replacement comparison', signalGroups: ['comparison'] }),
            }],
          }
          return
        }
        expect(request.system).toContain('doi:p3:u1')
        yield { text: 'The retrieved evidence is candidate_pending_adjudication.' }
      },
    }

    const result = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Compare DMF replacements.' }],
      executeTool: async () => ({
        operation: 'literature_evidence',
        chemical_name: '',
        status: 'ok',
        source: 'Literature evidence index',
        data: {
          evidence: [{
            id: 'doi:p3:u1',
            sourceDocumentId: 'doi:p3',
            doi: '10.1000/example',
            title: 'A source',
            pageStart: 3,
            pageEnd: 3,
            quote: 'DMF comparison.',
            applicability: 'DMF replacement',
            limitations: 'Candidate evidence only.',
            candidateStatus: 'candidate_pending_adjudication',
            similarity: 0.98,
          }],
        },
        citations: [{ source_id: 'doi:p3:u1', source_name: 'A source', citation: 'A source. pp. 3–3.', doi: '10.1000/example' }],
        warnings: [],
      }),
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(result.answer).toBe('I will check the literature. The retrieved evidence is candidate_pending_adjudication.')
    expect(result.citations).toContainEqual(expect.objectContaining({ source_id: 'doi:p3:u1' }))
    expect(result.evidence).toContainEqual(expect.objectContaining({
      id: 'doi:p3:u1',
      candidateStatus: 'candidate_pending_adjudication',
      pageStart: 3,
    }))
    expect(events.find(event => event.event === 'delta')).toMatchObject({
      data: { text: 'I will check the literature. ' },
    })
    expect(events.find(event => event.event === 'tool-complete')).toMatchObject({
      data: { evidence: [expect.objectContaining({ id: 'doi:p3:u1', pageStart: 3 })] },
    })
  })
  it('reports an aborted literature lookup as tool-failed', async () => {
    let requests = 0
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield {
            toolCalls: [{
              id: 'lit-abort',
              name: 'search_scoped_literature_evidence',
              arguments: JSON.stringify({ query: 'DMF comparison' }),
            }],
          }
          return
        }
        yield { text: 'Literature evidence was unavailable.' }
      },
    }

    const result = await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Compare DMF.' }],
      executeTool: async () => {
        throw new Error('literature request aborted')
      },
      onEvent: (event, data) => events.push({ event, data }),
    })

    expect(result.answer).toBe('Literature evidence was unavailable.')
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({ callId: 'lit-abort', status: 'failed', reasonCode: 'tool_error' }),
    }))
  })

  it('starts RDKit with PubChem while keeping same-round screening dependent', async () => {
    const order: string[] = []
    let pass = 0
    let releasePubChem: (() => void) | undefined
    const pubChem = new Promise<void>(resolve => { releasePubChem = resolve })
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield {
            toolCalls: [
              { id: 'pubchem', name: 'lookup_pubchem_profile', arguments: JSON.stringify({ chemical: 'DMF' }) },
              { id: 'rdkit', name: 'calculate_rdkit_properties', arguments: JSON.stringify({ chemical: 'DMF' }) },
              { id: 'screen', name: 'screen_solvent_candidates', arguments: JSON.stringify({ solute: 'DMF', currentSolvent: 'DMF', temperatureK: 298.15 }) },
            ],
          }
          return
        }
        yield { text: 'Done.' }
      },
    }
    const pending = runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async call => {
        order.push(`start:${call.name}`)
        if (call.name === 'lookup_pubchem_profile') await pubChem
        order.push(`end:${call.name}`)
        return call.name === 'lookup_pubchem_profile'
          ? { ...chem21Result, operation: 'pubchem', data: { canonical_smiles: 'CN(C)C=O' } }
          : chem21Result
      },
      onEvent: () => undefined,
    })
    await vi.waitFor(() => expect(order).toContain('start:lookup_pubchem_profile'))
    expect(order).toContain('start:calculate_rdkit_properties')
    expect(order).not.toContain('start:screen_solvent_candidates')
    releasePubChem!()
    await pending
    expect(order.indexOf('start:screen_solvent_candidates')).toBeGreaterThan(order.indexOf('end:lookup_pubchem_profile'))
  })

  it('defers same-round screening and solubility evidence until PubChem supplies canonical SMILES', async () => {
    const executed: unknown[] = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield {
            toolCalls: [
              { id: 'pubchem', name: 'lookup_pubchem_profile', arguments: JSON.stringify({ chemical: 'DMF' }) },
              { id: 'screen', name: 'screen_solvent_candidates', arguments: JSON.stringify({ solute: 'DMF', currentSolvent: 'DMF', temperatureK: 298.15 }) },
              { id: 'solubility', name: 'lookup_experimental_solvent_evidence', arguments: JSON.stringify({ mode: 'single_solubility', solute: 'DMF', solvent: 'DMF', temperatureK: 298.15 }) },
            ],
          }
          return
        }
        yield { text: 'Done.' }
      },
    }
    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Screen DMF.' }],
      executeTool: async call => {
        executed.push(call)
        return call.name === 'lookup_pubchem_profile'
          ? { ...chem21Result, operation: 'pubchem', data: { canonical_smiles: 'CN(C)C=O' } }
          : chem21Result
      },
      onEvent: () => undefined,
    })
    expect(executed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'screen', canonicalSoluteSmiles: 'CN(C)C=O' }),
      expect.objectContaining({ id: 'solubility', canonicalSoluteSmiles: 'CN(C)C=O' }),
    ]))
  })

  it('discards a result that resolves after client cancellation', async () => {
    const controller = new AbortController()
    const events: Array<{ event: string, data: Record<string, unknown> }> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield { toolCalls: [{ id: 'late', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) }] }
          return
        }
        yield { text: 'Cancelled.' }
      },
    }
    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      signal: controller.signal,
      executeTool: async () => {
        controller.abort()
        return chem21Result
      },
      onEvent: (event, data) => events.push({ event, data }),
    })
    expect(events).not.toContainEqual(expect.objectContaining({
      event: 'tool-complete',
      data: expect.objectContaining({ callId: 'late' }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({ callId: 'late', status: 'cancelled', reasonCode: 'client_cancelled' }),
    }))
  })

  it('continues to the next provider round when diagnostic persistence never resolves', async () => {
    let requests = 0
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield { toolCalls: [{ id: 'chem21', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) }] }
          return
        }
        yield { text: 'Done.' }
      },
    }
    const pending = runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => chem21Result,
      onEvent: () => undefined,
      turnId: 'turn-stalled-diagnostic',
      onToolRun: async () => new Promise<void>(() => undefined),
    })

    await vi.waitFor(() => expect(requests).toBe(2))
    await expect(pending).resolves.toMatchObject({ answer: 'Done.' })
  })

  it('continues after diagnostic persistence rejects without logging the error payload', async () => {
    const error = new Error('secret-token=abc123')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let requests = 0
    const provider: ChatProvider = {
      async *stream() {
        requests += 1
        if (requests === 1) {
          yield { toolCalls: [{ id: 'chem21', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) }] }
          return
        }
        yield { text: 'Done.' }
      },
    }

    await expect(runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => chem21Result,
      onEvent: () => undefined,
      turnId: 'turn-rejected-diagnostic',
      onToolRun: async () => { throw error },
    })).resolves.toMatchObject({ answer: 'Done.' })
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      'Scoped tool diagnostic callback failed',
      { turnId: 'turn-rejected-diagnostic', callId: 'chem21' },
    ))
    expect(consoleError).not.toHaveBeenCalledWith(
      'Scoped tool diagnostic callback failed',
      expect.objectContaining({ error: expect.anything() }),
    )
  })

  it('persists unsupported tool calls under a fixed safe name', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield { toolCalls: [{ id: 'unsupported', name: 'secret-token=abc123', arguments: '{}' }] }
          return
        }
        yield { text: 'Unsupported request rejected.' }
      },
    }

    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => chem21Result,
      onEvent: () => undefined,
      turnId: 'turn-unsupported',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })

    expect(diagnostics).toContainEqual(expect.objectContaining({
      callId: 'unsupported',
      toolName: 'unsupported_tool',
      reasonCode: 'invalid_request',
    }))
    expect(JSON.stringify(diagnostics)).not.toContain('secret-token')
  })

  it('rounds scheduling diagnostics and treats unavailable results as failed', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    const events: Array<{ event: string, data: Record<string, unknown> }> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield { toolCalls: [{ id: 'unavailable', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) }] }
          return
        }
        yield { text: 'Unavailable.' }
      },
    }
    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => ({ ...chem21Result, status: 'unavailable' }),
      onEvent: (event, data) => events.push({ event, data }),
      turnId: 'turn-rounded',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      status: 'failed',
      reasonCode: 'tool_error',
      dispatchBudgetMs: expect.any(Number),
      elapsedMs: expect.any(Number),
    }))
    const diagnostic = diagnostics[0]
    expect(Number.isInteger(diagnostic.dispatchBudgetMs as number)).toBe(true)
    expect(Number.isInteger(diagnostic.elapsedMs as number)).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({ callId: 'unavailable', status: 'failed', reasonCode: 'tool_error' }),
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      event: 'tool-complete',
      data: expect.objectContaining({ callId: 'unavailable' }),
    }))
  })

  it('preserves a failed primary result for a duplicate diagnostic', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield {
            toolCalls: [
              { id: 'primary', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) },
              { id: 'duplicate', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) },
            ],
          }
          return
        }
        yield { text: 'Unavailable.' }
      },
    }
    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => ({ ...chem21Result, status: 'unavailable' }),
      onEvent: () => undefined,
      turnId: 'turn-duplicate-failed',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })
    expect(diagnostics.find(diagnostic => diagnostic.callId === 'duplicate')).toMatchObject({
      status: 'failed',
      reasonCode: 'tool_error',
      telemetry: { deduplicatedFromCallId: 'primary' },
    })
  })
})

describe('scheduled scoped tool calls', () => {
  it('deduplicates validated calls while preserving original tool-message order', async () => {
    const requests: unknown[] = []
    const diagnostics: Array<Record<string, unknown>> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream(request) {
        requests.push(request)
        pass += 1
        if (pass === 1) {
          yield {
            toolCalls: [
              { id: 'call-b', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) },
              { id: 'call-a', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) },
            ],
          }
          return
        }
        yield { text: 'Done.' }
      },
    }
    const executeTool = vi.fn(async () => chem21Result)

    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool,
      onEvent: () => undefined,
      turnId: 'turn-1',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[1]).toMatchObject({
      callId: 'call-a',
      status: 'completed',
      telemetry: { deduplicatedFromCallId: 'call-b' },
    })
    expect(requests[1]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'tool', toolCallId: 'call-b' }),
        expect.objectContaining({ role: 'tool', toolCallId: 'call-a' }),
      ]),
    })
  })

  it('normalizes unsafe tool failures before events and diagnostics', async () => {
    const events: Array<{ event: string, data: Record<string, unknown> }> = []
    const diagnostics: Array<Record<string, unknown>> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield { toolCalls: [{ id: 'unsafe', name: 'lookup_chem21_solvent', arguments: JSON.stringify({ chemical: 'DMF' }) }] }
          return
        }
        yield { text: 'Unavailable.' }
      },
    }

    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => { throw new Error('secret-token=abc123') },
      onEvent: (event, data) => events.push({ event, data }),
      turnId: 'turn-unsafe',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })

    expect(events.find(({ event }) => event === 'tool-failed')).toMatchObject({
      data: { status: 'failed', reasonCode: 'tool_error', userNote: expect.any(String) },
    })
    expect(JSON.stringify(events)).not.toContain('secret-token')
    expect(JSON.stringify(diagnostics)).not.toContain('secret-token')
  })

  it('classifies a fourth request as a skipped call-limit diagnostic', async () => {
    const diagnostics: Array<Record<string, unknown>> = []
    let pass = 0
    const provider: ChatProvider = {
      async *stream() {
        pass += 1
        if (pass === 1) {
          yield {
            toolCalls: [0, 1, 2, 3].map(index => ({
              id: `limit-${index}`,
              name: 'lookup_chem21_solvent' as const,
              arguments: JSON.stringify({ chemical: 'DMF' }),
            })),
          }
          return
        }
        yield { text: 'Done.' }
      },
    }
    await runScopedToolChat({
      provider,
      context,
      messages: [{ role: 'user', content: 'Check DMF.' }],
      executeTool: async () => chem21Result,
      onEvent: () => undefined,
      turnId: 'turn-limit',
      onToolRun: async diagnostic => { diagnostics.push(diagnostic) },
    })
    expect(diagnostics.find(diagnostic => diagnostic.callId === 'limit-3')).toMatchObject({
      status: 'skipped_limit',
      reasonCode: 'call_limit_exceeded',
    })
  })
})
