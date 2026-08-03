import { describe, expect, it, vi } from 'vitest'
import { logDedupTrace, logLLMTrace } from '@/lib/trace'

describe('logLLMTrace', () => {
  it('persists the analysis run that produced the trace', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    }

    await logLLMTrace({
      analysis_id: undefined,
      analysis_run_id: 'run-123',
      user_id: 'user-123',
      call_label: 'parse',
      model: 'Qwen/Qwen3-32B',
      phase: 'parse',
      started_at: '2026-08-01T00:00:00.000Z',
      completed_at: '2026-08-01T00:00:01.000Z',
      latency_ms: 1000,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      request_payload: {},
      response_payload: {},
      stop_reason: 'stop',
      success: true,
    }, supabase as never)

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      analysis_run_id: 'run-123',
      analysis_id: null,
    }))
  })
})

describe('logDedupTrace', () => {
  it('persists the analysis run that produced the deduplication record', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    }

    await logDedupTrace({
      analysis_id: undefined,
      analysis_run_id: 'run-123',
      user_id: 'user-123',
      raw_recommendations: [],
      deduped_recommendations: [],
      merge_map: {},
    }, supabase as never)

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      analysis_run_id: 'run-123',
      analysis_id: null,
    }))
  })
})
