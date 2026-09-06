import { describe, expect, it } from 'vitest';
import { anchor, createSource, partitionSource, type Source } from '../../../lib/local-qualification/source';
import { createGraph, reviseGraph, type FactInput, type FactCategory } from '../../../lib/local-qualification/graph';
import { auditClaims, type Claim } from '../../../lib/local-qualification/claim-audit';
import { auditCoverage, type InventoryReview } from '../../../lib/local-qualification/coverage-audit';

const source = createSource('Add anisole (2 g) and Pd catalyst to ethanol/water mixture.\r\nStir at 25 °C. Monitor by TLC. Wash with water (5 mL); wash with water (5 mL). The mixture gave product.');
function item(text: string, category: FactCategory, occurrence = 0): FactInput {
  const bytes = Buffer.from(source.bytes);
  let start = -1;
  for (let n = 0; n <= occurrence; n++) start = bytes.indexOf(Buffer.from(text), start + 1);
  return { category, anchor: anchor(source, start, start + Buffer.byteLength(text)), status: 'observed', derivationIds: [] };
}
const inventory: FactInput[] = [
  item('anisole', 'material'), item('2 g', 'quantity'), item('g', 'quantity'), item('Pd', 'material'), item('catalyst', 'role'),
  item('ethanol/water mixture', 'mixture'), item('ethanol', 'material'), item('water', 'material'), item('Stir', 'operation'),
  item('25 °C', 'condition'), item('Monitor by TLC', 'observation'), item('Wash', 'operation'), item('water', 'material', 1),
  item('5 mL', 'quantity'), item('mL', 'quantity'), item('wash', 'operation'), item('water', 'material', 2), item('5 mL', 'quantity', 1),
  { ...item('The mixture', 'unresolved-reference'), status: 'unknown' }, item('gave product', 'outcome'),
];
const review: InventoryReview = { sourceId: source.id, reviewedSpans: partitionSource(source, 32), candidates: inventory };
const claimFor = (f: ReturnType<typeof createGraph>['facts'][number]): Claim => ({ factId: f.id, category: f.category, anchor: f.anchor, quote: f.anchor.quote });

describe('closed claim audit', () => {
  it.each([true, false])('copies only declared anchor fields for accepted=%s claims', accepted => {
    const graph = createGraph(source, inventory);
    const original = claimFor(graph.facts[0]);
    const metadata = { nested: ['original'] };
    const supplied = { ...original, factId: accepted ? original.factId : 'unknown', anchor: { ...original.anchor, metadata } };
    const result = auditClaims(source, graph, [supplied]);
    const saved = accepted ? result.accepted[0] : result.rejected[0].claim;
    expect(result.valid).toBe(accepted);
    expect(Object.keys(saved.anchor).sort()).toEqual(['end', 'preimageHash', 'quote', 'sourceId', 'start']);
    const before = JSON.stringify(result);
    metadata.nested.push('changed');
    supplied.anchor.quote = 'changed';
    expect(JSON.stringify(result)).toBe(before);
    expect(Object.isFrozen(saved.anchor)).toBe(true);
    expect(Object.isFrozen(metadata)).toBe(false);
    expect(Object.isFrozen(supplied.anchor)).toBe(false);
  });
  it('binds existing fact ID, category, anchor and quote', () => {
    const graph = createGraph(source, inventory);
    const claim = claimFor(graph.facts[0]);
    expect(auditClaims(source, graph, [claim]).valid).toBe(true);
    const forgeries: Claim[] = [
      { ...claim, factId: 'invented' }, { ...claim, category: claim.category === 'role' ? 'quantity' : 'role' },
      { ...claim, quote: 'not source' }, { ...claim, anchor: { ...claim.anchor, start: claim.anchor.start + 1 } },
      { ...claim, anchor: graph.facts[1].anchor },
    ];
    const result = auditClaims(source, graph, forgeries);
    expect(result.valid).toBe(false);
    expect(result.rejected).toHaveLength(forgeries.length);
    expect(result.accepted).toHaveLength(0);
  });
  it('does not confuse closed claims with inventory completeness', () => {
    const graph = createGraph(source, inventory.slice(0, 1));
    expect(auditClaims(source, graph, graph.facts.map(claimFor)).valid).toBe(true);
    expect(auditCoverage(source, graph, review).coverageComplete).toBe(false);
  });
  it('does not validate empty claims or a foreign graph', () => {
    const graph = createGraph(source, inventory);
    expect(auditClaims(source, graph, []).valid).toBe(false);
    expect(() => auditClaims(createSource('foreign'), graph, graph.facts.map(claimFor))).toThrow();
  });
});

describe('independent source inventory coverage', () => {
  it.each(['anisole', 'Pd', 'ethanol/water mixture', '2 g', 'mL', 'Monitor by TLC', 'The mixture'])('detects whole omitted %s without worker IDs', text => {
    const omitted = inventory.find(f => f.anchor.quote === text)!;
    const graph = createGraph(source, inventory.filter(f => f !== omitted));
    const result = auditCoverage(source, graph, review);
    expect(result.coverageComplete).toBe(false);
    expect(result.missingCandidates).toContainEqual(omitted);
    expect(result.missingCandidates.every(c => !('factId' in c))).toBe(true);
    expect(result.uncoveredSpans).toEqual([]);
  });
  it('detects omission of a repeated wash or repeated water independently', () => {
    for (const removed of [item('wash', 'operation'), item('water', 'material', 2), item('5 mL', 'quantity', 1)]) {
      const graph = createGraph(source, inventory.filter(f => !(f.category === removed.category && f.anchor.start === removed.anchor.start)));
      const result = auditCoverage(source, graph, review);
      expect(result.missingCandidates).toContainEqual(removed);
    }
  });
  it('tracks reviewed-byte gaps including whitespace and never trusts candidate presence alone', () => {
    const graph = createGraph(source, inventory);
    const gap = source.text.indexOf(' '); // ASCII prefix
    const result = auditCoverage(source, graph, { ...review, reviewedSpans: [anchor(source, 0, gap), anchor(source, gap + 1, source.bytes.length)] });
    expect(result.uncoveredSpans.map(a => a.quote)).toEqual([' ']);
    expect(result.coverageComplete).toBe(false);
    expect(result.missingCandidates).toEqual([]);
  });
  it('separates representational coverage from unknown scientific interpretation', () => {
    const graph = createGraph(source, inventory);
    const result = auditCoverage(source, graph, review);
    expect(result.coverageComplete).toBe(true);
    expect(result.scientificInterpretationComplete).toBe(false);
    expect(result.unresolvedFactIds).toContain(graph.facts.find(f => f.category === 'unresolved-reference')!.id);
  });
  it('refuses empty extraction and empty independent inventory even with all spans reviewed', () => {
    expect(auditCoverage(source, createGraph(source, []), { ...review, candidates: [] }).coverageComplete).toBe(false);
    expect(auditCoverage(source, createGraph(source, inventory), { ...review, candidates: [] }).coverageComplete).toBe(false);
    const empty: Source = createSource('');
    expect(auditCoverage(empty, createGraph(empty, []), { sourceId: empty.id, reviewedSpans: [], candidates: [] }).coverageComplete).toBe(false);
  });
  it('fails closed on false candidate anchors and foreign inventory sources', () => {
    const graph = createGraph(source, inventory);
    expect(auditCoverage(source, graph, review).coverageComplete).toBe(true);
    expect(() => auditCoverage(source, graph, { ...review, sourceId: 'wrong' })).toThrow();
    expect(() => auditCoverage(source, graph, { ...review, candidates: [{ ...inventory[0], anchor: { ...inventory[0].anchor, quote: 'forged' } }] })).toThrow();
    expect(() => auditCoverage(source, graph, { ...review, reviewedSpans: [{ ...review.reviewedSpans[0], preimageHash: 'wrong' }] })).toThrow();
  });
  it('requires independent inventory matching full anchors, not just overlapping spans', () => {
    const target = inventory[0];
    const truncated = { ...target, anchor: anchor(source, target.anchor.start, target.anchor.end - 1) };
    const graph = createGraph(source, [truncated, ...inventory.slice(1)]);
    expect(auditCoverage(source, graph, review).missingCandidates).toContainEqual(target);
  });
  it('repairs by creating a new version and preserves the failed original audit', () => {
    const original = createGraph(source, inventory.slice(1));
    const before = auditCoverage(source, original, review);
    const repaired = reviseGraph(source, original, inventory);
    expect(before.coverageComplete).toBe(false);
    expect(auditCoverage(source, original, review).coverageComplete).toBe(false);
    expect(auditCoverage(source, repaired, review).coverageComplete).toBe(true);
    expect(repaired.parentRevisionId).toBe(original.id);
  });
});
