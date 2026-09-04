export const GREEN_CHEM_BOTS_CHANNEL = 'C0BV0TM30H2'

export type AnalysisAlert = {
  status: 'completed' | 'failed'
  analysisName: string | null
  analysisId: string | null
  analysisRunId: string
  userEmail: string | null
  protocolInputTokens: number | null
  processingMilliseconds: number
  generatedOutputTokens: number
  errorMessages: string[]
}

type SlackResponse = {
  ok: boolean
  channel?: string
  ts?: string
  error?: string
}

type FetchFn = typeof fetch

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? 'Unavailable' : String(value)
}

function duration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

/** Formats only operational metadata. Protocol text and LLM payloads never leave GC.ai. */
export function formatAnalysisAlert(alert: AnalysisAlert): string {
  const title = alert.status === 'completed' ? 'Analysis complete' : 'Analysis failed'
  const errors = alert.errorMessages.length > 0
    ? alert.errorMessages.map(error => `• ${error}`).join('\n')
    : 'None'

  return [
    `*${title}*`,
    `• Name: ${display(alert.analysisName)}`,
    `• Analysis ID: ${display(alert.analysisId)}`,
    `• Run ID: ${alert.analysisRunId}`,
    `• User: ${display(alert.userEmail)}`,
    `• Protocol input tokens: ${display(alert.protocolInputTokens)}`,
    `• Time to process: ${duration(alert.processingMilliseconds)}`,
    `• Generated output tokens: ${alert.generatedOutputTokens}`,
    `• Errors:\n${errors}`,
  ].join('\n')
}

/** Posts a top-level message. No thread_ts is ever supplied. */
export async function postOperationalAlert(
  text: string,
  token = process.env.SLACK_ALERT_BOT_TOKEN,
  fetchFn: FetchFn = fetch,
  webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL,
): Promise<SlackResponse> {
  if (webhookUrl) {
    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
    })
    const body = await response.text()
    return response.ok && body === 'ok'
      ? { ok: true }
      : { ok: false, error: `Slack webhook returned HTTP ${response.status}` }
  }

  if (!token) {
    return { ok: false, error: 'SLACK_ALERT_BOT_TOKEN or SLACK_ALERT_WEBHOOK_URL is not configured' }
  }

  const response = await fetchFn('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: GREEN_CHEM_BOTS_CHANNEL,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
  })

  let payload: SlackResponse
  try {
    payload = await response.json() as SlackResponse
  } catch {
    return { ok: false, error: `Slack returned HTTP ${response.status}` }
  }

  if (!response.ok || !payload.ok) {
    return { ok: false, error: payload.error || `Slack returned HTTP ${response.status}` }
  }

  return { ok: true, channel: payload.channel, ts: payload.ts }
}

export async function notifyAnalysis(alert: AnalysisAlert): Promise<void> {
  const result = await postOperationalAlert(formatAnalysisAlert(alert))
  if (!result.ok) {
    console.error('[operational-alert] analysis alert failed:', result.error)
  }
}
