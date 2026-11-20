import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runAnalysis: vi.fn() }))
vi.mock('@/lib/run-analysis', () => ({ runAnalysis: mocks.runAnalysis }))
import { RERUN_INTERRUPTED_MESSAGE, rerunFromProposal } from '@/lib/rerun-from-proposal'

const storage = () => ({ setItem: vi.fn() })
const completed = { kind: 'completed', analysisId: 'new-1', analysis: { protocolTitle: 'Edited' }, impactDelta: null, equivalencies: [], protocolText: 'Edited procedure text.' }

beforeEach(() => mocks.runAnalysis.mockReset())

describe('re-running an edited procedure as a new analysis', () => {
  it('analyzes the edited text, hands the result to the new page and navigates to the new analysis', async () => {
    mocks.runAnalysis.mockResolvedValue(completed)
    const navigate = vi.fn(); const store = storage()
    await rerunFromProposal({ proposedText: 'Edited procedure text.', navigate, storage: store })
    expect(mocks.runAnalysis).toHaveBeenCalledWith({ protocolText: 'Edited procedure text.' })
    expect(navigate).toHaveBeenCalledWith('/analyze/new-1')
    expect(store.setItem).toHaveBeenCalledWith('gpc_protocol', 'Edited procedure text.')
    expect(JSON.parse(store.setItem.mock.calls.find(([key]) => key === 'gpc_analysis')![1])).toMatchObject({ id: 'new-1', protocolText: 'Edited procedure text.' })
  })
  it('sends a signed-out user to login without storing anything', async () => {
    mocks.runAnalysis.mockResolvedValue({ kind: 'unauthorized' })
    const navigate = vi.fn(); const store = storage()
    await rerunFromProposal({ proposedText: 'x'.repeat(40), navigate, storage: store })
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(store.setItem).not.toHaveBeenCalled()
  })
  it('throws plain language for a failed or interrupted run and never navigates', async () => {
    const navigate = vi.fn(); const store = storage()
    mocks.runAnalysis.mockResolvedValueOnce({ kind: 'failed', error: { code: 'run_limit_reached', title: 'Analysis limit reached', message: 'You have used all 10 analyses.', action: 'contact' } })
    await expect(rerunFromProposal({ proposedText: 'x'.repeat(40), navigate, storage: store })).rejects.toThrow('Analysis limit reached. You have used all 10 analyses.')
    mocks.runAnalysis.mockResolvedValueOnce({ kind: 'interrupted' })
    await expect(rerunFromProposal({ proposedText: 'x'.repeat(40), navigate, storage: store })).rejects.toThrow(RERUN_INTERRUPTED_MESSAGE)
    expect(navigate).not.toHaveBeenCalled()
    expect(store.setItem).not.toHaveBeenCalled()
  })
})
