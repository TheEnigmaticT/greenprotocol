# Synthetic benchmark fixtures

This directory contains tracked, synthetic chemistry protocols for exercising the benchmark reader and runner without client data or provider calls. The artifacts are deliberately public fixtures: each has a `fixture-N` case ID, a viable protocol, an empty `frozenLiteratureMatches` list, and the exact public fixture metadata required by the reader.

## Validate the reader without a provider

From the repository root, stage the reviewed tracked fixtures into the guarded runtime tree, then read them:

```sh
mkdir -p tmp/benchmarks/cases && cp benchmarks/cases/*.json tmp/benchmarks/cases/
npx tsx -e "(async () => { const { readBenchmarkFixtureCases } = await import('./scripts/benchmarks/run-pipeline-benchmark.ts'); const cases = await readBenchmarkFixtureCases('tmp/benchmarks/cases'); console.log(cases.map(({ caseId, protocolText }) => ({ caseId, protocolLength: protocolText.length }))); })()"
```

This only reads local JSON. It does not load credentials, contact Supabase, or call a model. The reader intentionally accepts only paths under `tmp/benchmarks/`; tracked fixtures are staged there rather than weakening that guard.

## Full fixture benchmark

The supported entry points are the package scripts:

```sh
mkdir -p tmp/benchmarks/cases && cp benchmarks/cases/*.json tmp/benchmarks/cases/
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model claude-sonnet-4-5-20250929
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model qwen/qwen3.8-27b
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model qwen/qwen3.5-122b-a10b
npm run benchmark:run -- --fixture tmp/benchmarks/cases --model google/gemma-4-31b-it
```

The runner performs one warmup per fixture/model, excludes it from metrics, then records three measured repetitions. Results are written below ignored `tmp/benchmarks/results/`; raw prompts and completions are not retained. Do not run these examples unless the relevant provider and model pre-flight has passed.

## Corpus export is separate

Synthetic fixtures do not require corpus export. For an approved corpus read, pass explicit UUIDs and an explicit allowlist; never export a broad table:

```sh
GCAI_BENCHMARK_READ_KEY='authorized-read-credential' \
GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' \
npm run benchmark:export-corpus -- aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
```

A service-role read is blocked unless both the credential and the deliberate gate are present:

```sh
GCAI_BENCHMARK_ALLOW_SERVICE_ROLE=1 \
SUPABASE_SERVICE_ROLE_KEY='authorized-service-role' \
GCAI_BENCHMARK_ALLOWED_FIXTURE_IDS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' \
npm run benchmark:export-corpus -- --service-role aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

Use only credentials supplied through the approved secret mechanism; do not put them in project `.env` files, commit them, or print them. Service-role bypasses row-level security and is a high-risk exception. Export output is restricted to `tmp/benchmarks/` and is sanitized before writing.
