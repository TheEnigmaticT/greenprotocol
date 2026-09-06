import { describe, expect, it } from 'vitest';
import * as jobs from '../../../lib/local-qualification/extraction-jobs';
import { createSource, anchor } from '../../../lib/local-qualification/source';
import type { QualificationRequest } from '../../../lib/local-qualification/provider';

const source = createSource('β-water 5 mL; wash 3 × 2 mL; TLC; unknown ratio.');
const manifest = (role: 'extraction' | 'inventory', family: 'qwen' | 'gemma' = 'gemma'): jobs.ExtractionJobManifest => ({
  id: `synthetic-${family}-${role}`, role, family,
  model: family === 'gemma' ? 'google/gemma-synthetic' : 'qwen/qwen-synthetic',
  outputKind: family === 'gemma' ? 'json_schema' : 'tool',
  maxSourceBytes: 1024, maxPromptTokens: 30000, maxCompletionTokens: 4000,
  prices: { prompt: 0, completion: 0, request: 0 }, attempt: 1,
});
function span(text: string) {
  const start = Buffer.byteLength(source.text.slice(0, source.text.indexOf(text)));
  return { start, end: start + Buffer.byteLength(text), quote: text };
}
function output() {
  return {
    candidates: [
      { category: 'material', anchor: span('β-water'), status: 'observed', value: 'β-water' },
      { category: 'quantity', anchor: span('5 mL'), status: 'observed', value: '5 mL' },
      { category: 'operation', anchor: span('wash 3 × 2 mL'), status: 'observed', value: 'wash 3 × 2 mL' },
      { category: 'observation', anchor: span('TLC'), status: 'observed', value: 'TLC' },
      { category: 'unclassified', anchor: span('unknown ratio.'), status: 'unknown', value: null },
    ],
    edges: [{ from: 1, to: 0, relation: 'quantity-of', anchor: span('β-water 5 mL'), status: 'observed' }],
    dispositions: [{ anchor: span(source.text), kind: 'facts', candidateIndices: [0, 1, 2, 3, 4], reason: null }],
  };
}
function transport(value: unknown, requests: QualificationRequest[] = []) {
  return { async execute(request: QualificationRequest) {
    requests.push(request);
    return { value, model: request.model, tupleHash: request.tupleHash, attempt: request.attempt };
  } };
}

describe('concrete source extraction jobs (synthetic transport; model qualification pending)', () => {
  it('exports callable concrete role adapters', () => {
    expect(jobs.runExtractionJob).toBeTypeOf('function');
    expect(jobs.runInventoryJob).toBeTypeOf('function');
    expect(jobs.auditExtractionJobs).toBeTypeOf('function');
  });
  it('runs source-only independent inventory and audits every extracted candidate without scientific claims', async () => {
    const extraction = await jobs.runExtractionJob(source, manifest('extraction'), transport(output()));
    const inventoryPayload = { candidates: output().candidates, dispositions: output().dispositions };
    const requests: QualificationRequest[] = [];
    const inventory = await jobs.runInventoryJob(source, manifest('inventory'), transport(inventoryPayload, requests));
    const prompt = requests[0].messages.map(m => m.content).join('\n');
    for (const fact of extraction.graph.facts) expect(prompt).not.toContain(fact.id);
    expect(prompt).not.toContain(extraction.graph.id);
    expect(prompt).toContain('independent');
    expect(inventory.review.candidates).toHaveLength(5);
    expect(inventory.review.candidates.every(c => !('id' in c))).toBe(true);
    const audit = jobs.auditExtractionJobs(source, extraction, inventory);
    expect(audit.coverage.coverageComplete).toBe(true);
    expect(audit.coverage.scientificInterpretationStatus).toBe('not-assessed');
    expect(audit.claims.accepted).toHaveLength(extraction.graph.facts.length);
    expect(audit.claims.valid).toBe(true);
  });
  it('finds an omission through inventory even when every worker claim passes', async () => {
    const payload = output();
    payload.candidates.pop();
    payload.dispositions[0].candidateIndices.pop();
    const extraction = await jobs.runExtractionJob(source, manifest('extraction'), transport(payload));
    const inventory = await jobs.runInventoryJob(source, manifest('inventory'), transport({ candidates: output().candidates, dispositions: output().dispositions }));
    const audit = jobs.auditExtractionJobs(source, extraction, inventory);
    expect(audit.claims.valid).toBe(true);
    expect(audit.coverage.coverageComplete).toBe(false);
    expect(audit.coverage.missingCandidates).toHaveLength(1);
  });
  const malformed: [string, (v: ReturnType<typeof output>) => void][] = [
    ['top-level extra property', v => { Object.assign(v, { confidence: 1 }); }],
    ['candidate extra property', v => { Object.assign(v.candidates[0], { confidence: 1 }); }],
    ['anchor extra property', v => { Object.assign(v.candidates[0].anchor, { startChar: 0 }); }],
    ['missing field', v => { Reflect.deleteProperty(v.candidates[0], 'status'); }],
    ['invalid category', v => { v.candidates[0].category = 'solvent'; }],
    ['invented literal', v => { v.candidates[0].value = 'ethanol'; }],
    ['observed without literal', v => { v.candidates[0].value = null; }],
    ['unknown with guessed value', v => { v.candidates[4].value = '1:1'; }],
    ['unclassified asserted observed', v => { v.candidates[4].status = 'observed'; v.candidates[4].value = 'unknown ratio.'; }],
    ['unsupported inference', v => { v.candidates[0].status = 'inferred'; }],
    ['wrong exact quote', v => { v.candidates[0].anchor.quote = 'b-water'; }],
    ['UTF-16 instead of byte offsets', v => { v.candidates[0].anchor.end--; }],
    ['split UTF-8 codepoint', v => { v.candidates[0].anchor.start = 1; }],
    ['negative offset', v => { v.candidates[0].anchor.start = -1; }],
    ['fractional offset', v => { v.candidates[0].anchor.start = 0.5; }],
    ['unreviewed source', v => { v.dispositions = []; }],
    ['gap in disposition ledger', v => { v.dispositions[0].anchor = span(source.text.slice(1)); }],
    ['overlapping dispositions', v => { v.dispositions.push(v.dispositions[0]); }],
    ['undisposed candidate', v => { v.dispositions[0].candidateIndices.pop(); }],
    ['unknown disposition reference', v => { v.dispositions[0].candidateIndices.push(20); }],
    ['duplicate disposition reference', v => { v.dispositions[0].candidateIndices.push(0); }],
    ['duplicate candidate silently deduplicated', v => { v.candidates.push(v.candidates[0]); v.dispositions[0].candidateIndices.push(5); }],
    ['unknown edge endpoint', v => { v.edges[0].from = 90; }],
    ['unsupported edge relation', v => { v.edges[0].relation = 'causes'; }],
    ['wrong relation categories', v => { v.edges[0].from = 0; v.edges[0].to = 1; }],
    ['self dependency', v => { v.edges[0].from = 2; v.edges[0].to = 2; v.edges[0].relation = 'depends-on'; }],
    ['unanchored dependency', v => { v.edges[0].anchor = span('TLC'); }],
    ['duplicate edges', v => { v.edges.push(v.edges[0]); }],
    ['ignored procedural candidates', v => { Object.assign(v.dispositions[0], { kind: 'non-procedural', reason: 'ignore' }); }],
    ['unclassified disposition without unknown candidate', v => { v.dispositions[0].kind = 'unclassified'; }],
  ];
  it.each(malformed)('rejects %s rather than dropping facts, even if transport skips its validator', async (_name, mutate) => {
    const payload = output(); mutate(payload);
    const requests: QualificationRequest[] = [];
    await expect(jobs.runExtractionJob(source, manifest('extraction'), transport(payload, requests))).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0].validate(payload)).toBe(false);
  });
  it('rejects worker IDs or edges in independent inventory output', async () => {
    for (const payload of [output(), { candidates: output().candidates.map(c => ({ ...c, id: 'worker-id' })), dispositions: output().dispositions }]) {
      await expect(jobs.runInventoryJob(source, manifest('inventory'), transport(payload))).rejects.toThrow();
    }
  });
  it('uses bounded whole-source windows, distinct tuple identities, and complete dispositions', async () => {
    const multi = createSource('αβγδ');
    const seen: QualificationRequest[] = [];
    const result = await jobs.runInventoryJob(multi, { ...manifest('inventory'), maxSourceBytes: 4 }, {
      async execute(request) {
        seen.push(request);
        const context = JSON.parse(request.messages[1].content);
        const a = context.sourceWindow;
        const value = { candidates: [{ category: 'unclassified', anchor: { start: a.start, end: a.end, quote: a.quote }, status: 'unknown', value: null }], dispositions: [{ anchor: { start: a.start, end: a.end, quote: a.quote }, kind: 'unclassified', candidateIndices: [0], reason: null }] };
        return { value, model: request.model, tupleHash: request.tupleHash, attempt: request.attempt };
      },
    });
    expect(seen).toHaveLength(2);
    expect(new Set(seen.map(r => r.tupleHash)).size).toBe(2);
    expect(result.review.reviewedSpans.map(s => s.quote)).toEqual(['αβ', 'γδ']);
    expect(result.review.reviewedSpans.reduce((n, s) => n + s.end - s.start, 0)).toBe(multi.bytes.length);
    expect(seen.every(r => !r.messages[1].content.includes(multi.text))).toBe(true);
  });
  it('permits explicitly reasoned non-procedural spans but never calls them scientifically assessed', async () => {
    const s = createSource('Title');
    const a = { start: 0, end: 5, quote: 'Title' };
    const result = await jobs.runInventoryJob(s, manifest('inventory'), transport({ candidates: [], dispositions: [{ anchor: a, kind: 'non-procedural', candidateIndices: [], reason: 'Document title only' }] }));
    expect(result.review.candidates).toEqual([]);
    expect(result.review.reviewedSpans).toEqual([anchor(s, 0, 5)]);
  });
  it('fails before transport for wrong role, non-Qwen/Gemma identity, empty source or exceeded prompt bound', async () => {
    const requests: QualificationRequest[] = [];
    for (const m of [manifest('inventory'), { ...manifest('extraction'), model: 'other/model' }, { ...manifest('extraction'), maxPromptTokens: 1 }, { ...manifest('extraction'), attempt: 4 }, { ...manifest('extraction'), maxSourceBytes: 0 }]) {
      await expect(jobs.runExtractionJob(source, m, transport(output(), requests))).rejects.toThrow();
    }
    await expect(jobs.runExtractionJob(createSource(''), manifest('extraction'), transport(output(), requests))).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it('fails closed on identity mismatch and transport failure without retry or fallback', async () => {
    for (const changes of [{ model: 'other/model' }, { tupleHash: 'b'.repeat(64) }, { attempt: 2 }]) {
      await expect(jobs.runExtractionJob(source, manifest('extraction'), { async execute(r) { return { value: output(), model: r.model, tupleHash: r.tupleHash, attempt: r.attempt, ...changes }; } })).rejects.toThrow();
    }
    let calls = 0;
    await expect(jobs.runExtractionJob(source, manifest('extraction'), { async execute() { calls++; throw new Error('synthetic failure'); } })).rejects.toThrow('synthetic failure');
    expect(calls).toBe(1);
  });
  it('rejects cyclic step dependencies instead of accepting an impossible operation graph', async () => {
    const s = createSource('Stir. Filter.');
    const full = { start: 0, end: 13, quote: s.text };
    const payload = { candidates: [
      { category: 'operation', anchor: { start: 0, end: 5, quote: 'Stir.' }, status: 'observed', value: 'Stir.' },
      { category: 'operation', anchor: { start: 6, end: 13, quote: 'Filter.' }, status: 'observed', value: 'Filter.' },
    ], edges: [
      { from: 0, to: 1, relation: 'depends-on', anchor: full, status: 'observed' },
      { from: 1, to: 0, relation: 'depends-on', anchor: full, status: 'observed' },
    ], dispositions: [{ anchor: full, kind: 'facts', candidateIndices: [0, 1], reason: null }] };
    await expect(jobs.runExtractionJob(s, manifest('extraction'), transport(payload))).rejects.toThrow(/cycl/i);
  });
  it('rejects contradictory next-step versus depends-on order', async () => {
    const s = createSource('Stir. Filter.');
    const full = { start: 0, end: 13, quote: s.text };
    const payload = { candidates: [
      { category: 'operation', anchor: { start: 0, end: 5, quote: 'Stir.' }, status: 'observed', value: 'Stir.' },
      { category: 'operation', anchor: { start: 6, end: 13, quote: 'Filter.' }, status: 'observed', value: 'Filter.' },
    ], edges: [
      { from: 0, to: 1, relation: 'depends-on', anchor: full, status: 'observed' },
      { from: 0, to: 1, relation: 'next-step', anchor: full, status: 'observed' },
    ], dispositions: [{ anchor: full, kind: 'facts', candidateIndices: [0, 1], reason: null }] };
    await expect(jobs.runExtractionJob(s, manifest('extraction'), transport(payload))).rejects.toThrow(/cycl/i);
  });
  it('rejects non-JSON array properties rather than silently discarding model output data', async () => {
    const payload = output();
    Object.assign(payload.candidates, { hiddenFact: 'ethanol' });
    await expect(jobs.runExtractionJob(source, manifest('extraction'), transport(payload))).rejects.toThrow();
  });
  it('keeps independent inventory validations as strict as extraction', async () => {
    for (const [, mutate] of malformed.filter(([name]) => !name.includes('edge') && !name.includes('dependency') && !name.includes('relation'))) {
      const payload = output(); mutate(payload);
      const inventory: Partial<ReturnType<typeof output>> = payload;
      delete inventory.edges;
      const requests: QualificationRequest[] = [];
      await expect(jobs.runInventoryJob(source, manifest('inventory'), transport(inventory, requests))).rejects.toThrow();
      expect(requests[0].validate(inventory)).toBe(false);
    }
  });
  it('pins an explicitly supplied provider slug and content-addressed role evidence without defaults', async () => {
    const requests: QualificationRequest[] = [];
    await jobs.runExtractionJob(source, { ...manifest('extraction'), providerSlug: 'synthetic/pinned' }, transport(output(), requests));
    expect(requests[0].providerSlug).toBe('synthetic/pinned');
    expect(requests[0].evidence?.sourceHash).toBe(source.id.slice(7));
    expect(requests[0].evidence?.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(requests[0].evidence?.role).toBe('extraction');
    const unpinned: QualificationRequest[] = [];
    await jobs.runExtractionJob(source, manifest('extraction'), transport(output(), unpinned));
    expect(unpinned[0].providerSlug).toBeUndefined();
    expect(unpinned[0].tupleHash).not.toBe(requests[0].tupleHash);
  });
  it('freezes requests and snapshots caller manifests before injected code can mutate them', async () => {
    const m = manifest('extraction');
    const result = await jobs.runExtractionJob(source, m, { async execute(request) {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.messages)).toBe(true);
      Object.assign(m, { model: 'other/model', role: 'inventory' });
      return { value: output(), model: request.model, tupleHash: request.tupleHash, attempt: request.attempt };
    } });
    expect(result.manifest.role).toBe('extraction');
    expect(result.manifest.model).toBe('google/gemma-synthetic');
  });
  it.each(['qwen', 'gemma'] as const)('constructs an explicit %s role request and immutable grounded graph', async family => {
    const requests: QualificationRequest[] = [];
    const response = output();
    const result = await jobs.runExtractionJob(source, manifest('extraction', family), transport(response, requests));
    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe(manifest('extraction', family).model);
    expect(requests[0].output.kind).toBe(manifest('extraction', family).outputKind);
    expect(requests[0].output.schema.additionalProperties).toBe(false);
    expect(requests[0].validate(response)).toBe(true);
    const prompt = requests[0].messages.map(m => m.content).join('\n');
    for (const literal of ['UTF-8', 'mixture', 'basis', 'monitoring', 'repeated', 'dependencies', 'unclassified', 'not scientific truth']) expect(prompt).toContain(literal);
    expect(prompt).toContain(source.text);
    expect(result.graph.facts).toHaveLength(5);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.facts.find(f => f.category === 'material')?.anchor).toEqual(anchor(source, 0, Buffer.byteLength('β-water')));
    expect(result.graph.facts.find(f => f.category === 'unclassified')?.status).toBe('unknown');
    expect(Object.isFrozen(result.graph.facts[0].anchor)).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    response.candidates[0].value = 'tampered';
    expect(result.graph.facts.some(f => f.value === 'tampered')).toBe(false);
    expect(result.manifest.id).toBe(manifest('extraction', family).id);
  });
});
