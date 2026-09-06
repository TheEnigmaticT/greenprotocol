# Corpus discovery and read-only loader

## Early safety report

- Scope: ignored research artifacts only; original worktree is read-only. No production clients, credentials, inference, or network writes.
- The earlier denied broad artifact-filename discovery has not been retried. No private artifact has been read.
- Safe reference: `docs/benchmarks/decomposed-pilot.md` names `tmp/decomposed-benchmarks/alana-pilot.json`. This identifies one possible input, not the full approved cohort.
- Documented input schema: `cases[]` with `protocolText`, eligibility candidates, and `evidenceByAlternative`. Source IDs and protocol/evidence content must never enter this report or stdout.
- Historical model reference verified in that document: `google/gemma-4-31b-it`; the two requested Qwen IDs remain unverified.
- Distinct raw-source hashes, duplicate counts, calibration/previous-holdout membership, frozen evidence availability, baseline availability, and exhaustive historical spend are **unknown**, not zero.
- The $100 cumulative budget cannot be reconciled without an exhaustive ledger including retries and audits. Unknown costs block paid work.
- Implementation gate: synthetic tests first; no real loader run before independent security review. No live cohort completeness claims.

## Access blocker (stop; do not retry)

A metadata-only `os.lstat` check of the specifically documented original pilot input was denied by the terminal safety gate (`script execution via -e/-c flag`, single-query mode). It did not return metadata. This exact private access path is stopped; no alternative tool or command has been used to bypass the denial. The previous broad filename discovery remains unapproved. Consequently even the documented file's existence, permissions, and byte size remain unverified.

## Implemented loader; independent review pending

Files: `lib/local-qualification/corpus.ts` and `tests/lib/local-qualification/corpus.test.ts`.

`loadApprovedCorpus(manifest)` accepts an explicit review gate plus approved artifact SHA-256 digests and an exhaustive per-artifact source-hash allowlist with `calibration`, `previous-holdout`, or `unclassified` annotations. It reads only the documented pilot-input schema. It **does not** accept historical result artifacts, infer split membership from filenames, import production clients, perform inference, or write any file.

Its fixed, module-derived root is `tmp/local-qualification/corpus/` in this mission worktree, covered by the existing `/tmp/` ignore rule. No caller root override or env/cwd authority. The loader does not create/populate this directory or copy any original artifact. An independently approved local snapshot and manifest are prerequisites, not actions taken by this workstream.

Security boundaries:
- Reject path separators, dotfiles, symlink components, hardlinked files, non-regular files, non-owner-owned private files/directories, and group/other access to the private root and its `tmp/` ancestors. It does not chmod anything automatically.
- Open read-only with `O_NOFOLLOW`; verify inode/device and metadata before/after bounded descriptor reads. Max artifact size 8 MiB, max 32 approved artifacts, max 1,000 cases per artifact, max protocol 1 MiB. This is not a defense against a malicious process with the same OS identity that can rewrite the repository/module.
- Verify approved artifact hash before JSON parsing; validate strict UTF-8 and reject unpaired protocol surrogates. Hash the exact UTF-8 protocol text without newline/whitespace normalization.
- Snapshot approved manifest primitives before async reads. Reject unknown source hashes, absent allowlisted sources, and conflicting split annotations.
- Reconstruct only `sourceHash`, in-memory `protocolText`, split, eligibility count, and evidence-excerpt count. Discard source IDs, user IDs, baseline outputs, arbitrary nested fields, quotes, and evidence keys. **The returned cases are private execution inputs and must not be logged or serialized.** Only `summary` is safe for reporting. Evidence count is not proof of frozen evidence validity or applicability.
- Deduplicate by exact raw-source hash; duplicate count is raw cases minus distinct sources. Case counts are from the first occurrence of each exact source. No historical completeness claim follows from loading a selected manifest.
- All exceptions are fixed error codes without input excerpts, filesystem paths, or nested causes.

Review status: synthetic execution only. Independent security review has **not** been completed by this implementing worker; parent must obtain it before setting the operational review gate or populating/reading real inputs. Access denials remain separate blockers even if review later passes.

## Historical metadata and budget reconciliation

Safe source-code findings (`lib/decomposed-benchmark/pilot.ts`, `provider.ts`, `anthropic-provider.ts`):
- Historical stage shape allows provider/model, latency, token counts, optional `costUsd`, optional generation ID, and raw output. Only metadata belongs in a future approved ledger extractor.
- The direct Anthropic adapter returns token counts but no dollar cost; absence must remain unknown, not zero.
- The pilot records telemetry only after a successful completion returns. A billed request that throws is not guaranteed a stage entry.
- An explicitly separate audit provider is passed into the runner without this pilot's recording wrapper. The stage array alone is therefore insufficient to establish exhaustive audit spend.
- Historical failed requests, retries, separately routed audits, all experiment variants, and provider billing reconciliation remain required before a $100 cumulative cap can be certified. No costs were guessed and no paid requests were made by this workstream.
- `google/gemma-4-31b-it` is a documented historical reference, not a fresh provider availability check. Requested previous Qwen235B and Qwen27B exact IDs remain **unknown**. No model IDs were invented.

The complete approved cohort, real distinct-source hashes/counts, duplicate counts, calibration/previous-holdout split, frozen evidence availability, baseline availability, and prior cumulative spend all remain **unverified due to the access blocker**.

## Verification evidence

- Initial RED: 18 synthetic tests failed because the loader module did not exist; subsequent implementation passed all 18.
- Additional RED: private-ancestor permissions, async manifest mutation, and unpaired surrogate tests each failed for the intended behavior; fixes added. LF/CRLF distinction coverage also added.
- Full repository run during concurrent sibling implementation: 34 test files passed and 3 failed; 279 tests passed and 35 failed. Failures were sibling source/graph/provider/audit scaffold APIs, not corpus tests. This is a time-specific result, not a current whole-repository green claim.
- Whole-project `tsc --noEmit --incremental false` likewise reported sibling missing APIs/types; no corpus-file diagnostics. Scoped ESLint passed.
- Final targeted run: `npm test -- tests/lib/local-qualification/corpus.test.ts` passed **22/22 tests**. Scoped ESLint and `git diff --check` completed without diagnostics. No original/private artifact was loaded; no real cohort manifest was created.
