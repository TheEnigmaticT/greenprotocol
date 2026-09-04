import { describe, expect, it, vi } from 'vitest'
import {
  GREEN_CHEM_BOTS_CHANNEL,
  formatAnalysisAlert,
  postOperationalAlert,
} from '@/lib/operational-alerts'

describe('formatAnalysisAlert', () => {
  it('includes the required completed-analysis metadata without protocol text', () => {
    const message = formatAnalysisAlert({
      status: 'completed',
      analysisName: 'Suzuki coupling optimization',
      analysisId: 'analysis-123',
      analysisRunId: 'run-123',
      userEmail: 'chemist@example.com',
      protocolInputTokens: 87,
      processingMilliseconds: 12_345,
      generatedOutputTokens: 456,
      errorMessages: [],
    })

    expect(message).toContain('*Analysis complete*')
    expect(message).toContain('Suzuki coupling optimization')
    expect(message).toContain('analysis-123')
    expect(message).toContain('chemist@example.com')
    expect(message).toContain('87')
    expect(message).toContain('12.3s')
    expect(message).toContain('456')
    expect(message).toContain('None')
    expect(message).not.toContain('protocol text')
  })

  it('makes failed runs explicit and retains error messages', () => {
    const message = formatAnalysisAlert({
      status: 'failed',
      analysisName: null,
      analysisId: null,
      analysisRunId: 'run-456',
      userEmail: 'chemist@example.com',
      protocolInputTokens: null,
      processingMilliseconds: 1_000,
      generatedOutputTokens: 0,
      errorMessages: ['Model timed out'],
    })

    expect(message).toContain('*Analysis failed*')
    expect(message).toContain('Model timed out')
    expect(message).toContain('Unavailable')
  })
})

describe('postOperationalAlert', () => {
  it('posts a root message to the fixed greenchem-bots channel', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, channel: GREEN_CHEM_BOTS_CHANNEL, ts: '1.2' }),
    })

    const result = await postOperationalAlert('Alert text', 'xoxb-test', fetchFn)

    expect(result).toEqual({ ok: true, channel: GREEN_CHEM_BOTS_CHANNEL, ts: '1.2' })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      channel: GREEN_CHEM_BOTS_CHANNEL,
      text: 'Alert text',
      unfurl_links: false,
      unfurl_media: false,
    })
  })

  it('uses the configured incoming webhook for a root post before the Botty token fallback', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    })

    const result = await postOperationalAlert(
      'Alert text',
      undefined,
      fetchFn,
      'https://hooks.slack.com/services/test',
    )

    expect(result).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({
      text: 'Alert text',
      unfurl_links: false,
      unfurl_media: false,
    })
  })
})
