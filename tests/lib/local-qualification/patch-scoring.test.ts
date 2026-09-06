import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { assembleScenario, bindScore, patchFingerprint, type CanonicalScoringInput, type OccurrencePatch, type PatchAuthority } from '@/lib/local-qualification/patch'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const original = 'α Add acetone; wash with acetone.\r\nMonitor by NMR.\n'
const start = Buffer.byteLength('α Add ')
const sourceHash = hash(original)
const graphHash = hash('graph')
const patch: OccurrencePatch = { id: hash('patch'), decisionId: hash('decision'), sourceHash, graphHash, start, end: start + 7, preimage: 'acetone', preimageHash: hash('acetone'), replacement: 'ethanol' }
const authority: PatchAuthority = { decisionId: patch.decisionId, sourceHash, graphHash, patchId: patch.id, patchHash: patchFingerprint(patch), status: 'approved-draft-edit', evidenceHash: hash('evidence'), independentAudit: 'approved', jointCompatibilityHash: hash('joint'), authorizedPatchIds: [patch.id] }
const run = (patches = [patch], authorities = [authority]) => assembleScenario({ original, sourceHash, graphHash, patches, authorities })

describe('occurrence scenario boundary', () => {
  it.each(['Add acetone\u0301.', 'Add \u0301acetone.'])('rejects combining-mark token continuation: %s', text => {
    const start = Buffer.byteLength(text.slice(0, text.indexOf('acetone')))
    const p = { ...patch, sourceHash: hash(text), start, end: start + Buffer.byteLength('acetone') }
    const a = { ...authority, sourceHash: p.sourceHash, patchHash: patchFingerprint(p) }
    expect(() => assembleScenario({ original: text, sourceHash: p.sourceHash, graphHash, patches: [p], authorities: [a] })).toThrow('patch_substring')
  })
  it('changes only authorized UTF-8 bytes, preserving repeated roles and CRLF', () => {
    const result = run()
    expect(result.text).toBe('α Add ethanol; wash with acetone.\r\nMonitor by NMR.\n')
    expect(result.sourceHash).toBe(sourceHash)
    expect(result.scenarioHash).toBe(hash(result.text))
    expect(result.original).toBe(original)
    expect(result.applied).toBe(false)
    expect(result.patchIds).toEqual([patch.id])
  })
  it('rejects stale hashes, false preimages, forged authority and redesign', () => {
    expect(() => run([{ ...patch, sourceHash: hash('stale') }])).toThrow('patch_identity')
    expect(() => run([{ ...patch, preimageHash: hash('wrong') }])).toThrow('patch_preimage')
    expect(() => run([{ ...patch, start: start + 1 }])).toThrow('patch_preimage')
    expect(() => run([patch], [{ ...authority, independentAudit: 'disagreement' }])).toThrow('patch_authority')
    expect(() => run([patch], [{ ...authority, status: 'requires-human-design' }])).toThrow('patch_authority')
    expect(() => run([patch], [])).toThrow('patch_authority')
  })
  it('does not let an approved ID authorize mutated replacement content', () => {
    expect(() => run([{ ...patch, replacement: 'water' }])).toThrow('patch_authority')
  })
  it('rejects overlaps, aliases, substring matches, and incompatible joint sets', () => {
    expect(() => run([patch, { ...patch, id: hash('second') }])).toThrow('patch_conflict')
    const text = 'Add n-acetone.'
    const p = { ...patch, sourceHash: hash(text), start: 6, end: 13 }
    const a = { ...authority, sourceHash: hash(text) }
    expect(() => assembleScenario({ original: text, sourceHash: hash(text), graphHash, patches: [p], authorities: [a] })).toThrow('patch_substring')
    expect(() => run([patch], [{ ...authority, authorizedPatchIds: [] }])).toThrow('patch_authority')
    expect(() => run([patch], [{ ...authority, evidenceHash: '' }])).toThrow('patch_authority')
  })
  it('binds supplied scoring inputs to revised descriptions; null conversion never reuses mass', () => {
    const scenario = run()
    const inputs = { scenarioHash: scenario.scenarioHash, description: scenario.text, materials: [{ occurrenceId: hash('occurrence'), identity: 'ethanol', massG: null }] }
    expect(bindScore(scenario, inputs, 'scorer-v1', () => { throw new Error('must not score unavailable inputs') })).toMatchObject({ state: 'unavailable', reason: 'conversion_unavailable' })
    expect(() => bindScore(scenario, { ...inputs, description: original }, 'scorer-v1', () => 9)).toThrow()
    expect(() => bindScore(scenario, { ...inputs, scenarioHash: sourceHash }, 'scorer-v1', () => 9)).toThrow()
    const valid = { ...inputs, materials: [{ ...inputs.materials[0], massG: 1.5 }] }
    expect(bindScore(scenario, valid, 'scorer-v1', () => 9)).toMatchObject({ state: 'scored', score: 9, scenarioHash: scenario.scenarioHash })
    expect(bindScore(scenario, valid, 'scorer-v1', () => Number.NaN)).toMatchObject({ state: 'unavailable' })
  })
})

// Every fixture has an exact byte slice and its own complete internal approval.
const approvals = (patches: OccurrencePatch[]): PatchAuthority[] => patches.map(p => ({
  ...authority, patchId: p.id, decisionId: p.decisionId, sourceHash: p.sourceHash,
  graphHash: p.graphHash, patchHash: patchFingerprint(p), authorizedPatchIds: patches.map(p => p.id),
}))
const secondStart = Buffer.byteLength(original.slice(0, original.lastIndexOf('acetone')))
const second: OccurrencePatch = { ...patch, id: hash('second'), decisionId: hash('second-decision'), start: secondStart, end: secondStart + 7, replacement: 'water' }
const orders = [[false, false], [true, false], [false, true], [true, true]] as const

function spanPatch(text: string, start: number, end: number, id: string): OccurrencePatch {
  const preimage = Buffer.from(text).subarray(start, end).toString('utf8')
  return { ...patch, id: hash(id), decisionId: hash(`decision-${id}`), sourceHash: hash(text), start, end, preimage, preimageHash: hash(preimage) }
}

describe('joint selected set and conflict invariants', () => {
  it.each(orders)('assembles two nonoverlapping edits identically (patch reverse=%s, authority reverse=%s)', (reverseP, reverseA) => {
    const patches = [patch, second]
    const authorities = approvals(patches)
    const expected = run(patches, authorities)
    // Authorized ID order is independently irrelevant too.
    const reordered = authorities.map(a => ({ ...a, authorizedPatchIds: [...a.authorizedPatchIds].reverse() }))
    const actual = run(reverseP ? [...patches].reverse() : patches, reverseA ? reordered.reverse() : reordered)
    expect(actual).toEqual(expected)
    expect(actual.identity).toBe(expected.identity)
    expect(actual.text).toBe('α Add ethanol; wash with water.\r\nMonitor by NMR.\n')
    expect(actual.patchIds).toEqual([patch.id, second.id].sort())
  })

  it.each(['differing joint hashes', 'missing ID', 'extra ID', 'duplicate ID', 'duplicate authority'] as const)('rejects %s in every patch/authority ordering', defect => {
    const patches = [patch, second]
    const authorities = approvals(patches)
    if (defect === 'differing joint hashes') authorities[1].jointCompatibilityHash = hash('different-valid-joint')
    if (defect === 'missing ID') authorities[1].authorizedPatchIds = [second.id]
    if (defect === 'extra ID') authorities[1].authorizedPatchIds = [patch.id, second.id, hash('extra')]
    if (defect === 'duplicate ID') authorities[1].authorizedPatchIds = [patch.id, second.id, second.id]
    if (defect === 'duplicate authority') authorities.push({ ...authorities[1] })
    for (const [reverseP, reverseA] of orders) {
      expect(() => run(reverseP ? [...patches].reverse() : patches, reverseA ? [...authorities].reverse() : authorities)).toThrow('patch_authority')
    }
  })

  it.each(['partial', 'containing', 'equal', 'duplicate ID disjoint'] as const)('rejects %s conflicts in both orders', kind => {
    const text = 'one two three.'
    const first = spanPatch(text, 0, kind === 'containing' ? 13 : 7, 'first-span')
    const last = spanPatch(text, kind === 'equal' ? 0 : 4, kind === 'containing' ? 7 : kind === 'equal' ? 7 : 13, 'last-span')
    const patches = kind === 'duplicate ID disjoint' ? [patch, { ...second, id: patch.id }] : [first, last]
    const source = kind === 'duplicate ID disjoint' ? original : text
    const authorities = approvals(patches)
    for (const ordered of [patches, [...patches].reverse()]) {
      expect(() => assembleScenario({ original: source, sourceHash: hash(source), graphHash, patches: ordered, authorities })).toThrow('patch_conflict')
    }
  })
})

describe('exact byte identity and full fingerprint', () => {
  it.each([
    ['negative', -1, patch.end], ['empty', start, start], ['reversed', patch.end, start],
    ['out of range', start, Buffer.byteLength(original) + 1], ['fractional start', start + 0.5, patch.end],
    ['fractional end', start, patch.end + 0.5], ['NaN', NaN, patch.end], ['infinity', start, Infinity],
    ['unsafe integer', start, Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s offsets', (_label, from, to) => {
    const p = { ...patch, start: from as number, end: to as number }
    expect(() => run([p], approvals([p]))).toThrow('patch_preimage')
  })

  it.each([[1, 2], [0, 1]])('rejects an actual cut inside the two-byte alpha: [%s,%s)', (from, to) => {
    expect([...Buffer.from(original).subarray(0, 2)]).toEqual([0xce, 0xb1])
    const p = spanPatch(original, from, to, 'multibyte-cut')
    expect(() => run([p], approvals([p]))).toThrow('patch_preimage')
  })

  it.each([
    ['sourceHash', hash('stale')], ['graphHash', hash('wrong graph')], ['id', 'not-a-hash'],
    ['decisionId', 'A'.repeat(64)],
  ] as const)('rejects patch %s identity mismatch', (field, value) => {
    const p = { ...patch, [field]: value }
    expect(() => run([p], approvals([p]))).toThrow('patch_identity')
  })

  it.each([
    ['sourceHash', hash('wrong source')], ['graphHash', hash('wrong graph')],
    ['patchHash', hash('wrong patch')], ['evidenceHash', 'bad'], ['jointCompatibilityHash', 'bad'],
  ] as const)('rejects authority %s mismatch', (field, value) => {
    expect(() => run([patch], [{ ...authority, [field]: value }])).toThrow('patch_authority')
  })

  it('rejects original/source mismatch and invalid source/graph hashes', () => {
    for (const overrides of [{ original: original + ' ' }, { sourceHash: hash('other') }, { sourceHash: 'bad' }, { graphHash: 'bad' }]) {
      expect(() => assembleScenario({ original, sourceHash, graphHash, patches: [patch], authorities: [authority], ...overrides })).toThrow('patch_identity')
    }
    const p = { ...patch, preimage: 'ethanol', preimageHash: hash('ethanol') }
    expect(() => run([p], approvals([p]))).toThrow('patch_preimage')
  })

  it.each(Object.keys(patch) as (keyof OccurrencePatch)[])('fingerprints the complete %s field', field => {
    const value = patch[field]
    const changed = { ...patch, [field]: typeof value === 'number' ? value + 1 : value + 'changed' }
    expect(patchFingerprint(changed)).not.toBe(patchFingerprint(patch))
    expect(patchFingerprint(patch)).toBe(hash(JSON.stringify([
      patch.id, patch.decisionId, patch.sourceHash, patch.graphHash, patch.start, patch.end,
      patch.preimage, patch.preimageHash, patch.replacement,
    ])))
  })

  it('rejects moving an approved ID to another valid occurrence with the same preimage', () => {
    const moved = { ...patch, start: second.start, end: second.end }
    expect(() => run([moved], [authority])).toThrow('patch_authority')
    expect(run([moved], approvals([moved])).text).toBe('α Add acetone; wash with ethanol.\r\nMonitor by NMR.\n')
  })
})

describe('trusted scoring adapter immutability', () => {
  it('freezes the scenario, selected IDs, scorer snapshot and output binding', () => {
    const patches = [{ ...patch }, { ...second }]
    const authorities = approvals(patches)
    const scenario = run(patches, authorities)
    const scenarioBefore = JSON.stringify(scenario)
    expect(Object.isFrozen(scenario)).toBe(true)
    expect(Object.isFrozen(scenario.patchIds)).toBe(true)
    expect(Reflect.set(scenario, 'identity', 'mutated')).toBe(false)
    expect(Reflect.set(scenario.patchIds, '0', 'mutated')).toBe(false)
    patches[0].replacement = 'mutated'
    patches.reverse()
    authorities[0].jointCompatibilityHash = hash('mutated')
    expect(JSON.stringify(scenario)).toBe(scenarioBefore)

    const input = { scenarioHash: scenario.scenarioHash, description: scenario.text, materials: [{ occurrenceId: hash('occurrence'), identity: 'ethanol', massG: 1.5 }] }
    const before = JSON.stringify(input)
    const scorer = vi.fn((captured: CanonicalScoringInput) => {
      expect(Object.isFrozen(captured)).toBe(true)
      expect(Object.isFrozen(captured.materials)).toBe(true)
      expect(Object.isFrozen(captured.materials[0])).toBe(true)
      expect(Reflect.set(captured.materials[0], 'massG', 100)).toBe(false)
      return 9
    })
    const result = bindScore(scenario, input, 'scorer-v1', scorer)
    expect(scorer).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result).toMatchObject({ state: 'scored', score: 9, inputHash: hash(before), scenarioHash: hash(scenario.text), scenarioIdentity: scenario.identity, scorerVersion: 'scorer-v1' })
    const captured = scorer.mock.calls[0][0]
    expect(captured).not.toBe(input)
    expect(captured.materials).not.toBe(input.materials)
    expect(captured.materials[0]).not.toBe(input.materials[0])
    const resultBefore = JSON.stringify(result)
    input.description = original
    input.materials[0].massG = 999
    input.materials.push({ occurrenceId: hash('extra'), identity: 'water', massG: 100 })
    expect(JSON.stringify(captured)).toBe(before)
    expect(Reflect.set(result, 'inputHash', 'mutated')).toBe(false)
    expect(JSON.stringify(result)).toBe(resultBefore)
  })

  it('never calls the scorer for supplied null conversion, including after a successful score', () => {
    const scenario = run()
    const input = { scenarioHash: scenario.scenarioHash, description: scenario.text, materials: [{ occurrenceId: hash('occurrence'), identity: 'ethanol', massG: 1.5 as number | null }] }
    const scorer = vi.fn(() => 9)
    expect(bindScore(scenario, input, 'v1', scorer).state).toBe('scored')
    scorer.mockClear()
    input.materials[0].massG = null
    const result = bindScore(scenario, input, 'v1', scorer)
    expect(scorer).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'unavailable', reason: 'conversion_unavailable', inputHash: hash(JSON.stringify(input)) })
    expect(result).not.toHaveProperty('score')
    expect(Object.isFrozen(result)).toBe(true)
  })
})
