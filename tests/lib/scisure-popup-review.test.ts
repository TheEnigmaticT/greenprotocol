import { describe, expect, it } from 'vitest'
import { MAX_SCISURE_WRITEBACK_BYTES, type PreparedSciSureWriteback, type SciSureWorkspaceFinding } from '@/lib/integrations/scisure/workspace-contract'
import {
  applyDecision, bridgeHeaders, buildWritebackMessage, canPrepareDraft, canRetryWriteback, parseWritebackResult, sourceIdentity, undecidedCount, writebackTarget,
} from '@/lib/integrations/scisure/popup-review'
import { source } from './scisure-workspace-fixture'

const expected = { nonce: 'a'.repeat(64), bridgeSessionId: 'bridge-1', requestId: 'req-1' }
const reply = (patch: Record<string, unknown> = {}) => ({ version: 2, type: 'scisure.gcai.writeback-result', ...expected, status: 'saved', message: 'ok', ...patch })
const finding = (findingId: string, decision: SciSureWorkspaceFinding['decision'] = null) => ({ findingId, decision }) as SciSureWorkspaceFinding
const bundle = (draftText = 'Add water.') => ({ version: 2, draftText }) as unknown as PreparedSciSureWriteback

describe('popup review decisions', () => {
  it('requires every finding to be decided, including ones that can never change the procedure', () => {
    const all = [finding('a', 'accepted'), finding('b'), finding('c', 'rejected')]
    expect(undecidedCount(all)).toBe(1)
    expect(canPrepareDraft(all)).toBe(false)
    expect(canPrepareDraft(applyDecision(all, 'b', 'rejected'))).toBe(true)
    expect(canPrepareDraft([])).toBe(true)
  })
  it('changes only the decided finding and does not mutate its input', () => {
    const all = [finding('a'), finding('b')]
    const next = applyDecision(all, 'b', 'accepted')
    expect(next.map(f => f.decision)).toEqual([null, 'accepted'])
    expect(all[1].decision).toBeNull()
  })
})

describe('writeback request', () => {
  it('derives the add-on identity from the admitted source and omits an absent version', () => {
    expect(sourceIdentity({ externalId: 'p-1', externalVersionId: 'v2', selection: [{ stepId: 's1', order: 1 }, { sectionId: 'sec', order: 2 }, { order: 3 }] }))
      .toEqual({ externalId: 'p-1', externalVersionId: 'v2', selectionIds: ['s1', 'sec', '#3'] })
    const message = buildWritebackMessage({ ...expected, source: { externalId: 'p-1', selection: [{ stepId: 's1', order: 1 }] }, bundle: bundle() })
    expect(message).toMatchObject({ version: 2, type: 'gcai.scisure.writeback', mode: 'create', snapshot: { externalId: 'p-1', selectionIds: ['s1'] } })
    expect(message.snapshot).not.toHaveProperty('externalVersionId')
  })
  it('sends the prepared bundle untouched and only ever asks to create', () => {
    const prepared = bundle()
    const message = buildWritebackMessage({ ...expected, source: source(), bundle: prepared })
    expect(message.bundle).toBe(prepared)
    expect(message.mode).toBe('create')
  })
  it('refuses an oversize bundle, a bad request id, or a source with no identity before anything is posted', () => {
    expect(() => buildWritebackMessage({ ...expected, source: source(), bundle: bundle('x'.repeat(MAX_SCISURE_WRITEBACK_BYTES)) })).toThrow(/nothing was sent/)
    expect(() => buildWritebackMessage({ ...expected, requestId: 'has space', source: source(), bundle: bundle() })).toThrow(/nothing was sent/)
    expect(() => buildWritebackMessage({ ...expected, source: {}, bundle: bundle() })).toThrow(/nothing was sent/)
  })
})

describe('writeback result', () => {
  it('accepts the add-on reply only for this exact nonce, session and request', () => {
    expect(parseWritebackResult(reply({ targetId: 'exp-9', targetKind: 'experiment' }), expected)).toMatchObject({ status: 'saved', targetId: 'exp-9', targetKind: 'experiment' })
    expect(parseWritebackResult(reply({ requestId: 'other' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ nonce: 'b'.repeat(64) }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ bridgeSessionId: 'other' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ version: 1 }), expected)).toBeNull()
  })
  it('rejects unknown statuses, malformed targets and non-objects instead of showing them', () => {
    expect(parseWritebackResult(reply({ status: 'saved; drop table' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ status: 'toString' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ targetKind: 'folder' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ targetId: '<script>' }), expected)).toBeNull()
    expect(parseWritebackResult(reply({ message: 'x'.repeat(1025) }), expected)).toBeNull()
    expect(parseWritebackResult(null, expected)).toBeNull()
    expect(parseWritebackResult('saved', expected)).toBeNull()
  })
  it('allows a retry only after a failure that created nothing', () => {
    expect(['saved', 'conflict', 'unsupported', 'failed', 'uncertain'].filter(s => canRetryWriteback(s as 'saved'))).toEqual(['failed'])
  })
})

describe('popup copy and headers', () => {
  it('describes a protocol-step source as a selected-content copy and never as an update', () => {
    expect(writebackTarget('experiment').noun).toBe('experiment')
    expect(writebackTarget('protocol-step')).toMatchObject({ noun: 'protocol' })
    expect(writebackTarget('protocol-step').description).toMatch(/selected-content copy/)
    expect(writebackTarget('protocol').description).toMatch(/not changed/)
  })
  it('carries the credential only as a bearer header', () => {
    const headers = bridgeHeaders({ sessionId: 's', credential: 'secret', sourceOrigin: 'https://x.test' }, true)
    expect(headers.Authorization).toBe('Bearer secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.stringify(Object.entries(headers).filter(([key]) => key !== 'Authorization'))).not.toContain('secret')
  })
})
