# Independent discovery SPEC review

## Verdict: PASS for the bounded metadata-discovery specification

No blocking specification mismatch found in the frozen utility, CLI, synthetic tests, and implementation notes. This is a SPEC review only. Independent quality/security approval remains a prerequisite to the parent's live invocation. This reviewer did not invoke the approved live CLI, read private benchmark payloads, create a snapshot, freeze a corpus, or run inference.

## Authority and scope checked

Read `/Users/ct-mac-mini/dev/local-model-migration-planning/BENCHMARK-ACCESS-APPROVAL.md`. It explicitly authorizes scoped private benchmark discovery, supersedes the earlier missing-authorization/access-blocker narrative, and records that the documented example file is absent rather than denied. Its previously observed file counts are not corpus completeness evidence. A renewed runtime denial must still stop that access path.

Reviewed:
- `lib/local-qualification/discovery.ts`
- `tests/lib/local-qualification/discovery.test.ts`
- `scripts/benchmarks/discover-local-corpus.ts`
- `docs/benchmarks/discovery-implementation.md`
- Existing corpus-discovery notes for boundary/context only.

## Specification checks

- **Fixed authority:** exactly the original research and main `tmp` roots are compiled in (discovery.ts:6–9). Immediate directory selection uses names containing `benchmark`; descendant JSON files only. No arbitrary root, environment, output, or positional override is accepted. CLI requires exactly the single acknowledgement flag (CLI:5–8).
- **Read-only scope:** utility imports only Node crypto/fs/path primitives. No provider, credentials, network, copying, staging, manifest generation, or application-level writes. Filesystem access-time updates remain the documented OS caveat.
- **Filesystem rejection:** all checked path components reject symlinks; JSON inputs must be regular, singly linked files. Read-only descriptor opens include `O_NOFOLLOW` and `O_NONBLOCK`; inode/device/size checks precede reading and metadata checks follow it (discovery.ts:36–71). Directory identities are checked before/after traversal (124–147).
- **Bounds:** accepted files are at most 8 MiB, accepted aggregate bytes at most 256 MiB, at most 2,048 JSON files, 20,000 directory entries, filesystem depth 16, JSON depth 32, and 1,000,000 visited nodes. Schema/source/model cardinalities also have finite limits. The descriptor buffer includes a one-byte growth-detection sentinel; no unbounded `readFile` is used. JSON parsing occurs after the byte limit, with traversal limits applied afterward.
- **Serialization boundary:** reconstructed schema paths contain only fixed whitelist tokens, `*`, and array markers. No filenames, source text, private identifiers, arbitrary key names, or arbitrary scalar values serialize. Source hashes preserve exact decoded UTF-8 text without newline normalization. Qwen/Gemma exact strings serialize only under the constrained version/size/variant grammar and length limit; other family-looking values produce hash/family/count only (87–122). Model recognition is not catalog validation or execution approval.
- **Fail closed:** missing/unsafe roots, invalid UTF-8/JSON, mutation, and limits prevent summary return. The utility sanitizes exceptions to fixed codes; CLI prints only a fixed failure message and no partial summary (discovery.ts:156–158; CLI:13–16).
- **No overclaim:** source occurrences and distinct source hashes are not validated usable protocols; cohort evidence counts are label occurrences, not split assignments. Neither artifact counts nor this review establish complete historical coverage, corpus freezing, evidence validity, spend reconciliation, or inference authorization.

## Verification actually executed

Only synthetic test execution and scoped static checks:

```sh
./node_modules/.bin/vitest run tests/lib/local-qualification/discovery.test.ts tests/lib/local-qualification/corpus.test.ts
./node_modules/.bin/eslint lib/local-qualification/discovery.ts tests/lib/local-qualification/discovery.test.ts scripts/benchmarks/discover-local-corpus.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types node lib/local-qualification/discovery.ts scripts/benchmarks/discover-local-corpus.ts tests/lib/local-qualification/discovery.test.ts
```

Result: **2 test files passed, 41 tests passed (19 discovery + 22 corpus)**. Scoped ESLint and standalone strict TypeScript checks exited successfully without diagnostics. Discovery fixtures redirect approved roots into disposable synthetic directories; the subprocess CLI tests use only rejected invocations, never the exact live-approved invocation.

Fetched origin and inspected branch state before this report. Current work branch matches its upstream; separate `main` is eight commits behind origin/main and was not modified. Existing unrelated worktree changes were preserved. No commit or install performed.

## Nonblocking limitations / quality-review handoff

1. Ancestor containment is not kernel-atomic. Component lstat plus leaf `O_NOFOLLOW` and pre/post identity checks do not guarantee prevention of a read during an adversarial concurrent ancestor swap. Implementation notes disclose this accurately. Approval is for locally controlled, quiescent roots, not a hostile concurrent filesystem; security review should explicitly retain that operating assumption.
2. Tests cover important rejection/redaction paths, but do not independently exercise every declared global limit or mutation race. In particular, aggregate-byte/node/cardinality limits and descriptor mutation checks merit quality-review attention. Static presence is not equivalent to exhaustive dynamic coverage.
3. The existing `corpus-discovery.md` contains historical stop/no-retry and old cumulative-budget language. It is superseded by the explicit approval note and current discovery implementation boundary, not a present authorization blocker. This review does not edit those historical notes.
4. The schema whitelist may omit useful fields in real historical result formats. That is not a reason to broaden this utility into a stage adapter before discovery. Review actual safe metadata first; any whitelist revision needs review. Unknown schema or unavailable input must remain unknown, never a completeness claim.

Only this report was created by the reviewer. Parent next gate: independent quality/security review, then separately authorized bounded live discovery under normal runtime controls.
