import { describe, expect, it } from 'vitest'
import { runScopedToolChat } from '@/lib/talk-about-this/agent'
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
  citations: [{ citation: 'Prat et al.' }],
  warnings: [],
}

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

    expect(answer).toBe('CHEM21 classifies DMF as hazardous.')
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
    })).resolves.toBe('The scoped result is available.')

    expect(executions).toBe(3)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({ callId: 'tool-3', reason: expect.stringContaining('maximum') }),
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
    })).resolves.toContain('outside the scoped discussion')

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
    })).resolves.toBe('Resolve DMF with PubChem first.')

    expect(executions).toBe(0)
    expect(events).toContainEqual(expect.objectContaining({
      event: 'tool-failed',
      data: expect.objectContaining({
        callId: 'screen-1',
        reason: 'Resolve the scoped solute with PubChem before screening',
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
    })).resolves.toBe('The screening result is available.')

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
