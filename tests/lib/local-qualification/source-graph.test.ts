import { describe, expect, it, vi } from 'vitest';
import * as S from '../../../lib/local-qualification/source';
import * as G from '../../../lib/local-qualification/graph';

const occurrence = (source: S.Source, text: string, from = 0) => {
  const bytes = Buffer.from(source.bytes);
  const start = bytes.indexOf(Buffer.from(text), from);
  return S.anchor(source, start, start + Buffer.byteLength(text));
};
const fact = (source: S.Source, text: string, category: G.FactCategory = 'material', from = 0): G.FactInput => ({
  category, anchor: occurrence(source, text, from), status: 'observed', derivationIds: [],
});

describe('immutable UTF-8 source', () => {
  it('preserves exact raw bytes including BOM and hashes the preimage', () => {
    const input = Buffer.from('\ufeffα\r\nwater 🧪\n');
    const original = Buffer.from(input);
    const source = S.createSource(input);
    input.fill(0);
    expect(Buffer.from(source.bytes)).toEqual(original);
    expect(source.text).toBe(original.toString('utf8'));
    expect(source.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(S.createSource(original).id).toBe(source.id);
    expect(S.createSource(original.toString('utf8').replace('\r\n', '\n')).id).not.toBe(source.id);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.bytes)).toBe(true);
  });
  it('rejects invalid UTF-8 rather than replacing bytes silently', () => {
    for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf0, 0x9f], [0xff]]) {
      expect(() => S.createSource(Uint8Array.from(bytes))).toThrow(/UTF-8/);
    }
    expect(() => S.createSource('\ud800')).toThrow(/surrogate|UTF-8/);
  });
  it('uses half-open byte offsets and verifies quote and preimage', () => {
    const source = S.createSource('α water 🧪');
    const a = S.anchor(source, 3, 8);
    expect(a.quote).toBe('water');
    expect(S.verifyAnchor(source, a)).toBe(true);
    for (const falseAnchor of [{ ...a, quote: 'ether' }, { ...a, start: 2 }, { ...a, sourceId: 'wrong' }, { ...a, preimageHash: 'wrong' }]) {
      expect(S.verifyAnchor(source, falseAnchor)).toBe(false);
    }
    for (const [start, end] of [[0, 1], [-1, 2], [2, 99], [3, 3], [3.5, 8]]) {
      expect(() => S.anchor(source, start, end)).toThrow();
    }
  });
  it('normalizes CRLF with reversible byte maps without changing raw identity', () => {
    const source = S.createSource('α\r\n🧪\r\nx\r');
    const derived = S.normalizeCRLF(source);
    expect(derived.text).toBe('α\n🧪\nx\r');
    expect(Buffer.from(S.restoreCRLF(source, derived))).toEqual(Buffer.from(source.bytes));
    for (let i = 0; i < derived.normalizedToRaw.length; i++) {
      expect(derived.rawToNormalized[derived.normalizedToRaw[i]]).toBe(i);
    }
    expect(derived.rawToNormalized[3]).toBe(null); // interior of collapsed CRLF
    expect(() => S.restoreCRLF(S.createSource('other'), derived)).toThrow();
    expect(() => S.restoreCRLF(source, { ...derived, text: 'forged' })).toThrow();
  });
  it('partitions every byte including whitespace with bounded UTF-8 anchors', () => {
    const source = S.createSource(' α\r\n\twater 🧪  \n');
    const ledger = S.partitionSource(source, 6);
    expect(ledger[0].start).toBe(0);
    expect(ledger.at(-1)?.end).toBe(source.bytes.length);
    expect(ledger.map(a => a.quote).join('')).toBe(source.text);
    ledger.forEach((a, i) => {
      expect(a.end - a.start).toBeLessThanOrEqual(6);
      expect(S.verifyAnchor(source, a)).toBe(true);
      if (i) expect(a.start).toBe(ledger[i - 1].end);
    });
    expect(() => S.partitionSource(source, 3)).toThrow(/code point|UTF-8/);
    expect(S.partitionSource(S.createSource(''), 4)).toEqual([]);
  });
  it('creates bounded overlapping windows without gaps or infinite loops', () => {
    const source = S.createSource('α water 🧪 wash water wash');
    const windows = S.sourceWindows(source, 10, 4);
    expect(windows[0].start).toBe(0);
    expect(windows.at(-1)?.end).toBe(source.bytes.length);
    windows.forEach((a, i) => {
      expect(S.verifyAnchor(source, a)).toBe(true);
      expect(a.end - a.start).toBeLessThanOrEqual(10);
      if (i) { expect(a.start).toBeLessThan(windows[i - 1].end); expect(a.start).toBeGreaterThan(windows[i - 1].start); }
    });
    expect(() => S.sourceWindows(source, 4, 4)).toThrow();
    expect(() => S.sourceWindows(source, 4, -1)).toThrow();
  });
});

describe('runtime immutability and bulk work budgets', () => {
  it('rejects non-string parent IDs at creation and deserialization', () => {
    const source = S.createSource('water');
    const inputs = [fact(source, 'water')];
    const parent = S.sha256('parent');
    for (const invalid of [[parent], { toString: () => parent }, 1, true]) {
      expect(() => G.createGraph(source, inputs, [], invalid as unknown as string)).toThrow(/parent/);
    }
    const graph = G.createGraph(source, inputs, [], parent);
    const decoded = JSON.parse(JSON.stringify(graph));
    decoded.parentRevisionId = [parent];
    const data = { ...decoded };
    delete data.id;
    decoded.id = S.sha256(JSON.stringify(data));
    expect(() => G.assertGraph(source, decoded)).toThrow(/parent/);
    decoded.parentRevisionId.push('mutation');
    expect(graph.parentRevisionId).toBe(parent);
    expect(() => G.assertGraph(source, graph)).not.toThrow();
  });
  it.each(['partition', 'windows'])('validates source only once for bulk %s', mode => {
    const original = S.createSource('x'.repeat(128));
    const bytes = [...original.bytes];
    const source = { ...original, bytes };
    // Count real full-source decodes, including decodes of defensive copies.
    const decode = vi.spyOn(TextDecoder.prototype, 'decode');
    let spans: readonly S.Anchor[];
    let validations: number;
    try {
      spans = mode === 'partition' ? S.partitionSource(source, 1) : S.sourceWindows(source, 8, 7);
      validations = decode.mock.calls.filter(([input]) => input?.byteLength === 128).length;
    } finally { decode.mockRestore(); }
    expect(spans[0].start).toBe(0);
    expect(spans.at(-1)?.end).toBe(128);
    expect(spans.length).toBe(mode === 'partition' ? 128 : 121);
    expect(validations).toBe(1);
    bytes[0] = 0;
    expect(spans[0].quote).toBe(mode === 'partition' ? 'x' : 'xxxxxxxx');
    expect(() => S.partitionSource(source, 1)).toThrow(/preimage/);
    expect(S.verifyAnchor(source, spans[0])).toBe(false);
  });
  it('does not reconstruct every fact for every deserialized edge', () => {
    const source = S.createSource('water wash');
    const inputs = [fact(source, 'water'), fact(source, 'wash', 'operation')];
    const base = G.createGraph(source, inputs);
    const edges = Array.from({ length: 32 }, (_, i) => ({ fromFactId: base.facts[0].id, toFactId: base.facts[1].id, relation: `relation-${i}`, anchor: inputs[0].anchor, status: 'observed' as const, derivationIds: [] }));
    const graph = JSON.parse(JSON.stringify(G.createGraph(source, inputs, edges))) as G.GraphRevision;
    let categoryReads = 0;
    const measured = { ...graph, facts: graph.facts.map(f => ({ ...f, get category() { categoryReads++; return f.category; } })) };
    G.assertGraph(source, measured);
    expect(categoryReads).toBeLessThanOrEqual(4 * inputs.length);
  });
});

describe('versioned anchored graph', () => {
  it('exports the complete fact vocabulary', () => {
    expect([...G.FACT_CATEGORIES]).toEqual(['material', 'mixture', 'quantity', 'role', 'operation', 'condition', 'observation', 'outcome', 'unresolved-reference', 'unclassified']);
  });
  it('deduplicates exact facts but preserves repeated roles and occurrences', () => {
    const source = S.createSource('water solvent; water wash; water wash');
    const first = fact(source, 'water');
    const second = fact(source, 'water', 'material', first.anchor.end);
    const third = fact(source, 'water', 'material', second.anchor.end);
    const graph = G.createGraph(source, [first, first, second, third, fact(source, 'water', 'role')]);
    expect(graph.facts).toHaveLength(4);
    expect(new Set(graph.facts.map(f => f.id)).size).toBe(4);
    expect(G.createGraph(source, [third, second, first, fact(source, 'water', 'role')]).id).toBe(graph.id);
    expect(Object.isFrozen(graph.facts[0].derivationIds)).toBe(true);
    expect(Object.isFrozen(graph.facts[0].anchor)).toBe(true);
  });
  it('requires grounded facts, explicit knowledge state and inferred derivations', () => {
    const source = S.createSource('the mixture');
    const base = fact(source, 'the mixture', 'unresolved-reference');
    expect(G.createGraph(source, [{ ...base, status: 'unknown' }]).facts[0].status).toBe('unknown');
    expect(() => G.createGraph(source, [{ ...base, anchor: { ...base.anchor, quote: 'water' } }])).toThrow();
    expect(() => G.createGraph(source, [{ ...base, status: 'inferred' }])).toThrow(/derivation/);
    expect(() => G.createGraph(source, [{ ...base, category: 'invented' as G.FactCategory }])).toThrow();
    expect(() => G.createGraph(source, [{ ...base, status: undefined } as unknown as G.FactInput])).toThrow();
    expect(G.createGraph(source, [{ ...base, status: 'inferred', derivationIds: ['derivation:rule-1'] }]).facts[0].status).toBe('inferred');
  });
  it('rejects swapped content IDs on deserialized edges', () => {
    const source = S.createSource('water wash');
    const facts = [fact(source, 'water'), fact(source, 'wash', 'operation')];
    const graph = G.createGraph(source, facts);
    const edge = { fromFactId: graph.facts[0].id, toFactId: graph.facts[1].id, relation: 'used-in', anchor: facts[0].anchor, status: 'observed' as const, derivationIds: [] };
    const linked = G.createGraph(source, facts, [edge, { ...edge, relation: 'precedes' }]);
    const forged = { ...linked, edges: linked.edges.map((e, i) => ({ ...e, id: linked.edges[1 - i].id })) };
    expect(() => G.assertGraph(source, forged)).toThrow(/content-address/);
  });
  it('content-addresses edges and repairs as new immutable revisions', () => {
    const source = S.createSource('water wash');
    const a = fact(source, 'water');
    const b = fact(source, 'wash', 'operation');
    const old = G.createGraph(source, [a, b]);
    const edge: G.EdgeInput = { fromFactId: old.facts.find(f => f.category === 'material')!.id, toFactId: old.facts.find(f => f.category === 'operation')!.id, relation: 'used-in', anchor: b.anchor, status: 'observed', derivationIds: [] };
    const repaired = G.reviseGraph(source, old, [a, b, fact(source, 'wash', 'role')], [edge, edge]);
    expect(repaired.parentRevisionId).toBe(old.id);
    expect(repaired.id).not.toBe(old.id);
    expect(old.facts).toHaveLength(2);
    expect(old.edges).toHaveLength(0);
    expect(repaired.edges).toHaveLength(1);
    expect(repaired.edges[0].id).toMatch(/^sha256:/);
    expect(Object.isFrozen(repaired.edges[0])).toBe(true);
    expect(() => G.createGraph(source, [a], [edge])).toThrow(/endpoint/);
    expect(() => G.reviseGraph(S.createSource('other'), old, [])).toThrow();
  });
});
