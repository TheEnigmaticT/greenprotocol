# SciSure private review workspace

## Authorized scope

Implement the complete GCai review popup, normal findings (not a swap-only projection), accept/reject and Ask, private Evidence Atlas, reviewed draft preview and final source-type-aware create/update writeback. Preserve scientific applicability/confidence distinctions and reuse the existing chemistry engine. Remove SciSure Supplies/catalog/order features. Protect native ELN history; update-existing stays disabled unless documented API/version-conflict behavior proves it safe. SMTP and recovery of unverified guest email are explicitly deferred; never enable guests or claim an email based only on a matching string.

Work starts at main 04ac1fb1946371d9998bc217cab4b1850366f3c8. Production baseline is 997e83558e5355cd938dc29f447cb9327383265e and must not move. Root Supabase CLI is linked to production. Remote staging changes require explicit project qqyzyezwlzvckjtggoes. Preserve the user-visible integration code under /Users/ct-mac-mini/dev/greenchemistry-ai/integrations/scisure-addon.

## Frozen workspace HTTP contract

All routes are private/no-store, same-origin writes and authorized by connection bearer plus X-GCAI-Bridge-Session and X-GCAI-SciSure-Origin. The connection must resolve to the actual authenticated principal, never imported email/actor metadata. Existing v1 admission/status remain compatible.

- GET /api/integrations/scisure/snapshots/{snapshotId}/workspace returns Workspace (see workspace-contract.ts). Pending jobs return source/metadata and analysis:null/findings:[]; completed jobs return full normal AnalysisResult, source, stable findings, persisted decisions, current revision and private analysis ID. Warning IDs without canonical ID use finding-{index}; Ask uses recommendationIndex.
- POST .../workspace/decisions body { findingId, decision:'accepted'|'rejected', sourceHash, analysisRevision }. Returns {findingId,decision,analysisRevision}. Acceptance is a scientist review decision, NOT permission to apply an unsupported warning/hypothesis. SQL/service authorization must CAS current source/revision and record all normal findings; preserve old v1 eligible-swap decision RPC unchanged.
- POST .../workspace/draft body {sourceHash,analysisRevision}. Requires explicit decisions for all findings and current revision. Reads durable decisions, never browser-supplied recommendations/draft. Returns PreparedSciSureWriteback. Reuse lib/finalized-protocol.ts with accepted applicable changes only. Preserve source step/section mapping; if unable to map safely, flag limitation rather than invent a rewrite. Include private evidence appendix (rationale,citations,uncertainty,decisions,source/run/revision provenance). No public analysis/share URL. Signed-in private analysis/evidence routes and persisted Ask conversations remain owner-only.

## Frozen postMessage writeback contract

Existing version1 loaded/hello/ready/admission remains. After popup review + draft preview + explicit confirmation:

- popup -> add-on: {version:2,type:'gcai.scisure.writeback',nonce,bridgeSessionId,requestId,mode:'create'|'update',snapshot:<existing sourceIdentity>,bundle:PreparedSciSureWriteback}
- add-on -> popup: {version:2,type:'scisure.gcai.writeback-result',nonce,bridgeSessionId,requestId,status:'saved'|'conflict'|'unsupported'|'failed'|'uncertain',targetId?:string,targetKind?:'experiment'|'protocol',message:string}

Validate origin/window/nonce/session/requestId/exact original identity and strict bounded payload. Do not retry uncertain external writes. Update includes live source-version/content compare and must use proven native versioning. If provider has no verified audit-preserving atomic write, return unsupported without mutation. Create preserves source type (experiment vs protocol/protocol-step). Source protocol-step creates a new protocol containing only the selected procedure, explicitly labeled as selected-content copy. Real POST writes require exact ID readback before saved status; partial create/evidence append becomes uncertain with ID retained. Durable duplicate lock survives popup reload; receipts and server recovery can be built on the existing service-owned identity, not on unverified email. No order/catalog APIs.

## Timeouts

Support a one-hour review/Ask session: popup analysis polling <=13min, add-on listener at least65min, connection credential >=67min. Align runtime clamps, schema and defaults. Connection can expire sooner for guests whose verified admission expires. On expiration, preserve saved analysis/decisions and explain recovery; never re-run chemistry to reconnect. SMTP guest recovery remains explicitly unavailable.

## Work streams / file ownership

1. Backend: workspace-contract types fixed; new workspace modules/routes and service-only migration, SQL acceptance, scoped source/revision/decision persistence, draft/evidence builder, connection lifetime. Do not edit popup/add-on/chemistry core.
2. Popup: components/integrations/scisure/ConnectionBridge.tsx + dedicated workspace UI component/tests. Normal cards, registered Ask using existing TalkAboutThis, private EvidenceAtlas inline, choices and draft preview and validated writeback result states. Do not edit backend, SQL or add-on.
3. Add-on: integrations/scisure-addon/** and official API capability research/runbook. Remove Supplies feature and unsafe blanket PUT, implement v2 validated writeback, documented create experiment/protocol, exact readback and uncertain/duplicate/version guards. No backend/UI edits.
4. Parent: consolidate, resolve contracts, verify isolated PostgreSQL, unit/type/lint/build/browser fixtures, security review, staging-only migration with exact target and readback, reviewed PR/main deployment, user-visible bundle/package and clear live-vs-fixture evidence. No production promotion or automatic modification of real SciSure records without explicit scientist confirmation.

## Acceptance

- The existing real result shape (three warnings + one noneligible hypothesis) is visible as four normal findings in the popup, with clear science limitations; it never looks like an idle empty bridge.
- Per-finding review persists; Ask and evidence are private and recoverable for signed-in owner.
- All findings must be reviewed before final draft. Only scientist-accepted application-eligible changes alter procedure text. Unsupported accepted findings are acknowledged in evidence, not falsely applied.
- Final choice is in popup; experiment remains experiment, protocol remains protocol. Audit-unsafe update is disabled with an explanation.
- Private evidence appendix is part of new/writeback record; provenance binds source/revision/run/decisions. No public share link, raw secret or auth token in payload/storage.
- Stale version, wrong principal, spoofed email, malformed/oversize postMessage, duplicate/uncertain write and missing evidence readback fail closed.
- No source/procedure/provider output fabricated for live verification. Fixture tests are labeled as such.
- SMTP/unverified-mailbox recovery remains deferred and disabled; retention remains90days unless separately changed.
