import type { AnalysisResult, Equivalency, ImpactDelta, ProgressEvent } from '@/lib/types'
import { humanizeError, parseErrorBody, type HumanError } from '@/lib/errors/humanize'
import { MAX_PROTOCOL_CHARS, MIN_PROTOCOL_CHARS } from '@/lib/protocol-limits'

/** Progress events the runner forwards; `result` and `error` become the outcome instead. */
export type AnalysisProgressEvent = Extract<ProgressEvent, { type: 'phase' | 'principle' | 'score' }>

export type RunAnalysisOutcome =
  | {
      kind: 'completed'
      analysisId: string
      analysis: AnalysisResult
      protocolText: string
      impactDelta: ImpactDelta
      equivalencies: Equivalency[]
    }
  /** The connection dropped before a result arrived. The analysis may still finish and be saved. */
  | { kind: 'interrupted' }
  | { kind: 'failed'; error: HumanError }
  /** The session is gone; the caller should send the person to sign in. */
  | { kind: 'unauthorized' }

/** Client-side length check using the same limits the server enforces. */
export function validateProtocolText(protocolText: string): HumanError | null {
  const trimmedLength = protocolText.trim().length
  if (trimmedLength < MIN_PROTOCOL_CHARS) {
    return humanizeError({
      code: 'protocol_too_short',
      context: { minChars: MIN_PROTOCOL_CHARS, actualChars: trimmedLength },
    })
  }
  if (protocolText.length > MAX_PROTOCOL_CHARS) {
    return humanizeError({
      code: 'protocol_too_long',
      context: { maxChars: MAX_PROTOCOL_CHARS, actualChars: protocolText.length },
    })
  }
  return null
}

function parseEvent(line: string): ProgressEvent | null {
  if (!line.startsWith('data: ')) return null
  try {
    return JSON.parse(line.slice(6)) as ProgressEvent
  } catch {
    return null
  }
}

/**
 * Runs one analysis through POST /api/analyze and reads its progress stream.
 * Every failure is returned as an outcome; nothing here throws for a failed run.
 */
export async function runAnalysis({ protocolText, signal, onProgress }: {
  protocolText: string
  signal?: AbortSignal
  onProgress?: (event: AnalysisProgressEvent) => void
}): Promise<RunAnalysisOutcome> {
  const invalid = validateProtocolText(protocolText)
  if (invalid) return { kind: 'failed', error: invalid }

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocolText }),
      signal,
    })

    if (res.status === 401) return { kind: 'unauthorized' }

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      const body: unknown = await res.json().catch(() => null)
      return {
        kind: 'failed',
        error: humanizeError({ ...parseErrorBody(body), status: res.status }),
      }
    }

    if (!res.body) return { kind: 'interrupted' }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const event = parseEvent(line)
        if (!event) continue

        if (event.type === 'result') {
          if (!event.data.id) {
            return { kind: 'failed', error: humanizeError({ code: 'persist_failed' }) }
          }
          return {
            kind: 'completed',
            analysisId: event.data.id,
            analysis: event.data.analysis,
            protocolText,
            impactDelta: event.data.impactDelta,
            equivalencies: event.data.equivalencies,
          }
        }
        if (event.type === 'error') {
          return { kind: 'failed', error: humanizeError({ code: event.code }) }
        }
        onProgress?.(event)
      }
    }

    return { kind: 'interrupted' }
  } catch {
    return { kind: 'interrupted' }
  }
}
