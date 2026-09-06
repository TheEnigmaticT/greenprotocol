import { describe, expect, it } from 'vitest'
import { createSource, anchor } from '../../../lib/local-qualification/source'
import { canonicalFact, createGraph } from '../../../lib/local-qualification/graph'
import { buildAnchoredChemistryInput } from '../../../lib/local-qualification/chemistry-input'

function fixture() {
  const source = createSource('ethanol 2 mL; ethanol 3 mL')
  const fact = (category: 'material' | 'quantity', start: number, end: number) => canonicalFact(source, { category, anchor: anchor(source, start, end), status: 'observed', derivationIds: [], value: source.text.slice(start, end) })
  const facts = [fact('material', 0, 7), fact('quantity', 8, 12), fact('material', 14, 21), fact('quantity', 22, 26)]
  return { source, facts }
}
describe('anchored chemistry-service input projection', () => {
  it('preserves repeated material occurrences and literal quantities rather than deduplicating or converting', () => {
    const { source, facts } = fixture()
    const graph = createGraph(source, facts, [[1, 0], [3, 2]].map(([from, to]) => ({ fromFactId: facts[from].id, toFactId: facts[to].id, relation: 'quantity-of', anchor: anchor(source, 0, source.bytes.length), status: 'observed', derivationIds: [] })))
    const result = buildAnchoredChemistryInput(source, graph)
    expect(result.materials.map(m => [m.name, m.quantity])).toEqual([['ethanol', '2 mL'], ['ethanol', '3 mL']])
    expect(new Set(result.materials.map(m => m.occurrenceId)).size).toBe(2)
    expect(result.materials.every(m => m.sourceHash === source.id && m.graphHash === graph.id)).toBe(true)
    expect(result.unresolvedFactIds).toEqual([])
    expect(result.materialQuantitiesComplete).toBe(true)
    expect(result.scientificAcceptance).toBe('unverified')
  })
  it('does not guess a quantity from proximity without an observed graph relationship', () => {
    const { source, facts } = fixture()
    const result = buildAnchoredChemistryInput(source, createGraph(source, facts))
    expect(result.materials.every(m => m.quantity === null)).toBe(true)
    expect(result.materialQuantitiesComplete).toBe(false)
  })
  it('retains unknown terms and refuses ambiguous linked quantities', () => {
    const { source, facts } = fixture()
    const unknown = canonicalFact(source, { category: 'unclassified', anchor: anchor(source, 0, 7), status: 'unknown', derivationIds: [] })
    const graph = createGraph(source, [...facts, unknown], [1, 3].map(from => ({ fromFactId: facts[from].id, toFactId: facts[0].id, relation: 'quantity-of', anchor: anchor(source, 0, source.bytes.length), status: 'observed', derivationIds: [] })))
    const result = buildAnchoredChemistryInput(source, graph)
    expect(result.materials[0].quantity).toBeNull()
    expect(result.unresolvedFactIds).toContain(unknown.id)
    expect(result.materialQuantitiesComplete).toBe(false)
  })
})
