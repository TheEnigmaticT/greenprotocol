import { describe, expect, it, vi } from 'vitest'
import { OllamaDecomposedProvider, OLLAMA_PILOT_MODELS } from '../../../lib/decomposed-benchmark/ollama-provider'
import type { JsonCompletionRequest } from '../../../lib/decomposed-benchmark/provider'

const request = (): JsonCompletionRequest => ({ model: OLLAMA_PILOT_MODELS[0], stage: 'fixture', system: 'Do not guess.', user: 'synthetic', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } })
const envelope = (model: string = OLLAMA_PILOT_MODELS[0]) => ({ model, done: true, done_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' }, prompt_eval_count: 4, eval_count: 3 })

describe('OllamaDecomposedProvider (injected transport only)', () => {
  it.each(OLLAMA_PILOT_MODELS)('sends exact schema locally and returns actual identity/usage for %s', async model => {
    const raw = JSON.stringify(envelope(model))
    const fetcher = vi.fn(async () => new Response(raw))
    const provider = new OllamaDecomposedProvider({ fetch: fetcher })
    const req = { ...request(), model }
    const result = await provider.completeJson(req)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }], format: req.schema, stream: false, think: false, options: { temperature: 0, num_predict: 2048, num_ctx: 16384 } })
    expect(result).toMatchObject({ data: { ok: true }, model, stage: 'fixture', provider: 'ollama', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }, costUsd: 0 })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.rawResponse).toBe(raw)
    expect(JSON.stringify(result)).not.toContain('rawResponse')
  })
  it.each(['gemma4', 'qwen', 'hf.co/bartowski/google_gemma-4-31B-it-GGUF:Q4_K_M', 'remote:cloud'])('rejects unapproved identity %s before fetch', async model => {
    const fetcher = vi.fn()
    await expect(new OllamaDecomposedProvider({ fetch: fetcher }).completeJson({ ...request(), model })).rejects.toThrow('MODEL_NOT_ALLOWED')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    ['HTTP_ERROR', 'private failure', 500],
    ['INVALID_ENVELOPE', 'not json', 200],
    ['MODEL_MISMATCH', JSON.stringify(envelope(OLLAMA_PILOT_MODELS[1])), 200],
    ['INCOMPLETE_RESPONSE', JSON.stringify({ ...envelope(), done_reason: 'length' }), 200],
    ['INVALID_JSON', JSON.stringify({ ...envelope(), message: { role: 'assistant', content: '```json\n{}\n```' } }), 200],
    ['INVALID_USAGE', JSON.stringify({ ...envelope(), eval_count: -1 }), 200],
  ])('preserves bounded private raw failure for %s without retry', async (code, raw, status) => {
    const fetcher = vi.fn(async () => new Response(raw, { status }))
    const provider = new OllamaDecomposedProvider({ fetch: fetcher })
    const error = await provider.completeJson(request()).catch(e => e)
    expect(error.message).toBe(`Ollama ${code}`)
    expect(error.rawResponse).toBe(raw)
    expect(JSON.stringify(error)).not.toContain(raw)
    await expect(provider.completeJson(request())).rejects.toThrow('HALTED')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('bounds actual bytes even without content-length', async () => {
    const provider = new OllamaDecomposedProvider({ fetch: async () => new Response('abcdefghijk'), maxResponseBytes: 8 })
    const error = await provider.completeJson(request()).catch(e => e)
    expect(error.message).toContain('RESPONSE_TOO_LARGE')
    expect(error.rawResponse).toBe('abcdefgh')
  })
  it('times out stalled bodies and blocks queued calls without retry', async () => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('partial')) } })))
    const provider = new OllamaDecomposedProvider({ fetch: fetcher, timeoutMs: 20 })
    const results = await Promise.allSettled([provider.completeJson(request()), provider.completeJson(request())])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'TIMEOUT', rawResponse: 'partial' } })
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'HALTED' } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('bounds even a fetch implementation that ignores abort', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}))
    await expect(new OllamaDecomposedProvider({ fetch: fetcher, timeoutMs: 20 }).completeJson(request())).rejects.toThrow('TIMEOUT')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('sanitizes transport errors and preserves cause privately', async () => {
    const cause = new Error('private network detail')
    const provider = new OllamaDecomposedProvider({ fetch: async () => { throw cause } })
    const error = await provider.completeJson(request()).catch(e => e)
    expect(error.message).toBe('Ollama TRANSPORT_ERROR')
    expect(error.privateCause).toBe(cause)
    expect(JSON.stringify(error)).not.toContain('private network detail')
  })
  it('snapshots identity and schema before queued transport', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope())))
    const req = request()
    const pending = new OllamaDecomposedProvider({ fetch: fetcher }).completeJson(req)
    req.model = OLLAMA_PILOT_MODELS[1]
    req.schema.required = ['changed']
    expect((await pending).model).toBe(OLLAMA_PILOT_MODELS[0])
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).format.required).toEqual(['ok'])
  })
  it.each([0, -1, Infinity, NaN, 1.5])('rejects invalid bounds %s', bound => {
    expect(() => new OllamaDecomposedProvider({ timeoutMs: bound })).toThrow('INVALID_LIMIT')
    expect(() => new OllamaDecomposedProvider({ maxResponseBytes: bound })).toThrow('INVALID_LIMIT')
  })
})
