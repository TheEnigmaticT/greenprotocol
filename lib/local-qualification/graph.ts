import { anchor, assertSource, sha256, verifyAnchor, type Anchor, type Source } from './source';

export const FACT_CATEGORIES = Object.freeze(['material', 'mixture', 'quantity', 'role', 'operation', 'condition', 'observation', 'outcome', 'unresolved-reference', 'unclassified'] as const);
export type FactCategory = typeof FACT_CATEGORIES[number];
export type KnowledgeStatus = 'observed' | 'inferred' | 'unknown';
export interface FactInput {
  readonly category: FactCategory;
  readonly anchor: Anchor;
  readonly status: KnowledgeStatus;
  readonly derivationIds: readonly string[];
  readonly value?: string;
}
export interface Fact extends FactInput { readonly id: string }
export interface EdgeInput {
  readonly fromFactId: string;
  readonly toFactId: string;
  readonly relation: string;
  readonly anchor: Anchor;
  readonly status: KnowledgeStatus;
  readonly derivationIds: readonly string[];
}
export interface Edge extends EdgeInput { readonly id: string }
export interface GraphRevision {
  readonly id: string;
  readonly schemaVersion: 'source-graph/v1';
  readonly sourceId: string;
  readonly parentRevisionId: string | null;
  readonly facts: readonly Fact[];
  readonly edges: readonly Edge[];
}
function provenance(input: Pick<FactInput, 'status' | 'derivationIds'>): readonly string[] {
  if (!['observed', 'inferred', 'unknown'].includes(input.status)) throw new Error('Explicit knowledge status required');
  if (!Array.isArray(input.derivationIds) || input.derivationIds.some(id => typeof id !== 'string' || !id.trim()) || (input.status === 'inferred' && !input.derivationIds.length)) throw new Error('Explicit derivation IDs required for inference');
  return Object.freeze([...new Set(input.derivationIds)].sort());
}
export function canonicalFact(source: Source, input: FactInput): Fact {
  if (!FACT_CATEGORIES.includes(input.category)) throw new Error('Unknown fact category');
  if (!verifyAnchor(source, input.anchor)) throw new Error('Invalid fact anchor');
  if (input.value !== undefined && typeof input.value !== 'string') throw new Error('Fact value must be a string');
  const data = { category: input.category, anchor: anchor(source, input.anchor.start, input.anchor.end), status: input.status, derivationIds: provenance(input), ...(input.value === undefined ? {} : { value: input.value }) };
  return Object.freeze({ ...data, id: sha256(JSON.stringify({ kind: 'fact/v1', ...data })) });
}
function unique<T extends { readonly id: string }>(items: readonly T[]): readonly T[] {
  return Object.freeze([...new Map(items.map(item => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id)));
}
function canonicalEdge(source: Source, input: EdgeInput, ids: ReadonlySet<string>): Edge {
  if (!ids.has(input.fromFactId) || !ids.has(input.toFactId)) throw new Error('Unknown edge endpoint');
  if (typeof input.relation !== 'string' || !input.relation.trim() || !verifyAnchor(source, input.anchor)) throw new Error('Invalid anchored edge');
  const data = { fromFactId: input.fromFactId, toFactId: input.toFactId, relation: input.relation, anchor: anchor(source, input.anchor.start, input.anchor.end), status: input.status, derivationIds: provenance(input) };
  return Object.freeze({ ...data, id: sha256(JSON.stringify({ kind: 'edge/v1', ...data })) });
}
export function createGraph(source: Source, inputs: readonly FactInput[], edgeInputs: readonly EdgeInput[] = [], parentRevisionId: string | null = null): GraphRevision {
  assertSource(source);
  if (parentRevisionId !== null && (typeof parentRevisionId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(parentRevisionId))) throw new Error('Invalid parent revision ID');
  const facts = unique(inputs.map(input => canonicalFact(source, input)));
  const ids = new Set(facts.map(f => f.id));
  const edges = unique(edgeInputs.map(input => canonicalEdge(source, input, ids)));
  const data = { schemaVersion: 'source-graph/v1' as const, sourceId: source.id, parentRevisionId, facts, edges };
  return Object.freeze({ ...data, id: sha256(JSON.stringify(data)) });
}
/** Validate deserialized input as well as in-process immutable revisions. */
export function assertGraph(source: Source, graph: GraphRevision): void {
  if (graph.sourceId !== source.id || graph.schemaVersion !== 'source-graph/v1') throw new Error('Graph source/version mismatch');
  const actual = createGraph(source, graph.facts, graph.edges, graph.parentRevisionId);
  const ids = new Set(actual.facts.map(f => f.id));
  if (actual.id !== graph.id || actual.facts.length !== graph.facts.length || actual.edges.length !== graph.edges.length || graph.facts.some(f => canonicalFact(source, f).id !== f.id) || graph.edges.some(e => canonicalEdge(source, e, ids).id !== e.id)) throw new Error('Graph content-address mismatch');
}
/** The supplied facts/edges are a complete replacement snapshot, not a delta. */
export function reviseGraph(source: Source, previous: GraphRevision, facts: readonly FactInput[], edges: readonly EdgeInput[] = []): GraphRevision {
  assertGraph(source, previous);
  return createGraph(source, facts, edges, previous.id);
}
