import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalysisStreamRecovery } from '@/components/AnalysisStreamRecovery'

describe('AnalysisStreamRecovery', () => {
  it('gives a disconnected mobile user a safe recovery path without claiming the analysis failed', () => {
    const markup = renderToStaticMarkup(createElement(AnalysisStreamRecovery, {
      onOpenDashboard: () => undefined,
    }))

    expect(markup).toContain('We lost the connection to the progress screen.')
    expect(markup).toContain('Your analysis may still be running and will be saved when it finishes.')
    expect(markup).toContain('Open dashboard')
    expect(markup).not.toContain('Please try again')
  })
})
