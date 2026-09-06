# Private benchmark metadata discovery — review checkpoint

Status: implementation ready for parent spec and quality/security review; NO private payload discovery executed. Parent approval required before invoking the live command. The early review checkpoint was written before implementation.

Authority: BENCHMARK-ACCESS-APPROVAL.md explicitly permits reading existing private benchmark inputs/results/cost records. New sprint budget is $100; user-reported approximately $12.59 historical spend is excluded. This utility makes no paid calls and changes no ledger.

## Proposed boundary

- Two compile-time roots only: `/private/tmp/greenchemistry-ai-decomposed-benchmark/tmp` and `/Users/ct-mac-mini/dev/greenchemistry-ai/tmp`. Select immediate child directories whose names contain `benchmark`, then JSON descendants. No environment/root overrides.
- Read-only Node builtins; no production/provider clients, network, credentials, writes, snapshots, or installs. No private paths/filenames or arbitrary JSON keys in results/errors.
- Reject symlinks at every path component and nonregular/hardlinked files. Verify file identity around bounded reads. Strict UTF-8 JSON, maximum 8 MiB per file; bounded total bytes, files, directory entries, depth, and JSON nodes. Fail closed, no partial success.
- Output a reconstructed aggregate schema: vetted fixed field paths, occurrence counts, exact source hashes, deduplicated source counts, approved model labels/IDs only, cohort-label evidence counts. Unknown key names collapse to `*`; arbitrary values never serialize.
- Cohort labels are evidence only, NOT proof of historical assignment or full cohort coverage. Source text hashes preserve exact bytes after JSON decoding, matching corpus.ts; discovery is not a corpus manifest or permission to run models.
- The existing corpus loader requires reviewed snapshots, artifact digests, exact source allowlists, and source split assignments. Discovery does not bypass it.

## Review / execution gate

Synthetic tests may run before review. No parent approval has yet been received. From `/Users/ct-mac-mini/dev/greenchemistry-ai-local-e2e`:

```sh
# SAFE NOW: synthetic filesystem tests, no benchmark payloads
./node_modules/.bin/vitest run tests/lib/local-qualification/discovery.test.ts tests/lib/local-qualification/corpus.test.ts
./node_modules/.bin/eslint lib/local-qualification/discovery.ts tests/lib/local-qualification/discovery.test.ts scripts/benchmarks/discover-local-corpus.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types node lib/local-qualification/discovery.ts scripts/benchmarks/discover-local-corpus.ts tests/lib/local-qualification/discovery.test.ts

# ONLY AFTER PARENT SPEC + SECURITY/QUALITY APPROVAL: private read, safe summary stdout
./node_modules/.bin/tsx scripts/benchmarks/discover-local-corpus.ts --review-approved
```

No root/output overrides are accepted. Running without the exact single flag exits 1 with `DISCOVERY_REVIEW_REQUIRED`; the live CLI catches every utility error and prints only `DISCOVERY_FAILED`, never paths or JSON fragments. A renewed access denial stops this path. Do not bypass runtime controls.

## Implemented bounds and output semantics

- 2,048 JSON files, 256 MiB total, 8 MiB per file, 20,000 directory entries across both roots; filesystem depth 16; JSON depth 32 and 1,000,000 nodes globally; 10,000 schema path/type entries, 20,000 distinct source hashes, 1,024 model hashes.
- Artifact hashes are sorted with multiplicity; root counts reconcile to file count. Source hashes deduplicate exact decoded source strings (no normalization); known source field occurrences are not necessarily distinct usable protocols.
- Source paths retain only fixed allowlisted key tokens plus `*`/`[]`. Unknown keys, filenames, paths and scalar values never serialize. Cohort counts recognize only exact `calibration`, `previous-holdout`, `unclassified` values under `split`/`cohort`; no inferred assignments.
- Following parent steering, exact Qwen/Gemma model IDs may serialize ONLY if they match the bounded version/size/fixed-variant token grammar in `MODEL_ID` (maximum 128 characters). Other family-looking strings yield family/hash/count only. This is metadata recognition, NOT model execution approval or proof of catalog validity. Tests use synthetic identifiers, not observed benchmark identities.
- No private artifact is needed or written. No protocol text leaves process memory. No cost values are emitted or reconciled, and no budget/approval ledger changes occur.

## Verification evidence

- TDD: initial 13 discovery tests failed on missing implementation, then passed. CLI tests failed before CLI creation, then passed. Exact model-ID recognition test failed before adding bounded grammar, then passed.
- Final discovery + existing corpus tests: **41 passed** (19 discovery, 22 corpus), synthetic fixtures only. Scoped ESLint and strict standalone TypeScript check passed. `git diff --check` passed before the final documentation/grammar amendment.
- Full shared-worktree suite was attempted: **519 passed, 79 failed** across 45 files. Failures were in concurrent extraction-jobs, principle-jobs, live-provider and reporting work outside this ownership scope. Project-wide typecheck likewise failed in those in-progress tests; scoped discovery typecheck passed. Those files were not changed.

## Review points / limitations

- Review every fixed schema token and the constrained model-ID grammar before enabling the live command. No source schema or model inventory has yet been observed by this utility.
- Standard Node `O_NOFOLLOW` protects the file leaf, with component lstat checks and pre/post file/directory identity checks. This is not kernel-atomic openat-style ancestor containment against a malicious concurrent directory swap; use only the approved locally controlled, quiescent roots. Detected mutation fails closed. Do not claim adversarial-race-proof containment.
- Read-only opens can update filesystem access times. The utility performs no application-level source writes, chmod, snapshots, or directory creation.
- Incomplete/missing roots, invalid JSON, oversized inputs, and limits fail the whole scan without a partial report. Revisions or broader schemas require review, not automatic fallback.
- Approval is a procedural parent review gate, not a security credential. A CLI flag cannot establish that independent review occurred.

## Prerequisites checked

Fetched origin. Working branch matches origin/main; main in a separate worktree is behind and untouched. Existing unrelated edits are preserved. Read existing corpus loader and synthetic filesystem testing conventions. Referenced Obsidian dev protocol was absent; no external API work is being performed.
