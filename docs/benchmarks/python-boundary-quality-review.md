# Python isolated helper boundary — independent quality/security review

## Verdict: APPROVED for the narrow offline unit boundary

No blocking quality or security defect found in the reviewed changes under the stated trusted, injected-transport contract. This approves neither a live transport bridge nor end-to-end helper confidentiality, spend accounting, model qualification, or chemistry correctness. Read alongside `python-boundary-spec-review.md`; this review independently inspected the implementation rather than treating that PASS as code-quality evidence.

## Reviewed scope

- `services/chemistry/isolated_llm_policy.py`
- `services/chemistry/llm_client.py`
- `services/chemistry/test_isolated_llm_boundary.py` and existing `test_llm_client.py`
- Stage-keyword changes and surrounding control flow in `yield_extractor.py`, `smiles_extractor.py`, `scoring/p8_reduce_derivatives.py`, and `scoring/p11_realtime_analysis.py`

The four helper diffs only add explicit `stage` keywords; their parsing, calculations, and retries are unchanged. No source changes were made during review.

## Security and control-flow assessment

**Legacy interception is correctly placed.** `llm_client.py:25–26` dispatches to isolation before reading provider configuration or calling any legacy provider. Exceptions are not caught at this dispatch point, so policy failures cannot turn into `None` and fall through to legacy inference. The helper call sites also do not catch these policy exceptions; existing retries for empty/invalid ordinary responses do not retry a raised policy failure. The keyword-only addition preserves existing positional prompt/system calls.

**Allowlisting and provenance syntax are strict, not semantic.** `isolated_llm_policy.py:17–19,49–54,64–84` uses exact model/stage membership, lowercase hexadecimal source/attempt identifiers, an exact response-key set, returned-model equality, and nonblank bounded text. No family matching, provider fallback, credential reads, dynamic execution, or new network client exists in this module. The transport remains trusted executable code: these checks do not prove that a model actually ran or an attempt/archive exists. The stage is caller-declared, not a security identity authenticated from the calling module.

**Context isolation is correctly token-scoped.** `isolated_llm_policy.py:38,55–59` uses a frozen policy value and resets the ContextVar token in `finally`, supporting restoration after normal exit or exceptions and nested use. This is task-context isolation, not global revocation: tasks created inside a context inherit it and can retain it after the parent exits. A later bridge must own and await/cancel its task tree before releasing mission resources. Context-only activation is present at lines 41–43; any nonempty environment flag separately forces missing-context failure instead of legacy routing.

**Cancellation is preserved rather than disguised.** At lines 72–76, ordinary transport errors and cooperative timeout errors become the fixed `isolated_transport_failed` error. `asyncio.CancelledError` is not an `Exception` on the tested runtime and therefore propagates, which is appropriate for task cancellation; there is no fallback. `wait_for` is not a hard execution or billing deadline: synchronous work before an await can block, cancellation cleanup can exceed the timeout, and a transport can suppress cancellation. These limitations belong in the transport contract, not in a claim of hard sandboxing.

**Ordinary policy errors do not interpolate secrets.** Transport exception chaining is suppressed with `from None`; standard displayed traceback/message output therefore does not include the original transport error. This is not destruction of exception context or locals: telemetry that explicitly inspects `__context__` or captures local variables still needs redaction. Cancellation exceptions also deliberately remain unnormalized. No new logging was introduced.

## Nonblocking findings and follow-on requirements

1. **Validation error normalization is incomplete.** `isolated_llm_policy.py:70,83` encodes strings outside the transport exception handler. Lone-surrogate input or response text raises `UnicodeEncodeError`, not a fixed policy error. Unhashable model/stage values similarly raise `TypeError` at set membership rather than the intended rejection code. These paths fail closed and do not reach legacy routing, so they do not block this typed, offline boundary. Before exposing it to decoded external payloads, validate model/stage types and translate encoding failures into stable input/response errors without including rejected values.

2. **Regression coverage is a useful baseline, not complete boundary assurance.** Persistent tests are missing for context-only activation; nested, concurrent, and exceptional context restoration; cancellation and timeout; malformed source/attempt identifiers; exact response-key rejection; blank/oversized/malformed text; and UTF-8 byte-limit edges. Add deterministic offline regressions before live integration. Also apply forbidden legacy-provider spies to the returned-identity and transport-error test, rather than relying only on raised-error assertions. Existing legacy tests should explicitly remove `GCAI_ISOLATED_EXECUTION` so an inherited flag does not make them environment-dependent. These are inspected gaps, not newly executed passing scenarios.

3. **No-secrets claims must stop at this boundary.** Unchanged helper parsing errors embed response excerpts at `yield_extractor.py:62`, `smiles_extractor.py:145–156`, `scoring/p8_reduce_derivatives.py:110`, and `scoring/p11_realtime_analysis.py:129`. A shape-valid response can reach those paths. This is not a regression from adding the stage keywords, but a live bridge must reject inappropriate responses and/or redact helper diagnostics before claiming end-to-end private-output protection. No such claim is approved here.

4. **Document the changed public error contract.** `llm_client.py:23` still says calls return `None` on failure, whereas isolated calls intentionally raise policy errors and preserve cancellation. Update that docstring when next editing the implementation to prevent callers from adding broad exception-to-legacy fallback handling.

## Independently executed verification

From `services/chemistry`:

```text
python3.14 -m pytest -q -p no:cacheprovider test_isolated_llm_boundary.py test_llm_client.py
......                                                                   [100%]
6 passed in 0.03s
```

These are four boundary tests plus two mocked legacy-client tests. The helper-stage regression uses AST inspection, not live helper execution. Cancellation, concurrency, timeout, and the additional malformed-input cases above were reviewed statically, not runtime-probed. No inline Python probes, installs, model calls, private-corpus reads, or credential inspection were performed. No full chemistry suite or scientific qualification was attempted.

## Workspace and changes

`git fetch` succeeded. This review branch matched its upstream (`0/0`); local `main` was eight commits behind `origin/main`, and was not modified. Existing unrelated dirty files were left untouched. The supplied dev-protocol path was unavailable; no external API implementation was attempted. Only `docs/benchmarks/python-boundary-quality-review.md` was written. No commits or pushes were made.
