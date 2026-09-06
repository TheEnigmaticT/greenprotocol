# Local qualification runtime: implementation evidence

## Bounded LOCAL native analysis integration (2026-09-06)

`runAuthorizedLocalIsolatedAnalysis(input, authorization)` now composes the existing serial stage runner, private stores and Ollama adapter. This is a separate operator-consent path, not a modification of hosted `LIVE_APPROVAL` (still OFF) or its $100 sprint ledger. No real inference was run for this integration.

Caller requirements:
- Supply `mode: 'LOCAL'`, `authorized: true`, a matching `reviewId`, exact source SHA-256 hashes and pre-pinned `roleContracts` for every executed extraction/inventory/principle/applicability role. Pin contracts from the deterministic job builders/offline synthetic transport before launch; never learn authorization from a live response.
- Extraction/principle worker uses `OLLAMA_PILOT_MODELS[0]`; independent inventory/applicability uses `[1]`. Both manifests require `providerSlug: 'ollama'`, `outputKind: 'json_schema'`, zero API prices, `maxCompletionTokens: 2048`, and a positive `maxPromptTokens <= 14336`. Existing adapter settings remain `think:false`, context 16384, output 2048. Unsupported limits/tool mode reject rather than silently changing the contract.
- `principlePolicy` may return `null` for an unavailable capability: no principle inference is sent, and its persisted outcome remains not-evaluated/unavailable/no-edit. Missing dependencies in a supplied non-null policy are not automatically equivalent to an unavailable capability; bounded advisory interpretation remains possible.
- The native transport owns a separate fixed private lock domain under `tmp/local-qualification/local-transport`; sharing the stage lock would deadlock/refuse nested calls. Requests are durably started before inference; bounded raw bodies, telemetry and semantic failures are persisted before return. Replays, unknown completion and failed receipts prevent subsequent inference, including from fresh instances. No automatic reconciliation/reset is provided.

Verification: initial targeted RED was 4 failures/20 passes (missing export and rejected local identity). Targeted GREEN is 25/25. Combined local/decomposition regression was 576 passes plus one existing discovery file-count timeout under parallel filesystem load; serial rerun `npm test -- tests/lib/local-qualification tests/lib/decomposed-benchmark --no-file-parallelism` passed 577/577 across 27 files. Native integration is exercised with synthetic fetch and independent test-owned disk stores; no private inputs or model servers are touched.

Limits: the stage runner still caps stages at 60 seconds; transport defaults to 55 seconds. Its conservative prompt-byte allowance is not calibrated tokenization. The current all-principle applicability DAG blocks downstream applicability/assembly when a sibling principle is unavailable; final analysis still persists every outcome. Rescoring, Atlas integration, chemistry usefulness and full-port scientific acceptance are not established by this change. Older runtime history below is retained, not a statement that installed local IDs remain undiscovered.

## Safety state

**The user authorizes gated real calls, but safety prerequisites remain blocked; no paid or real model calls were performed.** Original private metadata access was denied; the full cohort, cumulative historical spend, and exact Qwen IDs remain unavailable. `createProvider()` fails with `LIVE_NOT_APPROVED`. Test factories require `NODE_ENV=test` and injected synthetic fetch; production root is module-derived `tmp/local-qualification`, already covered by repository `/tmp/` ignore. No credentials were loaded from files. Runtime authorization reads only `OPENROUTER_API_KEY`.

The exact temporary allowlist is `google/gemma-4-31b-it`, supplied as previously approved. No Qwen IDs were guessed. Model availability, pricing, structured-output support, tokenizer bounds, and chemistry quality have NOT been demonstrated by mock tests.

## Contract

- Durable append-only reservation, raw body, and outcome files; exclusive process lock held through body read, validation, and settlement. Attempts are numbered 1–3, explicit only, with no implicit retry, replay overwrite, or stale-lock reclamation. Each retry must preserve both the request hash and reservation amount; persisted retry history is checked for the same invariant.
- Integer microUSD, ceiling conversion of decimal costs, fixed maximum cumulative $100; baseline historical spend must be known. Existing history cannot be reset by reopening. Crashed/unsettled/unknown-cost requests retain full reservation; known reservation overruns stop future calls. Deadline, transport failure, and response-size cancellation outcomes durably stop future reservations, because abort does not prove remote work ceased.
- Root directories 0700, files 0600; checked ancestor components, no-follow opens, exclusive file creation, hardlink rejection on reads, fsync of files and directory. Unknown/corrupt history fails closed. No arbitrary production root option.
- Single exact requested/returned model; one structured JSON response or exact forced function name/count; finish reason and mandatory semantic validator must pass. Request data is deeply snapshotted and the validator reference captured before transport execution. Provider fallback disabled, required parameter support enabled, prompt/completion per-million and request per-request price limits explicit.
- Deadline covers fetch and streaming body consumption. Response bounded to 4 MiB; oversized bodies archive only bounded prefix. Raw archival is attempted for all responses, including invalid output/HTTP errors; if settlement I/O fails, the unresolved reservation blocks further work without another write. Outward errors contain static codes only.

## R1 settlement-I/O correction (implemented; independent acceptance pending)

Independent SPEC review R1 identified that a caught archive/outcome write failure releases the lock with an unresolved reservation, permitting a different tuple. `state()` now derives `stopped` from any reservation without an outcome, retaining the full charge even when only a partial/raw-only archive exists. No compensating stop marker or successful post-failure write is needed. `reserve()` preserves duplicate-attempt `REPLAY` before rejecting new attempts with `LEDGER_STOPPED`. Normal settlement can still complete the current reservation while its lock is held; settled `COST_UNKNOWN` errors retain their explicit retry path. No reset or automatic reconciliation procedure was added.

Strict TDD execution on synthetic test-created directories:

- **RED**, start `22:23:49`: runtime suite **43 passed / 6 failed (49)** before the implementation edit. Reservation-only and raw-only interruptions accepted a new reservation (`expected [Function] to throw an error`). All four injected I/O failures let the reopened provider execute a second synthetic call (`promise resolved ... instead of rejecting`).
- Fault injection covers raw creation, raw write, raw fsync, and outcome creation after an abort-ignoring deadline. The tests first confirm `PRIVATE_IO_ERROR`, an aborted signal, absent outcome, and released lock. After the transient fault clears, both reopened and original providers must reject different tuples without another fetch. Directory contents must remain unchanged: no new reservation or compensating stop marker.
- **GREEN**, start `22:24:37`: `npm test -- tests/lib/local-qualification/provider-manifests.test.ts` exited 0, **49/49 passed**. All original 43 tests and their expectations remain intact, including settled unknown-cost retry and replay behavior.
- `./node_modules/.bin/tsc --noEmit --incremental false` exited 0, no diagnostics in this execution (supersedes neither the historical review failure nor independent review requirements).
- `npm run lint -- lib/local-qualification/provider.ts lib/local-qualification/manifests.ts tests/lib/local-qualification/provider-manifests.test.ts` exited 0, no warnings; `git diff --check` exited 0.

Only `manifests.ts`, `provider-manifests.test.ts`, and this report were modified for R1; `provider.ts` needed no change. No actual/private corpus, credential files, live transport, model discovery, installation, commit, or push was used. Research HEAD matches upstream after fetch; the separate behind local `main` was not modified. Recovery of unresolved history remains an independently approved reconciliation operation, never an automatic reset. Production `LIVE_NOT_APPROVED` is unchanged and tested.

## TDD evidence (runtime recovery verified)

Prior implementer evidence: `npm test -- tests/lib/local-qualification/provider-manifests.test.ts` observed RED with **25 failing tests**, before implementation, missing exports as expected. Initial tests cover persistence/replay, cumulative budget, unknown cost/history, race lock, unsafe hashes/symlinks, permissions/corrupt files, forbidden IDs, no fallback, returned-model mismatch, truncated output, deadline during body read, size bounds, and forced tool success.

Recovery independently reproduced the five existing safety regressions at `22:15:03`: **38 passed / 5 failed (43)**. Existing tests and expectations were not edited. Root causes were mutable caller-owned response gates, JSON parsing taking precedence over HTTP failure classification, no durable cancellation stop, and retries checking identity but not the reserved amount.

Raw RED output excerpts (synthetic fixtures only; original failures retained, not rewritten as successes):

```text
FAIL  does not let caller mutation switch the expected returned model during fetch
AssertionError: promise resolved "{ value: { ok: true }, …(5) }" instead of rejecting

FAIL  does not let caller mutation replace semantic validation while network is pending
AssertionError: promise resolved "{ value: { ok: true }, …(5) }" instead of rejecting

FAIL  archives plaintext HTTP errors with an HTTP error code, not parser error
AssertionError: expected [Function] to throw error including 'HTTP_ERROR' but got 'OUTPUT_INVALID'
Expected: "HTTP_ERROR"
Received: "OUTPUT_INVALID"

FAIL  keeps ledger stopped after a timeout even if transport ignores abort
AssertionError: expected [Function] to throw error including 'LEDGER_STOPPED' but got 'DEADLINE'
Expected: "LEDGER_STOPPED"
Received: "DEADLINE"

FAIL  refuses retry reservation changes for the same request
AssertionError: expected [Function] to throw an error

 Test Files  1 failed (1)
      Tests  5 failed | 38 passed (43)
   Start at  22:15:03
```

Verification after recovery:

| Command | Observed result |
| --- | --- |
| `npm test -- tests/lib/local-qualification/provider-manifests.test.ts` | Exit 0; 43/43 passed; start 22:16:27 |
| `npm test -- tests/lib/decomposed-benchmark tests/lib/local-qualification` | Exit 0; 202/202 passed across 13 files; start 22:16:28 (current shared tree has more tests than the earlier 200-test parent run) |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Exit 0; no diagnostics; BigInt constructor arithmetic compiles with the project target |
| `npm run lint -- lib/local-qualification/provider.ts lib/local-qualification/manifests.ts tests/lib/local-qualification/provider-manifests.test.ts` | Exit 0; no warnings |
| `npm run lint` | Exit 0; 0 errors, 10 warnings in unrelated files |
| `git diff --check` | Exit 0 |

Private bounded raw-response archiving remains intact, including plaintext HTTP errors and partial bodies on deadlines. Parseable HTTP error envelopes still retain available usage cost before classification; reservation overruns retain their stronger stop condition. No real transport, private metadata, credential files, model discovery, package installs, commits, or pushes were used. Synthetic test directories are test-created and cleaned up by the existing suite; this document retains RED execution evidence. Runtime recovery is complete; cohort execution and live release gates remain blocked below.

## External contract verification

Read official API docs before coding request signature:

- https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion
- https://openrouter.ai/docs/guides/routing/provider-selection

Verified `max_completion_tokens`, schema/function options, `usage.cost`, response `model`, and provider `allow_fallbacks`, `require_parameters`, `max_price` units. No endpoint execution occurred.

## Outstanding release gates

Spec approval must precede independent quality approval of loader, provider, stage, and report gates. No live entry point is enabled in this implementation. Historical spend reconciliation/provisioning and crashed-lock recovery require an independently approved operator procedure. Byte-based input reservation includes a template allowance but is not a verified model tokenizer bound; a live-ready bound must be established before enabling paid calls. Same-UID adversarial filesystem mutation during a check/open race is outside Node's no-follow protection for ancestor components; no claim of an OS sandbox is made.

The prescribed Obsidian API dev protocol path was unavailable (`File not found`); repository CLAUDE.md/lessons and current official API docs were read. Branch fetched and checked: research HEAD `30f2520` matches origin/main; unrelated tracked and untracked changes were left untouched.
