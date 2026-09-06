# Independent QUALITY review — concrete extraction adapter

## Verdict: scoped PASS

No blocking correctness or security defect found in the promised structural JSON, source-offset/window, snapshot, request-freezing, or explicit-provider-pin behavior. This accepts the concrete adapter and the two-test recovery only. It does **not** qualify any model, enable inference, certify scientific completeness, or upgrade the scoped SPEC verdict.

Reviewed `lib/local-qualification/extraction-jobs.ts`, its test and implementation report, and directly used source/graph/claim/coverage contracts. The SPEC report is actually `docs/benchmarks/extraction-jobs-spec-review.md` (the supplied `docs/extraction-jobs-spec-review.md` path does not exist).

## Independently verified

Commands executed using existing local dependencies:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/extraction-jobs.test.ts
./node_modules/.bin/eslint lib/local-qualification/extraction-jobs.ts tests/lib/local-qualification/extraction-jobs.test.ts
./node_modules/.bin/tsc --noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler --esModuleInterop lib/local-qualification/extraction-jobs.ts tests/lib/local-qualification/extraction-jobs.test.ts
```

- **46/46 tests passed; one test file passed.** Explicit provider-pin/evidence and request-freezing/snapshot regression tests are included.
- Scoped ESLint and strict TypeScript exited 0.
- Additional read-only `tsx -e` assertion probes used synthetic injected transports, with exit 0:
  - Nested request/message/prices/output/schema/evidence freezing.
  - Two-window source-byte and manifest snapshots despite transport mutations of caller bytes, model, provider pin, and nested prices.
  - Mutation of a previous response during the next window does not change already decoded facts or disposition indices.
  - A UTF-8 code point exceeding the window budget fails before any transport execution.
  - A later escaped-control-character window exceeds a prompt budget that fits the first window: computed allowances were **6856 and 6880**; setting the budget to 6856 rejects with **zero transport calls**. This independently verifies all-window preflight rather than just first-window checking.
  - Unsafe integer offsets, sparse candidate arrays, and empty anchors are rejected both by request validation and by the adapter's post-transport validation.

Reviewed SHA-256 snapshots match the SPEC report:

```text
91055430936c717da13c2f2515c5e25ea17756bb99b7d3933a27511dee31e3fc  lib/local-qualification/extraction-jobs.ts
341ecd5cd7428a1de8ffa92b25cefa734b70dd513fe0d8379c71a57acbc8140c  tests/lib/local-qualification/extraction-jobs.test.ts
ba961d1282d641738e0074ee838af9b11b5e2bbd229f420baf69c997a611579a  docs/benchmarks/extraction-jobs-implementation.md
```

## Quality assessment

- Closed role-specific schemas, literal equality, safe integer checks, UTF-8 boundary validation, disposition accounting, endpoint/category checks and dependency-cycle rejection form a coherent fail-closed structural decoder (`extraction-jobs.ts:100–195`). Decode failures propagate; malformed candidates are not filtered out or partially returned.
- Manifest field selection keeps undeclared caller metadata out of inventory. Source bytes and manifest are snapshotted before transport; complete requests are recursively frozen (`203–240`). Explicit provider slugs are syntax-checked and preserved literally in request and tuple identity, with no implicit default.
- Returned model, tuple and attempt must match; responses are decoded again even if transport ignores its validator (`245–250`). There is no adapter retry, fallback, credential lookup, network call, shell execution, dynamic evaluation, filesystem write, or inference-enabling change in the reviewed module. Injected transport remains executable caller code, not a sandboxed adversary.
- The narrow handwritten schema validator is appropriate to its explicitly limited schema vocabulary. This review covers ordinary JSON wire values, not hostile JavaScript getters, proxies, or arbitrary serialization behavior.

### Nonblocking maintainability/performance notes

1. Preserve the additional multi-window mutation and later-window prompt-preflight probes as regression tests in a subsequent authorized test change. Existing tests are green, but direct nested/multi-window mutation assertions are thinner than the implementation's guarantees. No test/source edits were made here.
2. `hydrate` calls `anchor`, which revalidates/hashes the entire source; canonicalization and graph/audit creation repeat source validation. Prebuilding all requests also scales with total source size. Window byte limits are not a total-job memory/CPU bound. Profile representative larger documents before production-scale use; this is not a demonstrated correctness failure or blocking security defect in the scoped local adapter contract.

## Limits retained, not hidden

The SPEC report's substantive limits remain controlling:

- Edge direction/relation semantics are **not independently source-audited**. Structurally accepted `observed` edges are still model assertions.
- Disjoint windows prevent cross-window edges but do **not guarantee explicit unknown/unresolved markers** for lost cross-window references. Read implementation report line 75's “remain unresolved” as intent, not an enforced completeness invariant.
- Per-byte dispositions are a structural ledger, not proof all procedural content was extracted. Extraction and inventory can share a common-mode omission while both audits pass.
- Category correctness, mixture basis/components, repeated-wash decomposition, monitoring/dependency semantics, and scientific interpretation remain unqualified. `not-assessed` is not scientific approval.
- Provider pin preservation is verified; actual routing/provider attestation and live model behavior are outside this review. No universal scientific-truth validator was required or invented as a new acceptance criterion.

## Scope and environment

Git fetch succeeded. The review branch matches its upstream (`0 ahead / 0 behind`); local `main` is eight commits behind `origin/main` and checked out elsewhere, so it was left untouched. Existing dirty/untracked work was preserved. This review created only this document; no source edits, installs, commits, private inputs, credentials, live inference, deployment, or inference enablement occurred. Git fetch was the only network operation used for this review.

No full-suite or provider-suite verdict is claimed. Broader failures described in the implementation report were not independently rerun or attributed by this review.
