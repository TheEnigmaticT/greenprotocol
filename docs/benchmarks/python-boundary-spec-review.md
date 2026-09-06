# Python isolated helper boundary — independent spec review

## Verdict: PASS for the narrow offline unit boundary

No blocking discrepancy found in the reviewed implementation against the supplied narrow spec. This is **not** approval of a live mission bridge, spend accounting, semantic correctness, or scientific qualification.

## Scope and findings

- `services/chemistry/llm_client.py:15–28`: optional keyword-only `stage`; isolated-context/environment dispatch occurs before legacy provider environment reads. Exceptions from isolated dispatch propagate rather than entering a legacy fallback. The rest of the legacy routing implementation is unchanged in the diff.
- `services/chemistry/isolated_llm_policy.py:16–59`: exact singleton allowlist `google/gemma-4-31b-it`; no Qwen or family/prefix matching. Explicit source hash must be 64 lowercase hexadecimal characters. Callable transport is mandatory; ContextVar token is restored in `finally`. Any nonempty `GCAI_ISOLATED_EXECUTION` value activates isolation, including `0` or `false`.
- `services/chemistry/isolated_llm_policy.py:62–85`: missing context and absent/unknown stage fail closed. Input types and combined UTF-8 size are checked, transport awaits use a 120-second timeout, ordinary transport exceptions become a fixed error without displayed exception chaining, and the response must contain exactly `model`, `text`, and `attempt_id`. Returned model must match the selected model; attempt ID must be 64 lowercase hexadecimal characters; text must be nonblank and at most 131072 UTF-8 bytes. There is no provider fallback.
- The policy module imports no network client and reads no credentials. It accepts an injected transport; it does not itself implement or verify reservation, ledger, archive, or scientific semantics. Its header explicitly disclaims live qualification and ledger ownership. Source/attempt hash syntax validation is not proof of source/archive existence.
- Exact explicit stage call sites, also checked by the uncommitted AST regression:
  - `services/chemistry/yield_extractor.py:49` — `stage="yield"`
  - `services/chemistry/smiles_extractor.py:138` — `stage="smiles"` (inside retry loop)
  - `services/chemistry/scoring/p8_reduce_derivatives.py:96` — `stage="p8"`
  - `services/chemistry/scoring/p11_realtime_analysis.py:101` — `stage="p11"` (inside retry loop)
- Each of these four stage-file diffs changes only the call keyword. Deterministic calculations, parsing, and existing retry logic are untouched.

## Execution evidence

Independently executed from `services/chemistry`:

```text
python3.14 -m pytest -q -p no:cacheprovider test_isolated_llm_boundary.py test_llm_client.py
......                                                                   [100%]
6 passed in 0.03s
```

The four boundary tests cover environment isolation ahead of legacy routing, missing policy/stage rejection, approved model/source forwarding, forbidden model rejection, returned-model mismatch, sanitized transport exceptions, and explicit stage keywords in all four files. The two existing client tests cover legacy OpenRouter priority/model override. Parent-reported red-four history was not independently replayed; this review independently observed green-six only. Synthetic transport text is not scientific evidence.

## Nonblocking gaps and follow-on gates

- Add persistent regressions for context-only activation and restoration, arbitrary nonempty environment values, malformed source/attempt IDs, input/output size boundaries, and timeout behavior. These paths were inspected, not independently runtime-covered by the six tests.
- UTF-8 encoding is outside the sanitized transport exception block. Lone-surrogate strings can raise `UnicodeEncodeError` rather than a stable policy error. This remains fail-closed with no fallback, but is an error-normalization hardening opportunity.
- `asyncio.wait_for` is a cooperative timeout, not a process-level kill boundary; the reviewed injected transport must honor cancellation and reconcile reservations/attempts if canceled.
- The approved model ID is checked against the task's supplied approved value. This review does not freshly verify provider metadata or approve any Qwen ID.
- Full mission acceptance still requires the actual reviewed transport/bridge, real reservation and attempt/archive readbacks, semantic validation, and actual helper-stage runs. No undefined follow-on integration is treated as complete here.

## Review constraints

`git fetch` succeeded; the reviewed branch matched its upstream (`0/0`). Local `main` was eight commits behind `origin/main`; no reconciliation or code modification was needed for this independent review. The workspace dev-protocol path supplied in context was missing. An optional supplemental inline Python probe was blocked by the execution approval policy and was not run or retried via an alternate execution mechanism. These do not invalidate the independently successful pytest result.

Only this report was created; no source edits or commits were made.
