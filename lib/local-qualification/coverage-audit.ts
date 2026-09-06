import { anchor, verifyAnchor, type Anchor, type Source } from './source';
import { assertGraph, canonicalFact, type FactInput, type GraphRevision } from './graph';

/** Independently identified source candidate; never requires a worker's ID. */
export type InventoryCandidate = FactInput;
export interface InventoryReview {
  readonly sourceId: string;
  readonly reviewedSpans: readonly Anchor[];
  readonly candidates: readonly InventoryCandidate[];
}
export interface CoverageAudit {
  readonly sourceId: string;
  readonly graphRevisionId: string;
  readonly coverageComplete: boolean;
  /** No scientific adjudicator runs in this module. Always explicitly unassessed. */
  readonly scientificInterpretationComplete: false;
  readonly scientificInterpretationStatus: 'not-assessed';
  readonly missingCandidates: readonly InventoryCandidate[];
  readonly uncoveredSpans: readonly Anchor[];
  readonly unresolvedFactIds: readonly string[];
  readonly reviewedByteCount: number;
  readonly totalByteCount: number;
}
/** Compare an independently supplied full-source review; do not generate one from claims. */
export function auditCoverage(source: Source, graph: GraphRevision, review: InventoryReview): CoverageAudit {
  assertGraph(source, graph);
  if (review.sourceId !== source.id) throw new Error('Inventory source mismatch');
  for (const span of review.reviewedSpans) if (!verifyAnchor(source, span)) throw new Error('Invalid inventory review span');
  const candidates = review.candidates.map(candidate => {
    if ('factId' in candidate || 'id' in candidate) throw new Error('Independent inventory must not carry worker IDs');
    return canonicalFact(source, candidate);
  });
  const graphIds = new Set(graph.facts.map(f => f.id));
  const missingCandidates = [...new Map(candidates.filter(f => !graphIds.has(f.id)).map(f => [f.id, f])).values()].map(f => {
    return Object.freeze({ category: f.category, anchor: f.anchor, status: f.status, derivationIds: f.derivationIds, ...(f.value === undefined ? {} : { value: f.value }) });
  });
  const uncoveredSpans: Anchor[] = [];
  let cursor = 0;
  for (const span of [...review.reviewedSpans].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (span.start > cursor) uncoveredSpans.push(anchor(source, cursor, span.start));
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < source.bytes.length) uncoveredSpans.push(anchor(source, cursor, source.bytes.length));
  const unresolvedFactIds = graph.facts.filter(f => f.status === 'unknown' || f.category === 'unresolved-reference' || f.category === 'unclassified').map(f => f.id);
  const coverageComplete = source.bytes.length > 0 && graph.facts.length > 0 && candidates.length > 0 && uncoveredSpans.length === 0 && missingCandidates.length === 0;
  return Object.freeze({ sourceId: source.id, graphRevisionId: graph.id, coverageComplete, scientificInterpretationComplete: false, scientificInterpretationStatus: 'not-assessed', missingCandidates: Object.freeze(missingCandidates), uncoveredSpans: Object.freeze(uncoveredSpans), unresolvedFactIds: Object.freeze(unresolvedFactIds), reviewedByteCount: source.bytes.length - uncoveredSpans.reduce((total, span) => total + span.end - span.start, 0), totalByteCount: source.bytes.length });
}
