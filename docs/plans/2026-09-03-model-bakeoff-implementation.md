# GreenChemistry.ai Model Bakeoff Implementation Plan

> **For Hermes:** Use `subagent-driven-development` task-by-task. Preserve the already-dirty working tree; stage only files named below.

**Goal:** Build and execute a reproducible, read-only quality/speed/cost comparison of the current Claude pipeline, Claude Opus, Qwen 3.8 27B, Qwen 3.5 122B-A10B, and Gemma 4 31B.

**Architecture:** Production analysis continues to use the existing Anthropic caller. A benchmark-only pipeline receives a provider-neutral JSON-completion adapter, frozen local corpus, and frozen deterministic dependencies. It never calls the write-capable analysis route or persists benchmark data to Supabase. Each run retains in-memory stage telemetry then writes sanitized JSON under ignored `tmp/benchmarks/results/`.

**Candidate IDs:**
- `qwen/qwen3.8-27b`
- `qwen/qwen3.5-122b-a10b`
- `google/gemma-4-31b-it`

**Tech stack:** Next.js/TypeScript, Vitest, existing Anthropic and OpenAI SDKs, OpenRouter REST API, Supabase authenticated read-only export.

---

## Gates

1. **Pre-flight:** exact candidate IDs exist in OpenRouter catalog; `OPENROUTER_API_KEY` can be loaded from the user-authorized Scratchfile without printing or committing it; all candidates accept the structured-output mode, or unsupported mode is reported rather than silently substituted.
2. **Corpus:** export only approved Alana and Sentinel records through a user-authenticated or explicitly ID-allowlisted read-only flow; sanitize into `tmp/benchmarks/alana/`; no raw traces, IDs, emails, or corpus data is committed.
3. **Harness:** fake-provider and fixture-mode tests fail first and then pass before any paid request.
4. **Execution:** one warmup excluded from metrics, three recorded repetitions per case/model; non-streaming completed-response latency only; generation-level cost retained when available, otherwise marked unknown.
5. **Report:** a blind human quality sheet is separate from computed structural quality; no default/fallback recommendation is made without both.

## Task 1: Contract and provider adapters

**Files:**
- Create `lib/benchmark/provider.ts`
- Create `lib/benchmark/anthropic-provider.ts`
- Create `lib/benchmark/openrouter-provider.ts`
- Create `tests/lib/benchmark/provider.test.ts`

Write failing tests for normalized usage, forced Anthropic tool output, literal OpenRouter model ID, disabled provider fallback, JSON errors with provider/model/stage metadata, and absent generation cost remaining unknown. Implement the smallest adapters to pass.

## Task 2: Benchmark-only stage runner

**Files:**
- Create `lib/benchmark/contracts.ts`
- Create `lib/benchmark/stage-runner.ts`
- Create `tests/lib/benchmark/stage-runner.test.ts`

Copy—not change—the current prompt/schema contracts. With a fake provider, test parse → 12 principles → frozen evidence → re-evaluation → assembly, per-stage telemetry, stage failures, and no persistence invocation. Keep deterministic post-processing equivalent to current production behavior.

## Task 3: Corpus and fixture runner

**Files:**
- Create `lib/benchmark/types.ts`
- Create `lib/benchmark/quality.ts`
- Create `lib/benchmark/runner.ts`
- Create `scripts/benchmarks/export-corpus.ts`
- Create `scripts/benchmarks/run-pipeline-benchmark.ts`
- Create `tests/lib/benchmark/quality.test.ts`
- Create `tests/lib/benchmark/runner.test.ts`
- Modify `.gitignore`
- Modify `package.json`

Fixture-mode must use no network beyond the selected LLM provider. The export command must require explicit fixture IDs, use an authenticated read-only endpoint or a service-role key only if supplied through a separately logged ID allowlist, redact identifiers/traces, and write only below `tmp/benchmarks/`. Results are JSON and no data artifacts are tracked.

## Task 4: Documentation and dry-run verification

**Files:**
- Create `docs/benchmarks/model-bakeoff.md`
- Create `benchmarks/README.md`
- Create synthetic fixture cases under `benchmarks/cases/`

Document rubric, pre-flight, operating commands, retention, known limits, and report template. Verify lint/typecheck/test/build using project-supported commands.

## Task 5: Execute approved corpus and publish report

1. Retrieve the authorized OpenRouter key in-process only from `/Users/ct-mac-mini/Obsidian/CrowdTamers Obsidian Vault/Scratchfile.md`; do not echo, commit, or store it in project `.env`.
2. Export selected Alana and Sentinel analyses only after an authenticated read-only access path is available. If unavailable, execute synthetic and Sentinel fixture tests and report the exact authorization blocker instead of bypassing RLS.
3. Run Claude Sonnet (production baseline), Claude Opus (quality ceiling), and the three literal OpenRouter IDs. Use three measured repeats.
4. Produce sanitized results and a report covering quality, schema validity, unsafe/unsupported recommendations, phase/wall-clock latency, actual provider cost, and model-selection recommendation.

**Verification commands:**
- `npm test -- --run`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
