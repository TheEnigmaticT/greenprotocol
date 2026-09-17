# GreenChemistry.ai model bakeoff

This is a read-only comparison of the benchmark-only pipeline. Production analysis remains on the existing Anthropic path. The benchmark runner uses frozen protocol input and frozen evidence, calls only the selected provider, and writes sanitized structural results under ignored `tmp/benchmarks/results/`.

## Scope and candidate models

The planned comparison is:

- Claude Sonnet production baseline: `claude-sonnet-4-5-20250929`
- Claude Opus quality ceiling: use the currently approved Claude Opus ID for the account; verify it before running
- OpenRouter: `qwen/qwen3.8-27b`
- OpenRouter: `qwen/qwen3.5-122b-a10b`
- OpenRouter: `google/gemma-4-31b-it`

Model IDs are passed literally. There is no provider fallback, automatic model substitution, or automatic model selection.

## Pre-flight gate

Do not make paid provider requests until all of these checks are recorded:

1. Confirm the exact candidate IDs are present in the OpenRouter catalog. Keep the key out of shell history and output; for an already-authorized environment, a catalog check can be inspected without printing the credential:

   ```sh
   curl -fsS https://openrouter.ai/api/v1/models \
     -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
     | jq -e '.data | map(.id) | {qwen: contains(["qwen/qwen3.8-27b", "qwen/qwen3.5-122b-a10b"]), gemma: contains(["google/gemma-4-31b-it"])}'
   ```

   A false result is a stop condition, not permission to substitute a nearby model. Verify the Claude IDs through the authorized Anthropic account configuration.
2. Confirm `OPENROUTER_API_KEY` is available through the approved Scratchfile flow used by `scripts/benchmarks/run-pipeline-benchmark.ts`. Never copy it into `.env`, a fixture, a result, or a report.
3. Confirm structured output support before measuring. OpenRouter requests use `response_format.type=json_schema`, `strict: true`, and `provider.require_parameters: true` with `allow_fallbacks: false`. Anthropic requests force the strict `return_result` tool. If a provider rejects that mode, mark the model unsupported and stop that model; do not silently retry in free-form text.
4. Confirm the checkout has the synthetic fixtures and that the local reader dry run succeeds. Do not read or export client corpus data as part of this check.

The current scripts do not provide a separate model-catalog command. The catalog request above is a pre-flight check; the benchmark scripts are the only execution entry points.

## Fixtures and safe corpus handling

Use `benchmarks/cases/` for tracked synthetic cases. Every artifact must satisfy the strict reader schema exactly:

```json
{
  "caseId": "fixture-N",
  "protocolText": "synthetic chemistry protocol",
  "frozenLiteratureMatches": [],
  "analysisMetadata": {
    "generatedAt": "2026-01-01T00:00:00.000Z",
    "gcaiVersion": "benchmark-fixture",
    "methodologyVersion": "benchmark-fixture-v1"
  }
}
```

No client names, corpus IDs, credentials, email addresses, traces, prompts, completions, or personally identifying data may enter tracked fixtures. Corpus export requires explicit UUID arguments and `GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS`. The normal path uses `GCAI_BENCHMARK_READ_KEY`; `--service-role` additionally requires `GCAI_BENCHMARK_ALLOW_SERVICE_ROLE=1` and `SUPABASE_SERVICE_ROLE_KEY`. A service-role key bypasses row-level security: use it only for a specifically approved, ID-allowlisted read, and never export a broad table. The exporter writes sanitized artifacts only below `tmp/benchmarks/`.

## Commands

Local reader-only dry run:

```sh
mkdir -p tmp/benchmarks/cases && cp benchmarks/cases/*.json tmp/benchmarks/cases/
npx tsx -e "(async () => { const { readBenchmarkFixtureCases } = await import('./scripts/benchmarks/run-pipeline-benchmark.ts'); const cases = await readBenchmarkFixtureCases('tmp/benchmarks/cases'); console.log(cases.map(c => c.caseId)); })()"
```

Measured fixture run (one warmup plus three recorded repetitions per fixture/model):

```sh
mkdir -p tmp/benchmarks/cases && cp benchmarks/cases/*.json tmp/benchmarks/cases/
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model claude-sonnet-4-5-20250929
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model qwen/qwen3.8-27b
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model qwen/qwen3.5-122b-a10b
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model google/gemma-4-31b-it
```

For Claude Opus, pass the verified approved model ID to the same `--model` argument. The script chooses Anthropic only for model IDs beginning `claude-`; all other IDs use OpenRouter and the authorized Scratchfile key. It writes a sanitized per-model JSON file in `tmp/benchmarks/results/`.

Verification commands for this project:

```sh
npm test -- --run
npm run lint
npx tsc --noEmit
npm run build
```

## Measurement and interpretation

- Warmup is one unrecorded pipeline execution for each fixture/model pair. It is excluded from latency and cost summaries.
- Each pair then receives three measured, non-streaming repetitions. `wallClockMs` covers the completed benchmark run; `phaseLatencyMs` reports parse, principle, reevaluation, assembly, and other recorded stages.
- Use medians and spread for latency, not a single fastest run. Separate provider/network variability from stage behavior.
- Prefer provider-reported generation cost. Missing cost remains unknown; do not infer it from token counts or compare unknown values as zero.
- Structural quality is computed from schema validity, stage failures, principle coverage, recommendation count, and safety flags. It is not a human quality judgment.

## Blind human quality sheet

Human review is a separate, blind artifact. Reviewers receive anonymized case/model labels and the rendered revised protocol/recommendations, not model names or run order. Do not combine this sheet with structural quality into an unvalidated composite score.

Score each output independently, for example 1–5:

| Dimension | Question |
|---|---|
| Protocol fidelity | Did the output preserve the intended operation and constraints? |
| Chemical plausibility | Are proposed changes chemically coherent and experimentally reasonable? |
| Green-chemistry value | Does the change plausibly reduce waste, hazard, energy, or material burden? |
| Actionability | Could a scientist understand what to test next? |
| Calibration | Are uncertainty, yield impact, caveats, and validation needs honestly stated? |

Record rationale and critical errors. Keep the blind sheet distinct from structural fields and unblind only after all reviews are complete.

## Retention and known limits

Retain only sanitized run records: case ID, literal model ID, repetition number, phase/wall-clock latency, known provider cost, and structural quality fields. Do not retain protocol text, prompts, completions, provider traces, generation bodies, credentials, or client identifiers in results. Keep generated artifacts below ignored `tmp/benchmarks/`; remove them according to the project retention policy after the report is accepted.

The benchmark is not a production safety approval, a statistically powered chemistry study, or a guarantee of model availability. Synthetic cases do not represent the full corpus. Empty frozen evidence tests the no-evidence path only. Three repetitions provide a small operational sample. Provider pricing, routing, context limits, and structured-output support can change, so rerun pre-flight before each live bakeoff.

## Report template

```markdown
# Model bakeoff report — YYYY-MM-DD

## Run manifest
- Fixture set / commit:
- Models and exact IDs:
- Provider pre-flight timestamp:
- Warmup: 1 excluded per fixture/model
- Measured repetitions: 3
- Unsupported models / failed gates:

## Structural results
| Model | Schema-valid rate | Principle coverage | Safety flags | Median wall-clock | Median known cost |
|---|---:|---:|---|---:|---:|

## Blind human results
- Sheet identifier:
- Reviewer count:
- Dimensions and medians:
- Critical-error notes:

## Interpretation
- Quality findings:
- Latency findings:
- Cost findings (unknown values called out):
- Synthetic/corpus limitations:

## Decision
No automatic model selection was made. Any proposed default requires explicit human approval, review of both structural and blind-human evidence, and a separate production change.
```
