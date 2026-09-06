# Bounded principle jobs: integration interface (implementation in progress)

Owned module: `lib/local-qualification/principle-jobs.ts`. No production pipeline imports, retrieval, provider construction, credentials, corpus access, or default transport.

Planned exports (this document is published before implementation for stage integration):

- `PrincipleJobInput`: `{ principle, source, graph, category, workerID, factIDs, dependencyFacts, evidence }`. `dependencyFacts` maps registry dependency keys to verified graph fact IDs. `evidence` is a caller-approved frozen bundle `{ approvalID, snapshots, records }`; approval is a trusted caller assertion, not inferred from model text.
- `buildPrincipleJob(input)`: bounded `{ role, principle, messages, output, validate, parse }` request. `parse(unknown)` returns `PrincipleJobResult` with existing `DurableDecision`, optional existing `Candidate` and `EvidencePacket`, and grounded checks/action codes. `validate` is a boolean semantic gate for the existing provider request. Requests contain no model ID or prices: integration supplies its approved provider policy.
- `runPrincipleJob(input, transport)`: transport injection only (`{ model, execute(request) }`), restricted to the repository's exact approved model list. Returns unavailable/error decision on transport/output failure, never fake scientific success. No retries/fallback.
- `buildApplicabilityJob(input, result, context)`: distinct independent reviewer role, full frozen evidence and graph neighborhood, no worker rationale/verdict as review authority. `parse` returns `{ audit, result }`, where `result` is the existing `auditApplicability` gate result; it never applies an edit.

Outputs deliberately use principle-specific controlled check/action codes and registered identifiers rather than arbitrary model-authored citations, numerical calculations, molecules, or revised protocol prose. A UI can render source anchors and frozen excerpts from these identifiers. Missing inputs remain explicit; this does not certify model chemistry or advisory usefulness. All chemistry interpretation is delegated to the injected approved Qwen/Gemma transport; deterministic code validates provenance, completeness, state and authority only. The current repository exact allowlist may exclude unapproved Qwen IDs.

Source/graph IDs retain their original `sha256:` format in the input. After graph verification only, the decision boundary explicitly converts them to the existing decision schema's bare 64-hex hashes. Graph fact IDs remain unchanged as claim IDs.

Verification status: pending RED/GREEN tests. No live calls or scientific corpus qualification authorized.
