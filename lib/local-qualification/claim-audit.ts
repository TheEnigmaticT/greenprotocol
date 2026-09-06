import { verifyAnchor, type Anchor, type Source } from './source';
import { assertGraph, type FactCategory, type GraphRevision } from './graph';

export interface Claim {
  readonly factId: string;
  readonly category: FactCategory;
  readonly anchor: Anchor;
  readonly quote: string;
}
export interface ClaimRejection { readonly claim: Claim; readonly reason: string }
export interface ClaimAudit {
  readonly sourceId: string;
  readonly graphRevisionId: string;
  readonly valid: boolean;
  readonly accepted: readonly Claim[];
  readonly rejected: readonly ClaimRejection[];
}
function snapshot(claim: Claim): Claim {
  const { sourceId, start, end, quote, preimageHash } = claim.anchor;
  // Retain declared fields only, including on rejected claims. Never freeze caller data.
  return Object.freeze({ factId: claim.factId, category: claim.category, quote: claim.quote, anchor: Object.freeze({ sourceId, start, end, quote, preimageHash }) });
}
/** Closed-world claim validation, deliberately NOT an omission detector. */
export function auditClaims(source: Source, graph: GraphRevision, claims: readonly Claim[]): ClaimAudit {
  assertGraph(source, graph);
  const facts = new Map(graph.facts.map(fact => [fact.id, fact]));
  const accepted: Claim[] = [];
  const rejected: ClaimRejection[] = [];
  for (const input of claims) {
    const claim = snapshot(input);
    const fact = facts.get(claim.factId);
    const reason = !fact ? 'Unknown fact ID' : fact.category !== claim.category ? 'Category mismatch' : !verifyAnchor(source, claim.anchor) ? 'Invalid source anchor' : fact.anchor.start !== claim.anchor.start || fact.anchor.end !== claim.anchor.end || fact.anchor.sourceId !== claim.anchor.sourceId ? 'Fact anchor mismatch' : claim.quote !== fact.anchor.quote || claim.quote !== claim.anchor.quote ? 'Quote mismatch' : null;
    if (reason) rejected.push(Object.freeze({ claim, reason }));
    else accepted.push(claim);
  }
  return Object.freeze({ sourceId: source.id, graphRevisionId: graph.id, valid: accepted.length > 0 && rejected.length === 0, accepted: Object.freeze(accepted), rejected: Object.freeze(rejected) });
}
