# Portable, Self-Hosted GreenChemistry.ai Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make GreenChemistry.ai deployable as one verified, customer-controlled product stack—without AWS/Google Cloud Run/Vercel/Supabase being runtime requirements—and select a model-provider configuration from measured Sentinel results for Anthropic, Qwen 27B, Gemma 31B, and Qwen 128B Q4.

**Architecture:** Preserve the present Next.js UI and FastAPI/RDKit chemistry engine, but replace vendor-bound seams with explicit deploy-local interfaces: PostgreSQL + pgvector, a local auth layer, object storage, durable job execution, and one OpenAI-compatible LLM provider contract. Build a canonical Compose deployment which serves both customer-managed and GC.ai-operated environments. Model compute is an optional separate GPU service/profile, never a hidden assumption of the base application installation.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, FastAPI/RDKit/Python 3.14, PostgreSQL 16 + pgvector, Redis, MinIO or an S3-compatible customer bucket, Docker Compose, Caddy, OpenAI-compatible LLM APIs (Anthropic adapter plus vLLM/SGLang/llama.cpp-compatible self-hosted adapter), Vitest, Playwright, GitHub Actions.

---

## 1. Reality, decisions, and non-goals

### Current, verified state

- `lib/pipeline.ts` directly creates an Anthropic client and uses Anthropic Tool Use for parse, principle evaluation, assembly, and reevaluation. The core pipeline is **not currently provider-agnostic**.
- `lib/talk-about-this/chat-provider.ts` is a separate OpenAI-compatible seam, but it permits only loopback endpoints and `openrouter.ai`; it is not the core analysis provider abstraction.
- The deployable container currently covers only `services/chemistry`. The running product still relies on Vercel, Supabase, Cloud Run, and Anthropic/OpenRouter depending on the path.
- Existing Supabase migrations use Postgres-specific capabilities: JSONB, Row Level Security policies using `auth.uid()`, `pgvector`, and `FOR UPDATE SKIP LOCKED` job leasing. PostgreSQL is therefore the required self-hosted database; MySQL is explicitly out of scope.
- The 0.8 backlog already defines portable deployment, customer-local ingestion, and Sentinel as release lanes. This plan converts those requirements into a sequenced implementation.

### Deployment modes

1. **GC.ai-operated SaaS:** The same container images and Postgres schema run in GC.ai’s selected cloud account. Managed Postgres/object storage may be used operationally, but no code path depends on a Supabase, Vercel, or Cloud Run API.
2. **Customer-controlled VPC:** The same Compose topology runs in the customer’s cloud account/VPC. Customer chooses model mode and egress policy.
3. **Customer on-prem / air-gapped:** Same base stack; model server and data stores are local. PubChem/public APIs/literature connectors operate only if the customer enables outbound egress or provides an approved local mirror. The UI must label their disabled/unavailable state rather than silently fabricating enrichment.
4. **White-label API:** Defer as a packaging variant after the portable web/API stack has passed the release gate. Do not create a second orchestration implementation first.

### Explicit non-goals for 0.8 portability

- No MySQL migration.
- No Kubernetes requirement; Compose is the supported single-node/pilot installation. Document a future multi-node topology but do not claim it is supported.
- No arbitrary model endpoint or automatic model discovery. Endpoints, model IDs, TLS trust, auth mode, and approved capabilities are explicit administrator configuration.
- No unbounded customer-data export, source write-back, full-text journal scraping, or use of customer data for shared model improvement.
- No production cutover until the self-hosted release candidate passes functional, backup/restore, upgrade, security, and Sentinel equivalence gates.

### Architecture contract

```text
Browser
  -> Caddy (TLS, static/app proxy, request limits)
  -> gcai-web (Next.js app/API; SSE)
       -> gcai-chemistry (FastAPI/RDKit)
       -> PostgreSQL + pgvector (application, auth, provenance, queue state)
       -> Redis (short-lived cache, rate limits, distributed locks where justified)
       -> S3-compatible object store (raw approved snapshots, attachments, backups)
       -> gcai-worker / gcai-scheduler (ingestion, retries, indexing, maintenance)
       -> LLM provider contract
            -> Anthropic adapter (external, opted in)
            -> OpenRouter adapter (external, opted in)
            -> OpenAI-compatible local gateway (customer LAN/VPC)
                 -> vLLM/SGLang/llama.cpp model host on separate GPU hardware
```

- The web/API, worker, chemistry, database, object storage, and ingress form the **base platform**.
- Model inference is a separately declared dependency: `external`, `customer_hosted`, or `disabled`. It is not bundled into the default Compose profile.
- `customer_hosted` calls an internal TLS endpoint or a loopback endpoint through a narrowly configured allowlist. It must not expose the model service to the public Internet.
- Each analysis records provider type, endpoint class (never secrets), model ID, model revision/quantization where available, prompt/schema version, latency, token counts when the provider supplies them, and deterministic-service version.

---

## 2. First execution slice: model benchmark before portability migration

The first build slice is not a deployment rewrite. It makes the existing analysis workload evaluable across models and produces the decision record that determines the self-hosted model baseline.

### Benchmark candidates

- Anthropic production baseline: the exact currently configured Sonnet model.
- Qwen 27B: exact Hugging Face/Ollama/vLLM identifier and quantization pinned in the benchmark manifest.
- Gemma 31B: exact identifier and quantization pinned in the manifest.
- Qwen 128B Q4: exact source, quantization format, context length, serving engine, tensor-parallel configuration, and hardware pinned in the manifest.

Do not write a result as “Qwen 27B” or “Qwen 128B Q4” without those fingerprints; they are not reproducible configurations.

### Benchmark corpus

1. Start with the four sanitized Sentinel protocol fixtures already defined by GreenChemistry Sentinel: chiral resolution, PET polycondensation, diazotization, and Jacobsen epoxidation.
2. Add a small versioned set of synthetic stress fixtures covering: incomplete quantities; ambiguous reagent names; multi-step workup/purification; a solvent recommendation that must respect the compatibility matrix; a deliberately non-chemistry input; and a tool/schema adversarial response fixture.
3. Keep proprietary DSV protocols, credentials, customer names, and raw traces out of the benchmark corpus and repository.
4. Pin fixture IDs, canonical input text hash, expected deterministic outcome, allowed unresolved-material state, and scientific-review rubric version.

### Measurements

Run each candidate at least three times with the same temperature, max output token budget, prompt/schema revision, and concurrency setting. Capture:

- Availability: completion rate, transport/provider failures, timeout rate, first-token timeout and full-analysis timeout.
- Latency: wall-clock analysis time; per-stage time; p50/p95 TTFT; p50/p95 output tokens/sec; p50/p95 total tokens/sec; queue time; cold versus warm start.
- Structured validity: schema-valid response rate by phase; tool/function-call success rate; repair/retry count; malformed/empty/partial output rate.
- Functional fidelity: parse completeness, chemical/quantity/condition extraction accuracy, deterministic-score completion, recommendation schema quality, evidence/provenance labeling, and revised-protocol validity.
- Scientific quality: blinded human rubric against fixture-specific expected facts. Record false-positive unsafe substitutions, unsupported recommendations, missed high-severity hazards, inappropriate confidence/evidence claims, and whether the model preserves the “experimental validation required” boundary.
- Consistency: protocol fingerprint, score availability, recommendation count/content drift, grade drift, and repeated-run variability. Never call LLM-derived changes “deterministic.”
- Resource/cost: host RAM/VRAM, CPU/GPU utilization, model load time, peak memory, energy if accessible, external token cost, and per-analysis cost estimate.

### Initial selection gate

A model is eligible for the customer-hosted default only when it:

- completes at least 95% of benchmark runs without a model/provider failure;
- produces schema-valid outputs in at least 99% of phase calls, or has an auditable bounded repair strategy that meets the same end-to-end threshold;
- meets the explicit scientific-safety rubric floor established against Anthropic, with no critical unsafe recommendation;
- meets target interactive throughput on the actual GC.ai prompts at the target context window—`>=30 output tokens/sec per interactive stream` is measured separately from aggregate batch throughput;
- has a documented hardware bill of materials and stable startup/health-check behavior.

If none meets the gate, retain external inference as the supported production model mode and still deliver the rest of the portable stack. Do not lower scientific gates merely to claim a fully local model.

---

## 3. Implementation tasks

### Task 1: Establish a portable-platform decision record and benchmark manifest

**Objective:** Make model selection, product scope, assumptions, and acceptance criteria machine-readable before refactoring runtime infrastructure.

**Files:**
- Create: `docs/architecture/portable-platform.md`
- Create: `docs/benchmarks/model-benchmark-manifest.schema.json`
- Create: `docs/benchmarks/model-benchmark-manifest.example.json`
- Create: `docs/benchmarks/scientific-quality-rubric.md`
- Create: `tests/fixtures/sentinel/README.md`
- Modify: `BACKLOG.md`

**Steps:**
1. Write a failing JSON-schema validation test for a benchmark manifest missing a model revision, quantization, serving engine, fixture hash, or hardware fingerprint.
2. Add the manifest schema and a valid baseline manifest.
3. Write the scientific evaluation rubric with critical-fail categories: unsupported certainty, wrong/unsafe substitution, incorrect evidence label, falsified deterministic claim, and loss of a required caveat.
4. Add a 0.8 child card: “Model benchmark and provider-selection gate,” linked to this design and its Sentinel artifacts.
5. Run schema tests and ensure the manifest can be parsed in CI.

**Acceptance:** A future benchmark cannot be reported without an exact model and run configuration, a fixture revision, and a pass/fail rubric.

### Task 2: Build the benchmark runner independently of provider implementation

**Objective:** Create a reproducible CLI that invokes the real analysis pipeline through a selected provider configuration and emits sanitized JSONL artifacts.

**Files:**
- Create: `scripts/benchmark-models.ts`
- Create: `lib/benchmark/types.ts`
- Create: `lib/benchmark/metrics.ts`
- Create: `tests/lib/benchmark/metrics.test.ts`
- Create: `tests/lib/benchmark/manifest.test.ts`
- Create: `docs/benchmarks/README.md`

**Steps:**
1. Write failing unit tests for stage timing, token-rate calculation, p50/p95 aggregation, schema-validity accounting, and exclusion of secrets/raw proprietary protocol text from emitted artifacts.
2. Implement the metrics helpers.
3. Implement CLI arguments: manifest path, provider profile, fixture selector, repeat count, concurrency, output directory, `--dry-run`, and `--allow-external`.
4. The runner writes a unique run directory containing: resolved manifest; environment fingerprint with secrets redacted; results JSONL; stage metrics; failure taxonomy; summary JSON; and Markdown report.
5. Test `--dry-run` against a fake provider before allowing any paid provider call.

**Validation:** `npm run test -- tests/lib/benchmark`; then invoke the CLI with a fake provider and inspect that its report has no secret values.

### Task 3: Formalize the core LLM provider interface

**Objective:** Replace Anthropic-specific pipeline calls with one typed provider contract that can represent the actual GC.ai structured-output use case.

**Files:**
- Create: `lib/llm/provider.ts`
- Create: `lib/llm/types.ts`
- Create: `lib/llm/anthropic-provider.ts`
- Create: `lib/llm/openai-compatible-provider.ts`
- Create: `lib/llm/provider-config.ts`
- Create: `tests/lib/llm/provider-config.test.ts`
- Create: `tests/lib/llm/anthropic-provider.test.ts`
- Create: `tests/lib/llm/openai-compatible-provider.test.ts`
- Modify: `lib/pipeline.ts`
- Modify: `app/api/analyze/route.ts`

**Contract requirements:**
- `generateStructured({ model, system, user, schema, label, maxTokens, temperature, timeout, correlationId })` returns normalized JSON, provider/model identifiers, usage when available, stage latency, raw response hash, and a typed error classification.
- Providers report `supportsStructuredOutput`, `supportsToolCalling`, `supportsJsonSchema`, `supportsUsage`, and `endpointClass` rather than pretending API compatibility guarantees identical features.
- Anthropic keeps its Tool Use implementation behind the adapter; OpenAI-compatible hosts use strict JSON schema/function calling only when the selected server demonstrably supports it. A bounded parse-and-validate repair path is allowed only if it is recorded and benchmarked.
- Endpoint configuration is explicit: provider kind, base URL, model, auth secret reference, TLS/CA policy, timeout, allowed model IDs, and allowed endpoint hostnames/CIDRs. No request may redirect to an arbitrary supplied URL.

**TDD steps:**
1. Write failing provider-contract tests for valid Anthropic Tool Use translation, valid OpenAI-compatible structured output translation, malformed JSON, unsupported tools/schema, timeout, 429/503, and allowlist rejection.
2. Implement adapters without changing pipeline behavior.
3. Inject provider dependencies into pipeline entry points; remove the module-global Anthropic client.
4. Run the existing pipeline-ranking tests plus new provider tests.

**Acceptance:** A fake provider can run every core pipeline phase in tests; Anthropic remains behaviorally equivalent; a local OpenAI-compatible endpoint can be configured without modifying pipeline code.

### Task 4: Route all model-using paths through the same policy layer

**Objective:** Eliminate divergent model configuration between core analysis, chemistry-side surgical calls, and scoped chat.

**Files:**
- Modify: `services/chemistry/llm_client.py`
- Modify: `lib/talk-about-this/chat-provider.ts`
- Create: `docs/architecture/llm-provider-policy.md`
- Create/modify: corresponding Python and TypeScript tests

**Steps:**
1. Inventory every `ANTHROPIC_API_KEY`, local endpoint, and model environment variable in the app and chemistry service.
2. Define separate but consistent configuration namespaces for `ANALYSIS_LLM_*`, `CHEMISTRY_LLM_*`, and `CHAT_LLM_*`; they may select different approved models but use the same endpoint validation, secret-reference, timeout, audit, and health conventions.
3. Change scoped chat’s local-only rule into an explicit deployment allowlist that supports customer LAN/VPC DNS names and private IP ranges only when configured by the installation administrator.
4. Add tests that reject public arbitrary endpoints, URLs with embedded credentials, unapproved model IDs, and private-range bypass tricks.
5. Publish a migration map from legacy environment variables.

**Acceptance:** All model calls are discoverable, policy-controlled, traced, and fail into an explicit `model_unavailable` state.

### Task 5: Make Sentinel a real provider-comparison harness

**Objective:** Turn the current Sentinel concept and fixtures into executable tests that can run with deterministic doubles and selected real model profiles.

**Files:**
- Create: `tests/sentinel/manifest.json`
- Create: `tests/sentinel/fixtures/*.json`
- Create: `tests/sentinel/model-provider.spec.ts`
- Create: `tests/sentinel/scientific-rubric.ts`
- Create: `scripts/run-sentinel.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Modify: GitHub workflow files

**Steps:**
1. Define `test:unit`, `test:contract`, `test:e2e`, `test:sentinel:mock`, `test:sentinel:real`, and `test:all` scripts without mixing Vitest and Playwright file collection.
2. Add model-provider contract fixtures with valid outputs, malformed outputs, timeout, quota, and unavailable states.
3. Add the four sanitized analysis fixtures and explicitly mark expected unresolved materials as `INCOMPLETE`, not failures.
4. Add test assertions that a fully resolved fixture has 12 valid principle entries, non-empty grade, no `-1` score, and valid provenance; an unavailable dependency renders a labeled recoverable status rather than a partial answer masquerading as complete.
5. Keep real-model Sentinel opt-in, uses non-production credentials, and produces sanitized artifacts only.

**Acceptance:** Provider comparison results are generated by a common command, not manual screenshots or anecdotal impressions.

### Task 6: Add an application image and runtime configuration model

**Objective:** Turn the Next.js application into a reproducible container and remove Vercel-specific runtime assumptions.

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `deploy/env/app.env.example`
- Create: `deploy/config/config.schema.json`
- Create: `deploy/config/validate-config.ts`
- Create: `tests/deploy/config-validation.test.ts`
- Modify: `next.config.*` only if standalone output is required
- Modify: `README.md`

**Steps:**
1. Write failing config-validation tests for missing database, storage, auth signing key, chemistry URL, and selected LLM mode settings.
2. Build a multi-stage non-root Next.js image with an immutable application artifact and no secrets baked in.
3. Implement `node deploy/config/validate-config.ts` as a preflight command that checks syntax and cross-field invariants without calling external services.
4. Pass settings via environment variables/secrets files or deployment secret manager references; never ship `.env.local`.
5. Add container health endpoint behavior that reports app readiness separately from model-provider availability.

**Acceptance:** `docker build` creates a web image; config preflight rejects invalid topologies; the image can use a deploy-local database and chemistry endpoint.

### Task 7: Provide a canonical Compose topology

**Objective:** Create one supported installation artifact rather than separate “SaaS,” “VPS,” and “on-prem” code paths.

**Files:**
- Create: `deploy/compose/docker-compose.yml`
- Create: `deploy/compose/docker-compose.model-local.yml`
- Create: `deploy/compose/docker-compose.dev.yml`
- Create: `deploy/caddy/Caddyfile`
- Create: `deploy/env/platform.env.example`
- Create: `deploy/scripts/preflight.sh`
- Create: `deploy/scripts/healthcheck.sh`
- Create: `docs/deployment/compose-topology.md`

**Required base services:** `caddy`, `web`, `chemistry`, `worker`, `scheduler`, `postgres`, `redis`, `minio`.

**Model profiles:**
- `external`: no local model container; external provider is explicitly enabled.
- `local-endpoint`: no model container; uses customer-provided private endpoint.
- `local-model`: optional, hardware-specific Compose overlay or separate model-host deployment; never starts by default.
- `disabled`: analysis UI exposes that model-assisted analysis is unavailable; deterministic/admin functions remain appropriately bounded.

**TDD / validation:**
1. Add a Compose config test that runs `docker compose config` for every supported profile.
2. Run the base stack with fake LLM and chemistry fixtures.
3. Verify a named-volume install survives restart and all health checks become ready.
4. Verify Caddy exposes only its intended ports and internal services remain on the private Compose network.

**Acceptance:** A customer can select one documented profile and bring the stack up with a single validated configuration command.

### Task 8: Replace hosted Supabase runtime dependency with self-hosted Postgres plus an auth boundary

**Objective:** Preserve schema, authorization, and user-facing login behavior without requiring Supabase Cloud.

**Files:**
- Create: `db/migrations/` migration runner layout or adopt a single explicit migration tool
- Modify: `supabase/migrations/*` only via a documented migration conversion/retention strategy
- Create: `lib/db/` repository layer
- Create: `lib/auth/` adapter interface and local implementation
- Modify: `lib/supabase/*`, API routes, middleware, and repositories currently coupled to Supabase
- Create: `tests/integration/auth/*.test.ts`
- Create: `tests/integration/repositories/*.test.ts`
- Create: `docs/architecture/auth-and-tenant-isolation.md`

**Decision rule:** Do not replace Supabase’s auth/RLS semantics with raw Postgres calls scattered through routes. Choose either:
- self-hosted Supabase as an internal component, if its operational footprint and licensing fit the supported installation; or
- direct PostgreSQL plus a deliberately selected local OIDC/auth service and a GC.ai repository/authorization layer.

Make this decision in an ADR after an implementation spike. The chosen design must preserve tenant/user isolation, service/admin actions, session handling, password/OIDC options, and auditability.

**TDD steps:**
1. Create integration tests against disposable Postgres for every current `gpc_*` authorization boundary.
2. Reproduce current RLS behaviors as behavior tests: own analysis access, cross-user denial, trace visibility, admin-only write paths, and ingestion tenant isolation.
3. Implement the selected auth/data adapter in narrow slices, maintaining Supabase compatibility temporarily behind the same repository interfaces.
4. Run schema migration from an empty database and from a scrubbed production-shaped backup.

**Acceptance:** A clean local Postgres installation can authenticate users, persist analyses and traces, enforce tenant isolation, run vector search, and pass all authorization contract tests without Supabase Cloud.

### Task 9: Add object storage, raw-data lifecycle, and backups

**Objective:** Make raw evidence snapshots, attachment references, and recovery data durable on customer-controlled storage.

**Files:**
- Create: `lib/storage/` abstraction and S3-compatible implementation
- Create: `services/worker/` storage lifecycle jobs
- Create: `deploy/scripts/backup.sh`
- Create: `deploy/scripts/restore.sh`
- Create: `deploy/scripts/verify-backup.sh`
- Create: `docs/operations/backup-restore.md`
- Create: tests for object key scoping, retention, and restore

**Requirements:**
- Tenant-prefixed, opaque object keys; no customer names or secrets in object paths.
- Encryption configuration documented for storage at rest and transit.
- Raw source snapshots, normalized records, derived indexes, and generated interpretations remain distinct.
- Backups include Postgres logical backup, required object prefixes, migration/version manifest, app image digest, and config fingerprint without secrets.
- Restore is exercised into a clean isolated environment and checked by Sentinel fixtures.

**Acceptance:** Backup/restore is not documentation-only: the automated restore test proves a saved analysis, trace, and eligible evidence record survive without cross-tenant leakage.

### Task 10: Extract durable jobs from the analysis request path

**Objective:** Make ingestion/retrieval/indexing/retries deploy-local, recoverable, observable, and independent of serverless request timeouts.

**Files:**
- Create: `services/worker/` or `lib/jobs/` with an explicit job contract
- Create: `services/scheduler/`
- Create: `lib/jobs/types.ts`
- Create: `tests/integration/jobs/*.test.ts`
- Modify: PubChem recovery and new ingestion paths
- Modify: `deploy/compose/docker-compose.yml`
- Create: `docs/architecture/job-lifecycle.md`

**Required behavior:**
- Jobs are durable in Postgres, idempotent, lease-safe, cancellable, tenant-scoped, and correlation-ID traced.
- Retry uses bounded exponential backoff with jitter and provider-specific rate/quota handling.
- Worker restarts recover expired leases safely.
- Source outage means `deferred` or `unavailable`; confirmed absence means `not_found`; neither may mutate a saved analysis.
- Analysis requests never wait for nonessential source refresh/index work.

**Acceptance:** Kill a worker during a fixture ingest, restart it, and prove exactly one normalized/indexed result exists with retained provenance and an accurate job history.

### Task 11: Make chemistry enrichment portable and truthful about egress

**Objective:** Support local deterministic scoring without silently treating external PubChem availability as a local capability.

**Files:**
- Modify: `services/chemistry/reference_store.py`
- Modify: `services/chemistry/main.py` and relevant scoring/recovery modules
- Create: `services/chemistry/reference-provider.py`
- Create: `tests/chemistry/reference-provider.test.py`
- Create: `docs/deployment/egress-and-reference-data.md`

**Modes:**
- `cached-plus-public`: local cache plus allowed PubChem calls.
- `local-snapshot-only`: approved versioned reference data/cache only; misses are visible as unavailable/deferred.
- `customer-reference-provider`: future adapter, not implied by the base release.

**Acceptance:** An air-gapped fixture produces deterministic scores where local data exists and explicit unavailable/missing-reference states where it does not; it does not invent or LLM-fill chemical properties.

### Task 12: Implement customer-local ingestion boundary

**Objective:** Land the 0.8 three-source ingestion contract with deployment-local persistence, job state, index, and source provenance.

**Files:**
- Create migrations and typed contracts for source connections, sync runs, snapshots, records, revisions, normalization issues, index manifests, evidence associations, rights policies, and audit events.
- Create `services/worker/adapters/` provider adapter interface.
- Create ClickUp-compatible approved-export fixture adapter first.
- Create rate-limited API fixture adapter and rights-cleared literature fixture adapter.
- Create tenant-scoped lexical/semantic retrieval service.
- Create integration/security tests.

**Important constraint:** Implement exactly the data contract already specified in the 0.8 backlog. A giant downloaded text file is not the canonical record system. The flat-text index is derived and rebuildable from versioned snapshots.

**Acceptance:** In the self-hosted stack, all three synthetic source classes can pass snapshot → normalization → index → explicit reviewable analysis update, with the original analysis unchanged and all cross-tenant attempts denied.

### Task 13: Deliver installation, security, and operations artifacts

**Objective:** Make the platform installable by a competent customer administrator without implicit GC.ai operator access.

**Files:**
- Create: `docs/deployment/install.md`
- Create: `docs/deployment/upgrade.md`
- Create: `docs/deployment/uninstall-and-data-export.md`
- Create: `docs/operations/runbook.md`
- Create: `docs/security/threat-model.md`
- Create: `docs/security/network-and-secrets.md`
- Create: `deploy/scripts/install.sh`
- Create: `deploy/scripts/upgrade.sh`

**Install requirements:**
- Preflight hardware, OS, Docker, disk, DNS/TLS, private-network, time-sync, and egress checks.
- Explicit administrator inputs: domain, allowed egress sources, model mode, model endpoint/config, data-retention policy, object-store mode, backup destination, identity provider/auth mode, and optional ELN scope.
- No default external telemetry carrying protocols or raw evidence. Operational telemetry must be sanitized and opt-in/out clear.
- Secret files are generated locally with secure permissions; support references to customer secret managers but do not log values.
- Upgrade uses image digests, schema compatibility check, backup before migration, rollback conditions, and clearly states migrations that cannot be automatically reversed.

**Acceptance:** A clean-machine install guide is independently exercised in a disposable VM/customer-like VPC and results in a recorded install report.

### Task 14: CI, release candidate, and cutover procedure

**Objective:** Make deployment parity verifiable before retiring managed-runtime dependencies.

**Files:**
- Create/modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-candidate.yml`
- Create: `scripts/verify-portable-release.ts`
- Create: `docs/releases/portable-cutover.md`
- Modify: `BACKLOG.md`

**CI requirements:**
- PR/main: lint, `tsc --noEmit`, build, Python checks, unit, contract, Compose config validation, and mock Sentinel.
- Nightly/release candidate: disposable Compose installation, migrations, auth/repository tests, worker recovery, backup/restore, upgrade rehearsal, browser desktop/mobile Sentinel, chemistry sentinels, and optional real-provider model benchmark.
- Publish sanitized artifacts: fixture revision, source/image SHA, config fingerprint, schema version, benchmark model fingerprint, metrics, logs, JUnit, and browser traces.

**Cutover gates:**
1. Current production features pass in a self-hosted release candidate.
2. Backup and restore are successfully rehearsed.
3. Upgrade from prior release is rehearsed.
4. No external service is contacted in `local-snapshot-only` test mode except explicitly permitted test endpoints.
5. External provider mode and local-provider mode both fail honestly and recover appropriately.
6. Security review confirms no public database/Redis/model ports, no secrets in images/logs/artifacts, and cross-tenant tests pass.
7. Named product owner signs model selection and deployment-mode claims.

**Acceptance:** The first production migration is a reversible promotion with a known pre-cutover backup and a verified rollback path—not an in-place hopeful rewrite.

---

## 4. Hardware and serving guidance

### Baseline recommendation

- Treat **Qwen 27B** and **Gemma 31B** as candidate local interactive models.
- Treat **Qwen 128B Q4** as a premium capability tier that requires a benchmarked GPU configuration. Its feasibility cannot be inferred from parameter count alone because quantization format, context/KV-cache budget, engine, tensor parallelism, and concurrency determine whether it meets the response objective.
- A GPU model host is a separate operational unit. It must expose a private OpenAI-compatible API with health, `/v1/models`, structured-output capability test, Prometheus/host metrics where available, and an auth/TLS boundary.

### Host admission checklist

Before a model profile is supported, record:

- server OS and kernel; GPU model/count; driver/CUDA/ROCm; system RAM; VRAM; local disk; network link;
- serving engine and exact version; model source digest; tokenizer revision; quantization artifact/hash; context limit; tensor/pipeline parallel values; GPU memory utilization; prefix-cache settings;
- warm and cold Sentinel measurements; concurrent-user load measurement; OOM/restart behavior;
- whether function/tool calling or JSON-schema constrained generation is native, emulated, or unavailable.

A generic claim of “30 tokens per second” is insufficient. The support statement must say: model profile, prompt context range, output cap, concurrency, percentile, and whether it is decode/output speed or aggregate throughput.

---

## 5. Migration strategy: avoid permanent parallel technologies

1. **Introduce seams before moving state.** Provider interface, repository/auth interface, storage interface, job interface, and config contract land with behavior tests while production still runs on the managed stack.
2. **Run the canonical portable stack in CI and a non-production environment.** It is the same source/images as SaaS, not a separate fork.
3. **Dual-read only where necessary and for a bounded window.** Avoid dual-write of analyses: it creates scientific/audit divergence. Migrate a scrubbed copy for rehearsal, then cut over once.
4. **Move one durable concern at a time:** app image/config → local service wiring → auth/data repository → object storage → worker/scheduler → ingestion → production cutover.
5. **Retire infrastructure only after parity evidence.** Vercel, Supabase Cloud, and Cloud Run remain explicitly legacy until the release gate completes; they are not operated as a permanent second platform.

---

## 6. Risks and decisions requiring owner confirmation

- **Auth choice:** self-hosted Supabase versus direct Postgres + chosen OIDC/auth service. The spike must compare operational burden, license/support, migration effort, MFA/OIDC requirements, and ability to preserve current auth/RLS behavior.
- **Model quality:** a fast local model may fail the chemistry-specific rubric. The architecture must permit external Anthropic/OpenRouter mode without a code fork.
- **True air-gap:** local model compute does not solve PubChem, literature, identity-provider, DNS/TLS, backup, or update dependencies. Customer egress policy must decide each one.
- **Customer GPU support:** GC.ai should define supported profiles rather than become responsible for arbitrary lab workstation drivers.
- **Retained source material:** rights/retention and customer data policies determine whether raw snapshots/attachments may be locally stored, embedded, or sent to a model.
- **Postgres operations:** the supported pilot uses one node and tested restore. HA/failover is a separately priced/designated enterprise deployment requirement.

---

## 7. Final definition of done

The portability push is complete only when all are true:

- A clean customer-controlled installation brings up web/API, chemistry, Postgres/pgvector, auth, object storage, worker/scheduler, ingress, and monitoring with one documented configuration profile.
- It performs saved analysis, deterministic scoring, result review, provenance display, approved ingest fixture retrieval, and mobile/desktop Sentinel paths without Vercel, Supabase Cloud, Cloud Run, AWS, or Google Cloud Run runtime dependence.
- Model mode is explicit: external, customer-hosted endpoint, local-model, or disabled; no configuration falsely claims data locality.
- Anthropic, Qwen 27B, Gemma 31B, and Qwen 128B Q4 have comparable, reproducible Sentinel reports; the default local profile is selected from measured safety/quality/latency results, not assumption.
- Restores, upgrades, worker recovery, model/provider outage, reference-data outage, source outage, and auth/tenant-isolation failures are tested and produce accurate recoverable states.
- The actual deployment release is backed by sanitized CI/Sentinel artifacts, image and schema digests, model benchmark manifest, verified backup/restore, and named product-owner sign-off.
