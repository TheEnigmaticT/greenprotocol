# Concrete extraction jobs: integration contract and recovery evidence

## Status

Concrete source extraction and independent inventory adapters are implemented. All 46 extraction tests pass using synthetic injected transports. **No actual model has been qualified by this work.** No network, credentials, private source, install, or commit was used. Family eligibility is not live model approval; the provider retains its separate allowlist and approval gates.

## Frozen integration API

Exports from `lib/local-qualification/extraction-jobs.ts`:

```ts
interface ExtractionJobManifest {
  readonly id: string;
  readonly role: 'extraction' | 'inventory';
  readonly family: 'qwen' | 'gemma';
  readonly model: string;
  readonly providerSlug?: string;
  readonly outputKind: 'json_schema' | 'tool';
  readonly maxSourceBytes: number;
  readonly maxPromptTokens: number;
  readonly maxCompletionTokens: number;
  readonly prices: Readonly<QualificationRequest['prices']>;
  readonly attempt: number;
}
interface ExtractionJobTransport {
  execute(request: QualificationRequest): Promise<{
    readonly value: unknown;
    readonly model: string;
    readonly tupleHash: string;
    readonly attempt: number;
  }>;
}
interface SpanDisposition {
  readonly anchor: Anchor;
  readonly kind: 'facts' | 'unclassified' | 'non-procedural';
  readonly candidateIndices: readonly number[];
  readonly reason: string | null;
}
// Internal structural type, exposed through result.receipts, not separately exported.
interface JobReceipt {
  readonly tupleHash: string;
  readonly window: Anchor;
  readonly candidateCount: number;
}
interface ExtractionJobResult {
  readonly manifest: ExtractionJobManifest;
  readonly graph: GraphRevision;
  readonly dispositions: readonly SpanDisposition[];
  readonly receipts: readonly JobReceipt[];
}
interface InventoryJobResult {
  readonly manifest: ExtractionJobManifest;
  readonly review: InventoryReview;
  readonly dispositions: readonly SpanDisposition[];
  readonly receipts: readonly JobReceipt[];
}
runExtractionJob(source: Source, manifest: ExtractionJobManifest, transport: ExtractionJobTransport): Promise<ExtractionJobResult>;
runInventoryJob(source: Source, manifest: ExtractionJobManifest, transport: ExtractionJobTransport): Promise<InventoryJobResult>;
auditExtractionJobs(source: Source, extraction: ExtractionJobResult, inventory: InventoryJobResult): { claims: ClaimAudit; coverage: CoverageAudit };
```

Also exports recursively frozen `EXTRACTION_OUTPUT_SCHEMA` and `INVENTORY_OUTPUT_SCHEMA` (object JSON schemas). Imported types live in `provider.ts`, `source.ts`, `graph.ts`, `coverage-audit.ts`, and `claim-audit.ts` respectively.

`QualificationRequest` remains the existing provider contract: tupleHash, attempt, model, messages, maxCompletionTokens, maxPromptTokens, prices, output, validate; optional evidence and providerSlug. Each adapter request supplies `evidence: { sourceHash, contractHash, role }`. The source hash is the whole source SHA-256 without its `sha256:` prefix. Contract hash covers the adapter version, role, system instructions, and output contract. Tuple hash covers version, snapshotted manifest excluding attempt, whole source identity, window, messages, and output; an explicit provider pin therefore changes the tuple. Provider pins are preserved exactly, not defaulted or normalized. Live provider approval remains outside this adapter.

## Behavior and boundaries

- Snapshots source bytes and declared manifest fields before injected transport code runs; rejects invalid manifests and preflights every source window before any execution.
- Deep-freezes requests, messages, prices, schemas, evidence, result manifests, graph, dispositions, and receipts. Caller manifests remain caller-owned and mutable without altering the job snapshot.
- Uses bounded windows partitioning the entire UTF-8 source. Anchors require absolute byte offsets and exact quote equality; hashes are computed locally.
- Closed schema rejects missing/extra properties, sparse/non-JSON arrays, invented literals, invalid unknown values, invalid edges, and cyclic step dependencies. It never silently drops malformed facts.
- Every source byte must have an ordered contiguous disposition; each candidate has exactly one containing disposition. Unclassified candidates remain explicitly unknown; non-procedural spans require reasons.
- Independent inventory receives source windows only, no worker graph, claims, IDs, or outputs. Its output disallows edges and worker IDs.
- Claim auditing grounds every extracted candidate; independent coverage auditing can catch omissions despite passing worker claims. Neither is scientific adjudication; interpretation remains `not-assessed`.
- Model output must still successfully identify chemistry, repeated washes, quantities, mixtures/bases, monitoring and dependencies. Schema/source completeness is not proof of semantic completeness. Cross-window dependencies remain unresolved rather than fabricated.
- No retries, fallback, model discovery, network, or credentials are implemented here. Returned model/tuple/attempt must match the request.

## Recovery verification

Preserved the two pre-existing RED regression tests without adding tests:

1. Explicit provider slug was discarded by manifest field selection, so request.providerSlug was undefined. Added optional manifest field, validated its syntax, preserved it in the frozen snapshot and request, and included content-addressed role evidence.
2. Request objects/messages were mutable. Applied the existing recursive freezer to completed requests.

Observed before fix: **44 passed, 2 failed (46)**, at test lines 199 and 211. After fix: **46 passed (46)**.

Commands executed locally:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/extraction-jobs.test.ts
./node_modules/.bin/eslint lib/local-qualification/extraction-jobs.ts tests/lib/local-qualification/extraction-jobs.test.ts
./node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler --esModuleInterop lib/local-qualification/extraction-jobs.ts tests/lib/local-qualification/extraction-jobs.test.ts
```

Scoped ESLint and strict TypeScript check both exited 0. A combined invocation also supplied `provider.test.ts`, which does not exist; Vitest selected only the extraction test, so this is not provider-suite verification.

Broader local-qualification run (`vitest run tests/lib/local-qualification`) observed **397 passed, 1 failed (398 tests), 12 passed files, 2 failed files** in the concurrently edited worktree. Out-of-scope failures: missing `lib/local-qualification/stage-store` imported by `stage-store.test.ts`, and `live-provider.test.ts` completion-limit rejection resolving instead of rejecting. These files were not modified by this recovery.

The required dev protocol path was absent. Offline restriction prevented a fresh git fetch; existing HEAD matched cached origin/main (0 ahead / 0 behind). No unrelated files were changed by this recovery.
