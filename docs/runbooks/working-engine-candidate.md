# Working engine candidate

## Scope

One runnable candidate in `/Users/ct-mac-mini/dev/greenchemistry-ai-engine-candidate`, branch `feat/portable-engine-candidate`. Baseline: `6e90ec991005004ce908b06e7e51e37c8fe0de46`, plus selected Qwen compatibility and chemical-input repairs. No production deployment or repository merge is implied.

Working source checkpoint: `4ba0a345e6e4d08b9e36728091bb3b8ee39dbf8b`. The subsequent [cleanup record](2026-09-09-candidate-cleanup.md) lists retired scripts, preserved archives/data/worktrees, verification, and recovery paths. The engine runtime is unchanged by that cleanup.

The entry point invokes the same `analyzeProtocol` engine used by the application: extraction → reference conversion → chemistry service scoring → twelve principle passes → research/re-evaluation → assembly. It is not a specialist-model demo. LlaSMol is not required.

## Start and analyze

Prerequisites: Node/npm, `uv`, the existing Python requirements, and credentials for the explicitly selected model endpoint. This candidate has its own installed node_modules and an existing generated solvent-reference index.

From the candidate root, in a normal shell:

```sh
npm ci
export GCAI_ENGINE_CANDIDATE=1
export GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1
export GCAI_LLM_MODEL=qwen/qwen3.8-27b
# OPENROUTER_API_KEY must already be set in this shell; do not put it in source.
export CHEMISTRY_SERVICE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"

npm run engine:chemistry -- --preflight
npm run engine:analyze -- --case fixture-1 --preflight

# Use unique absolute output directories whose parent already exists.
# Keep this PID if running in the background; do not stop unrelated services.
npm run engine:chemistry -- --output /tmp/my-engine-chemistry &
CHEMISTRY_PID=$!
curl --fail http://127.0.0.1:8007/health

npm run engine:analyze -- --protocol-file /absolute/path/protocol.txt --output /tmp/my-engine-analysis
# Or one of: fixture-1, fixture-2, fixture-3, suzuki, aspirin-demo
# npm run engine:analyze -- --case fixture-1 --output /tmp/my-engine-fixture
```

If the first health request races startup, inspect startup output and retry the health request before analyzing. Port 8007 must be free; never terminate a shared service to make it free. A fresh launcher output directory creates an isolated writable cache and loads the shipped public seed. Do not overwrite earlier probe directories.

Each analysis directory includes `manifest.json`, sanitized HTTP receipts, `progress.json`, `result.json`, and `summary.json`; failures inside the execution boundary produce `failure.json`. Configuration/preflight errors go to stderr. A controller/process kill can leave incomplete captures; absence of `result.json`/`summary.json` is not success. `pipelineRuntime` reports complete/degraded; recommendation generation, numeric score availability, and scientific correctness are separate.

## Declared external dependencies

- **Inference:** only the configured compatible chat endpoint/model. OpenRouter-hosted Qwen is the approved development proxy, not proof of local-hardware operation. Candidate mode does not silently fall back to Anthropic/OpenAI credentials.
- **Chemical references:** existing local seed/index first; missing identities may cause public PubChem GET requests. The probe chemistry service strips Supabase configuration and does not write production reference records.
- **Research:** optional, explicit configuration below. Without it, retrieval is unavailable, not evidence that the literature contains no matches.
- **Storage:** local artifact/cache writes only. No user context, saved-analysis write, authenticated browser journey, or production migration is exercised by this runner.

Changing chat serving requires the explicit `GCAI_LLM_BASE_URL`, `GCAI_LLM_MODEL`, and `GCAI_LLM_API_KEY`. The key fallback `OPENROUTER_API_KEY` is valid only for the exact OpenRouter URL above. A compatible local endpoint may use an explicit non-secret placeholder key if its server does not require authentication. Local tool-call compatibility/performance must still be tested; it is not claimed by the hosted runs.

### Optional public evidence connection

Set all of these intentionally before running the isolated runner:

- `GCAI_PUBLIC_EVIDENCE_RPC_URL`: exact HTTPS `/rest/v1/rpc/match_literature_evidence_units` endpoint.
- `GCAI_PUBLIC_EVIDENCE_RPC_KEY`: credential authorized for public evidence reads; do not use a privileged key merely to make a probe pass.
- `GCAI_EMBEDDING_BASE_URL`: explicit compatible `/v1` endpoint.
- `GCAI_EMBEDDING_MODEL`: must match the existing index's embedding family/dimensions.
- `GCAI_EMBEDDING_API_KEY`: explicit key; the exact OpenRouter endpoint may use `OPENROUTER_API_KEY` instead.

Do not silently substitute a different embedding model against the existing index. Research corpus population, ingestion, and production credentials are outside this delivery slice.

### Existing evidence inventory (2026-09-09 inspection)

- The main checkout has `data/literature/crgsc/candidate-evidence-units-v5.jsonl`: 6,784 evidence units across 389 distinct document IDs, all `candidate_pending_adjudication`. This is existing local material, not proof that the remote RPC is populated.
- Its `evidence-embeddings-nomic-v5.jsonl` uses `nomic-embed-text`, 768 dimensions. The candidate Supabase migration defines `VECTOR(1536)` and the legacy embedding family is `text-embedding-3-small`. These indexes are not interchangeable; matching dimensions alone would not establish model compatibility either.
- A bounded next integration can expose the existing local corpus read-only using its matching embedding family, preserving page/quote provenance and pending-adjudication status. Alternatively, the existing remote RPC can be enabled after verifying its actual corpus, model compatibility, and non-privileged read access. Neither route is enabled by this source-grounding change.
- The connected PubChem/solvent references are identity, hazard, and property data. Scoped inspection of main, candidate, and parity source/docs found no separate reaction-precedent corpus or adapter. Identify that source and its read contract before claiming a reaction DB connection; do not start an unrelated reaction-data ingestion project as part of this fix.

## Chemical input changes

- Conversions join to each material occurrence, including step and declared quantity; a global first-name match is not used.
- Missing conversions do not fall back to model-estimated masses. Candidate parser conversions are cleared before reference conversion.
- Cached/curated combined aliases are shared by conversion, hazard, solvent and feedstock lookups; original display names remain intact.
- Retrieved structures/status/provenance enter the reaction helper. Known reactants cannot be replaced or extended with extra unverified identities. Declared products and inferred reaction output remain distinct.
- Candidate parsing filters named products against the submitted text before conversion, scoring, and principle evaluation. Removed names are reported in `result.json` as `inputWarnings`; a chemistry-service prediction may still be separately labeled `model-inferred`. This is a conservative literal-name check (case/whitespace tolerant), not synonym resolution or proof that a name has the correct chemical role. Legacy non-candidate behavior is unchanged.
- Mixtures/polymers/unresolved participants can make reaction-dependent scores unavailable without terminating the other stages.

**Scientific limitations remain:** role classification and extraction are model-dependent. Reaction checks establish catalog consistency/parseability, not experimental correctness, stoichiometric balance, or forward-prediction accuracy. Existing baseline scoring formulas and some default-weight/benchmark heuristics remain; no broad scientific-policy rewrite was imported. Scores are screening outputs, not validated measurements. Unsupported recommendations require expert review and experimental validation.

## Reference index rebuild

For a fresh checkout lacking the generated SQLite index, the existing importer is runnable from the repository root:

```sh
uv run --with-requirements services/chemistry/requirements.txt python scripts/chemistry/build_solvent_evidence_index.py \
  --raw services/chemistry/data/solvent-evidence/raw \
  --manifests services/chemistry/data/solvent-evidence/manifests \
  --output services/chemistry/data/solvent-evidence/solvent-evidence.sqlite
```

Stop your owned chemistry process before replacing its index. The rebuild was exercised into a separate temporary index during verification; source references were not fetched from a new provider.

## Verification and boundaries

`npm test`, `npx tsc --noEmit`, the full Python suite, and `npm run build` are the development checks. Tests should run in an isolated environment without inherited candidate routing flags; do not remove environment settings from a shell needed by your running launcher/client.

`python3 scripts/verify-engine-candidate.py <five analysis directories> --report /absolute/report.json` verifies source fingerprints, actual parse/score requests, terminal outcomes for all twelve principles, assembled results, and captured destinations. It requires exactly the five distinct established fixtures. This is runtime verification, not a chemical accuracy benchmark.

Global lint has four pre-existing errors in `EvidenceAtlas.tsx` and `ProtocolInput.tsx`; dependency audit findings also require release triage. No production deployment, signed-in save/reload, recommendation acceptance/rescoring journey, or fully local inference qualification is claimed.

### Source-grounding verification (2026-09-09)

- The previously failing inventory regression passed after pipeline integration. A preserved actual Qwen parse (`benchmarks/engine-candidate/unnamed-product-parse-regression.json`) also exercises exclusion before enrichment/scoring/principle calls, named-product retention, and unchanged non-candidate behavior.
- Full web suite: 246 passed. Python: 101 passed (33 dependency deprecation warnings). TypeScript and production build passed. Scoped lint and `git diff --check` passed; the four existing global UI lint errors remain.
- Fresh hosted-Qwen run: `/tmp/gcai-candidate-source-wired-02`, same input SHA-256 as `/tmp/gcai-candidate-generic-final`. Completed 12/12 principle passes, seven recommendations, eleven available scores, and a revised procedure in 168.5 seconds. No comparative performance claim is made.
- The live parse did not invent a product this time; the exact captured-parse regression—not that stochastic difference—proves the guard removes the original bad output. The live score request contains no declared product; prediction metadata is `model-inferred` / `reactants_verified_product_inferred`.
- Research remained explicitly unavailable. Captured runner destinations were only the selected OpenRouter chat endpoint and loopback chemistry health/batch/score endpoints. Python helper/public-reference boundaries remain as documented above.
- `/tmp/gcai-candidate-source-wired-01.log` preserves a pre-execution launcher failure caused by missing inherited configuration in the background shell. The successful run used explicit non-secret route settings; no failed attempt was counted as a completed run.
