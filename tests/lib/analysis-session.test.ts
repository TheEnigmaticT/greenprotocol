import { describe, expect, it, vi } from 'vitest'

interface StoredAnalysisData {
  id?: string
  protocolText?: string
  analysis: {
    recommendations: Array<{ isAccepted: boolean }>
  }
  impactDelta: Record<string, unknown>
  equivalencies: unknown[]
}

function createSessionStorage(seed: Record<string, string>): Storage {
  const state = new Map(Object.entries(seed))

  return {
    get length() {
      return state.size
    },
    clear: vi.fn(() => {
      state.clear()
    }),
    getItem: vi.fn((key: string) => state.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(state.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      state.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      state.set(key, value)
    }),
  } as Storage
}

const cachedAnalysis: StoredAnalysisData = {
  id: 'analysis-123',
  analysis: {
    recommendations: [{ isAccepted: false }],
  },
  impactDelta: { co2eKg: 12.4 },
  equivalencies: [],
}


describe('resolveAnalysisSession', () => {
  it('restores cached analysis and protocol during an ordinary revisit', async () => {
    const sessionStorage = createSessionStorage({
      gpc_analysis: JSON.stringify(cachedAnalysis),
      gpc_protocol: 'Cached protocol text',
    })

    // Dynamic import exception: this regression test establishes the seam before the helper module exists.
    const { resolveAnalysisSession } = await import('@/lib/analysis-session')
    const restored = resolveAnalysisSession({
      sessionStorage,
      searchParams: new URLSearchParams(),
    })

    expect(restored).toEqual({
      ...cachedAnalysis,
      protocolText: 'Cached protocol text',
    })
  })

  it('clears cached analysis and protocol for an explicit new-analysis request', async () => {
    const sessionStorage = createSessionStorage({
      gpc_analysis: JSON.stringify({ ...cachedAnalysis, protocolText: 'Stale protocol text' }),
      gpc_protocol: 'Stale protocol text',
    })

    // Dynamic import exception: this regression test establishes the seam before the helper module exists.
    const { resolveAnalysisSession } = await import('@/lib/analysis-session')
    const restored = resolveAnalysisSession({
      sessionStorage,
      searchParams: new URLSearchParams('new=1'),
    })

    expect(restored).toBeNull()
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('gpc_analysis')
    expect(sessionStorage.removeItem).toHaveBeenCalledWith('gpc_protocol')
  })
})
