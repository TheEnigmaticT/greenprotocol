# Qwen application staging preparation

## Scope and release boundary

The isolated `feat/qwen-staging-app` worktree combines `origin/main` at `a0f98dfc80b44ed125cde2c11f7e75823c04b865` (including UX PR #8 and release protections) with the engine checkpoint and cleanup at `fe7a36126165d88cd37c494058731146748f5ac5`.

The user authorized committing, pushing and merging the reviewed integration into main for a staging-only trial. Authorization does not cover production. Never push or merge to `production`, invoke a production deployment, or modify production/shared environment values for this trial. A prepared branch is not a verified deployment.

## Application privacy fix

`app/api/analyze/route.ts` skips Anthropic token counting before SDK construction when `GCAI_ENGINE_CANDIDATE=1`. The audit token count remains `null`; existing non-candidate behavior is unchanged. Candidate authentication/rate-limit errors refer to the selected model rather than directing users to configure Claude. The regression exercises the actual API handler with legacy Anthropic credentials present, but mocks external services and does not save a real analysis.

The Python runtime reconciliation retains both explicit candidate routing and the newer main branch's legacy OpenRouter routing. The original candidate checkout and the separate UX worktree are preserved.

## Talk About This configuration

The existing chat provider supports the selected model without a code change. These Vercel project overrides were created for **preview / git branch `main` only**:

| Variable | Value or binding |
| --- | --- |
| `CHAT_LLM_BASE_URL` | `https://openrouter.ai/api/v1` |
| `CHAT_LLM_MODEL` | `qwen/qwen3.8-27b` |
| `CHAT_LLM_ALLOWED_BASE_URLS` | `https://openrouter.ai/api/v1` |
| `CHAT_LLM_ALLOWED_MODELS` | `qwen/qwen3.8-27b` |
| `CHAT_LLM_API_KEY` | Sensitive value sourced from the existing `staging-greenchemistry-openrouter-api-key` managed secret; never recorded in source or artifacts |

The four routing values were read back individually and matched exactly. The sensitive key's target, branch and type were read back. Existing production/shared environment objects were compared before and after and were unchanged. These overrides do not update an already-running Vercel deployment; activation requires a new staging deployment.

An actual call through `createConfiguredChatProvider()` with the staging key and those settings verified streamed text, one native function call, and a follow-up response using a locally generated verification marker. This was a transport test, not a signed-in chat, chemistry-data lookup, or application persistence test. OpenRouter privacy settings (`data_collection: deny`, `zdr: true`, `allow_fallbacks: false`) were preserved. Hosted Qwen is not local inference.

## Verified staging separation

Google Cloud reauthentication succeeded. The staging service is `gcai-chemistry` at `https://gcai-chemistry-4cisnamb5a-uc.a.run.app`, using `gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com` and staging-prefixed secret bindings. Its Supabase host is `qqyzyezwlzvckjtggoes.supabase.co`, distinct from the known production project.

At this inspection, staging chemistry still runs revision `gcai-chemistry-00002-qk9`, with legacy `OPENROUTER_MODEL=anthropic/claude-sonnet-4.5`. It has **not** been updated to the candidate. The verified hostname `https://staging.greenchemistry.ai` follows main and redirects unauthenticated requests to Vercel sign-in.

Production baseline: Git `6e90ec991005004ce908b06e7e51e37c8fe0de46`, Vercel deployment `dpl_5ufPcTmoGbJmP9Sn9R42maixqMMU`, chemistry revision `greenchemistry-chemistry-00009-9ld` with 100% traffic. No production deployment or configuration change was made.

## Validation and remaining activation gates

The staging database was linked explicitly to `qqyzyezwlzvckjtggoes`. Eight existing pending migrations were reviewed and applied in order; all 16 migration versions now match the staging migration history. These add chat receipts/tool diagnostics, canonical chemical/scoring caches and operational-alert records and tighten their access controls. No production database was linked or modified.

The analysis runtime also has main-branch preview overrides for `GCAI_ENGINE_CANDIDATE=1`, `GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1`, `GCAI_LLM_MODEL=qwen/qwen3.8-27b`, and a sensitive `GCAI_LLM_API_KEY` sourced from the staging OpenRouter secret. Literature embedding configuration remains absent intentionally and fails closed.

After exact-SHA CI passes on main, explicitly dispatch `.github/workflows/deploy-staging.yml` on main. It independently requires a successful CI push/main run for that SHA before authenticating to the staging identity, builds/resolves the immutable image, deploys with `STAGING_ENGINE_CANDIDATE=1`, and reads back staging-only credentials, runtime identity and exact model routing before its authenticated sentinel. It does not deploy production or qualify the signed-in web journey by itself.

Local combined-source checks passed: web tests, Python tests, TypeScript, full ESLint, and Next.js build. The generated solvent index was rebuilt from committed raw data. The previously reported baseline UI lint errors are already fixed on current main; no lint suppression was added here. Dependency audit still reports 17 vulnerabilities, including 11 high and 1 critical; these have not been triaged or automatically upgraded.

Before calling the combined application trial live:

1. Preserve the existing production gates and merge the latest main fixes into the tested integration before the authorized main-only PR merge.
2. Configure candidate mode and the approved Qwen endpoint/model explicitly on **both** the staging web runtime and the candidate chemistry deployment. Chat configuration alone does not select the analysis model. Preserve stage-only credentials and service identity.
3. Build/deploy the exact candidate chemistry artifact through the approved staging path and verify its source identity, runtime routing, health and authenticated service behavior. Do not deploy the old chemistry revision with a new web build and call that candidate qualification.
4. Deploy the exact main commit to the staging hostname and confirm its SHA and effective chat/analysis configuration.
5. Exercise a signed-in analysis, save/reload, Talk About This including a real chemistry tool, and rescore. Direct-provider and unit-test results do not establish these journeys.
6. Keep literature explicitly unavailable until a separately approved embedding model matches the selected index. Do not enable the legacy OpenAI embedding default merely to make research requests succeed.
7. Read back production Git, Vercel and chemistry identifiers and confirm they are unchanged.
