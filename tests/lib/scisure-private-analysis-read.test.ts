import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), eq: vi.fn(), single: vi.fn(), userId: 'owner-1' as string | null }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
import { GET } from '@/app/api/analyses/[id]/route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userId = 'owner-1'
  const query = { select: () => query, eq: mocks.eq, single: mocks.single }
  mocks.eq.mockReturnValue(query)
  mocks.single.mockResolvedValue({ data: { id: 'analysis-1', protocol_text: 'Private reviewed source', analysis_result: { recommendations: [] }, impact_delta: null, revision_number: 1 }, error: null })
  mocks.createClient.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user: mocks.userId ? { id: mocks.userId } : null }, error: null }) }, from: () => query }))
})

const read = () => GET(new Request('https://staging.greenchemistry.ai/api/analyses/analysis-1'), { params: Promise.resolve({ id: 'analysis-1' }) })
describe('private saved SciSure analysis / Evidence Atlas access', () => {
  it('loads a source without impact data rather than throwing or fabricating equivalencies', async () => {
    const response = await read()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ impactDelta: null, equivalencies: [] })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-1')
  })
  it('does not expose saved source to an unsigned visitor', async () => {
    mocks.userId = null
    expect((await read()).status).toBe(401)
    expect(mocks.single).not.toHaveBeenCalled()
  })
  it('fails closed for another owner or absent record', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const response = await read()
    expect(response.status).toBe(404)
    expect(mocks.eq).toHaveBeenCalledWith('user_id', 'owner-1')
    expect(await response.json()).not.toHaveProperty('protocolText')
  })
})
