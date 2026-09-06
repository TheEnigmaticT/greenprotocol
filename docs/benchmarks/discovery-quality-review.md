# Independent discovery QUALITY / security review

## Verdict: PASS — bounded metadata discovery only

No genuine blocking security or quality defect found in the reviewed discovery utility, CLI, and synthetic tests. The parent may proceed with the separately authorized metadata-only live invocation after confirming the approved roots are locally controlled and quiescent. This approval does not extend to snapshot creation, corpus qualification, inference, spending, or hostile concurrent filesystems.

This reviewer did **not** execute the exact live-approved CLI invocation, read private benchmark payloads, copy originals, access credentials, or call a model. Reviewed the explicit `BENCHMARK-ACCESS-APPROVAL.md` and existing SPEC review; approval is procedural, not established by the CLI flag.

## Reviewed content fingerprints (SHA-256)

These fingerprints bind this verdict to the actual reviewed code, not subsequent concurrent changes:

```text
26579f4c9611afe93b0931fe802d1e1dd704b9d789d1865fcd71be3050d283b6  lib/local-qualification/discovery.ts
a2672baefa6fd9ec124e40f35faf2b5c69fd3173a92d8c90206b8568a38635b5  tests/lib/local-qualification/discovery.test.ts
d9149cd5a67d5b79423eacb809b61dbe6b8c7cfbf6bb2534450a38e5b349f613  scripts/benchmarks/discover-local-corpus.ts
```

## Security / correctness findings

- **Authority remains narrow:** two compile-time roots; immediate benchmark-named directory selection; descendant JSON only. CLI accepts exactly one acknowledgement argument and no path/output/environment overrides. No provider, network, credential, shell-execution, application-write, or dynamic-import path originates in corpus data.
- **Read-only filesystem handling:** component checks reject symlinks; input JSON must be a regular singly linked file. Read-only leaf descriptors use `O_NOFOLLOW` and `O_NONBLOCK`. Descriptor identity/size checks precede bounded reads; post-read path and descriptor checks compare identity, size, link count, and mutation timestamps. Descriptors/directories close in `finally` blocks. No application-level original modification occurs; OS access-time updates remain possible.
- **Containment assumption retained:** component checks are not atomic ancestor containment. A malicious same-UID ancestor swap is outside this approval. Do not run while another process is modifying or replacing the selected benchmark directories/files. Detected mutation must stop the scan, not prompt weaker checks or automatic retries.
- **Finite work:** per-file and aggregate byte, file-count, directory-entry/depth, JSON-node/depth, and schema/source/model cardinality bounds are present and enforced before summary return. The extra read byte detects growth. Parsing is bounded by input bytes, with node/depth validation afterward; this is not a streaming parser or a hard process-RSS guarantee.
- **Output reconstructed, not filtered raw data:** schema paths use fixed whitelist tokens, `*`, and array markers. Source/artifact hashes and counts are approved metadata. Exact decoded source hashing preserves newline distinctions and rejects unpaired surrogates for source strings. Arbitrary values, filenames, unknown field names, and protocol text cannot enter ordinary summary serialization. Model strings serialize only under the bounded Qwen/Gemma token grammar and length cap; family-looking nonmatching values yield hashes/counts only. Recognition does not validate a real model catalog entry.
- **Error/logging boundary:** utility errors are rebuilt from a fixed code set without original messages, causes, filenames, or JSON fragments (`discovery.ts:156–158`). CLI writes a summary only after discovery returns and otherwise emits the fixed `DISCOVERY_FAILED` message (`discover-local-corpus.ts:10–16`). Rejected argv produces only `DISCOVERY_REVIEW_REQUIRED`. No debug logging or partial accumulated summary is emitted on discovery failure.
- **No semantic overclaim:** source occurrences are not proven usable protocols, exact source deduplication is not protocol validation, and cohort labels are occurrence evidence rather than split assignments. Cost reconciliation and historical completeness are not established by discovery.

## Real verification

Executed only synthetic suites and scoped static checks:

1. `vitest run tests/lib/local-qualification`: **13 files / 395 tests passed**.
2. Repeated the same command: **12 files passed, 1 failed; 395 tests passed, 2 failed**. Both failures were newly present extraction-job assertions outside discovery ownership: provider slug forwarding (`extraction-jobs.test.ts:199`) and request freezing (`:211`). Total tests changed from 395 to 397 between runs, demonstrating a changing shared checkout rather than a stable regression baseline. Neither failure was in discovery.
3. `vitest run tests/lib/local-qualification/discovery.test.ts tests/lib/local-qualification/corpus.test.ts tests/lib/local-qualification/stages.test.ts --reporter=verbose`: **3 files / 51 tests passed** (19 discovery, 22 corpus, 10 stages).
4. Concurrently requested a separate `vitest run tests/lib/local-qualification/discovery.test.ts --reporter=verbose`: **19 tests passed**.
5. Scoped ESLint and strict standalone TypeScript checks over discovery utility, CLI, and tests: **exit 0, no diagnostics**.
6. `git diff --check`: **exit 0**. SHA-256 fingerprints above were obtained with `shasum -a 256`.

The earlier reported two discovery `DISCOVERY_UNSAFE_PATH` failures were **not reproduced** in these combined or standalone executions. No evidence justifies changing the fail-closed production path or blocking this narrow review on that unconfirmed report.

## Nonblocking follow-ups / test isolation

- Fixtures use unique `mkdtempSync` directories, sequential tests, filesystem module unmock/reset cleanup, and default Vitest isolation. There is no intentional shared synthetic root. However, the mock remaps approved roots and descendants, not their ancestor prefixes: component `lstatSync` calls still depend on real approved ancestor directories existing and remaining non-symlinked. Thus the fixture is payload-isolated but not completely independent of host directory topology. Improve synthetic ancestor mapping in a later test-only patch; this is not evidence of the earlier failure's cause.
- Aggregate byte/node/cardinality and injected descriptor mutation failures are statically reviewed but not each dynamically exercised by existing tests. The actual CLI catch branch is statically verified; CLI subprocess tests exercise rejected arguments, not a live-approved invocation. Add synthetic fault-injection coverage without touching private payloads.
- A proposed multi-run Python `-c` wrapper was denied by normal runtime controls before execution. No safety settings were changed; direct ordinary Vitest commands remained available and were used. This was not a denial of private access, which was never attempted.

## Workspace integrity and handoff

Fetched origin before writing. Work branch matched its upstream; separate `main` was eight commits behind its remote and was left untouched. No stash, reset, commit, install, or unrelated file edit was performed. Only this report was created by this reviewer.

**Ready for parent:** narrow QUALITY/security gate passes for the fingerprinted discovery implementation. Preserve fixed roots, quiescence, metadata-only stdout, and normal runtime approvals. A renewed access denial or `DISCOVERY_FAILED` must stop that access path; do not broaden selection or weaken checks automatically. Independent reviews do not claim that the as-yet-unexecuted live scan will succeed or that its future result proves corpus completeness.
