import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAnalysis, validateProtocolText, type AnalysisProgressEvent } from '@/lib/run-analysis'
import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'
import type { AnalysisResult, ProgressEvent } from '@/lib/types'

const PROTOCOL = 'Dissolve 2 g of aspirin in 20 mL of ethanol and stir for ten minutes at room temperature.'
const analysis = { protocolTitle: 'Aspirin' } as AnalysisResult
const resultEvent: ProgressEvent = {
  type: 'result',
  data: { id: 'analysis-1', analysis, impactDelta: { co2eSavedKg: 1, hazardousWasteEliminatedKg: 0, carcinogensEliminated: [], waterSavedL: 0, energySavedKwh: 0 }, equivalencies: [] },
}

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

const frame = (event: ProgressEvent) => `data: ${JSON.stringify(event)}\n\n`

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('validateProtocolText', () => {
  it('accepts text at the boundaries and rejects just outside them', () => {
    expect(validateProtocolText('x'.repeat(20))).toBeNull()
    expect(validateProtocolText('x'.repeat(MAX_PROTOCOL_CHARS))).toBeNull()
    expect(validateProtocolText('x'.repeat(19))?.code).toBe('protocol_too_short')
    expect(validateProtocolText('x'.repeat(MAX_PROTOCOL_CHARS + 1))?.code).toBe('protocol_too_long')
  })

  it('does not count surrounding whitespace toward the minimum', () => {
    expect(validateProtocolText(`   ${'x'.repeat(10)}   \n\n`)?.code).toBe('protocol_too_short')
  })

  it('names the limit and the current length in the over-long message', () => {
    const error = validateProtocolText('x'.repeat(MAX_PROTOCOL_CHARS + 123))
    expect(error?.message).toContain('50,000')
    expect(error?.message).toContain('50,123')
  })
})

describe('runAnalysis', () => {
  it('rejects an invalid protocol without calling the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await runAnalysis({ protocolText: 'too short' })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'protocol_too_short' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the saved analysis and forwards progress events, including ones split across chunks', async () => {
    const progress: AnalysisProgressEvent = { type: 'phase', phase: 2, message: 'Converting quantities...' }
    const resultFrame = frame(resultEvent)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      ': heartbeat 5.0s\n\n',
      frame(progress),
      resultFrame.slice(0, 25),
      resultFrame.slice(25),
    ])))
    const seen: AnalysisProgressEvent[] = []

    const outcome = await runAnalysis({ protocolText: PROTOCOL, onProgress: event => seen.push(event) })

    expect(seen).toEqual([progress])
    expect(outcome).toMatchObject({ kind: 'completed', analysisId: 'analysis-1', analysis, protocolText: PROTOCOL })
  })

  it('posts the protocol text and the abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([frame(resultEvent)]))
    vi.stubGlobal('fetch', fetchMock)
    const { signal } = new AbortController()

    await runAnalysis({ protocolText: PROTOCOL, signal })

    expect(fetchMock).toHaveBeenCalledWith('/api/analyze', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ protocolText: PROTOCOL }),
      signal,
    }))
  })

  it('reports an unauthorized session so the page can redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'unauthorized' }, 401)))
    expect(await runAnalysis({ protocolText: PROTOCOL })).toEqual({ kind: 'unauthorized' })
  })

  it('shows the real limit when the account has used every analysis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'run_limit_reached', error: 'x', limit: 10 }, 429)))

    const outcome = await runAnalysis({ protocolText: PROTOCOL })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'run_limit_reached', title: "You've used all 10 of your available analyses", action: 'contact' } })
  })

  it('turns a server-side validation reply into friendly copy, never the raw body text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'protocol_too_long', error: 'RAW SERVER TEXT', maxChars: 50_000, actualChars: 70_000 }, 400)))

    const outcome = await runAnalysis({ protocolText: PROTOCOL })

    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.error.message).toContain('70,000')
    expect(JSON.stringify(outcome)).not.toContain('RAW SERVER TEXT')
  })

  it('handles a non-JSON error page from a gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })))

    const outcome = await runAnalysis({ protocolText: PROTOCOL })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'unknown' } })
    expect(JSON.stringify(outcome)).not.toContain('Bad Gateway')
  })

  it.each([
    ['not_chemistry', 'not_chemistry'],
    ['provider_rate_limit', 'provider_rate_limit'],
    ['persist_failed', 'persist_failed'],
  ])('maps a streamed %s error event to its friendly error', async (code, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      frame({ type: 'error', error: 'Analysis failed: connect ECONNREFUSED', code }),
    ])))

    const outcome = await runAnalysis({ protocolText: PROTOCOL })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: expected } })
    expect(JSON.stringify(outcome)).not.toContain('ECONNREFUSED')
  })

  it('treats a streamed error with no code as unknown rather than showing its text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([frame({ type: 'error', error: 'Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY' })])))

    const outcome = await runAnalysis({ protocolText: PROTOCOL })

    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'unknown' } })
    expect(JSON.stringify(outcome)).not.toContain('ANTHROPIC_API_KEY')
  })

  it('reports an interruption when the stream ends without a result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([frame({ type: 'phase', phase: 1, message: 'Parsed' })])))
    expect(await runAnalysis({ protocolText: PROTOCOL })).toEqual({ kind: 'interrupted' })
  })

  it('reports an interruption when the connection drops mid-stream', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame({ type: 'phase', phase: 1, message: 'Parsed' })))
        controller.error(new TypeError('network error'))
      },
    }), { headers: { 'content-type': 'text/event-stream' } })))

    expect(await runAnalysis({ protocolText: PROTOCOL })).toEqual({ kind: 'interrupted' })
  })

  it('reports an interruption when the request itself is aborted or cannot connect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    expect(await runAnalysis({ protocolText: PROTOCOL })).toEqual({ kind: 'interrupted' })
  })

  it('refuses to claim success for a result that was never saved', async () => {
    const unsaved: ProgressEvent = { type: 'result', data: { ...resultEvent.data, id: undefined } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([frame(unsaved)])))

    expect(await runAnalysis({ protocolText: PROTOCOL })).toMatchObject({ kind: 'failed', error: { code: 'persist_failed' } })
  })
})
