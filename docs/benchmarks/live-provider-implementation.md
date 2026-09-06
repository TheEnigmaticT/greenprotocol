# Live-capable provider implementation — NOT APPROVED

Operational switch remains immutable `LIVE_APPROVAL.approved = false`. No inference calls, corpus reads, credential-file reads, installs, commits, pushes or approval artifacts were made. Only unauthenticated public catalog GETs were performed. This is an implementation handoff, not a review PASS.

## Interface

- `createProvider({ approvalToken, mission })`: actual native fetch construction after release gates; no root, budget, fetch, or approval override.
- `Mission = { id, sourceEvidence: string[], contractHash, roleModels: Record<string,string> }`.
- Request `evidence = { sourceHash, contractHash, role }` is required for mission-bound execution.
- Request `providerSlug` is mandatory live: currently exact `deepinfra/turbo` or `coreweave/fp4`. Sent via `provider.only`; returned provider name must match the verified name. Returned vendor name is not proof of a particular quantization, so the selected endpoint slug is also persisted.
- `maxPromptTokens` must equal full verified model context, 262144. Reservation uses full context plus completion cap, not a byte/token estimate. API body uses catalog-supported `max_tokens`; request interface remains `maxCompletionTokens`.
- Tests retain explicit synthetic transport injection, test-environment checks and no default fetch; both constructors share one execution core.

## Review gate

Independent review must cover the new provider, stages, discovery and reporting. `REVIEW_INPUTS` specifies required source/review paths. After those reviews and user authorization, a separate release change may enable the immutable switch and publish fixed `docs/benchmarks/live-provider-approval.json` with `{ approved:true, tokenHash:<sha256>, inputHashes:{<every required path>:<sha256>} }`. No such file or approval is created here. Separate manifest avoids circular provider-source hashes. Token and every current input hash are checked at construction and each execution; mismatch or missing inputs fail closed. `verifyApprovalManifest` is a pure validation helper and cannot enable the provider.

Reviewers must extend input pins to all newly integrated helper/reporting modules and confirm review verdict/order/provenance before activation; matching file hashes alone do not authenticate human approval. The immutable OFF source switch remains the current operational boundary.

## Ledger and telemetry

Fixed `tmp/local-qualification/attempts` separates ledger scanning from the corpus directory. Existing ledger is never reset; an older root-level ledger or lock blocks migration for explicit reconciliation. First provisioning uses the authorized NEW sprint zero baseline, not historical benchmark spend; cumulative cap remains $100. Reopening preserves prior spend, and mission mismatch blocks execution rather than silently changing header.

Mission source hashes/contract/role-model assignment persist in header. Reservations persist evidence, exact requested model and provider slug, configured price ceilings, token bounds and no-fallback transport configuration. Outcomes record requested/returned model, provider, available prompt/completion/total tokens, latency, HTTP status, actual rounded micro-USD cost and safe error code. Unknown values remain null. Raw provider bytes remain bounded and private (0700 directories/0600 files). Serial fsynced reservation, full-body deadline, no implicit retries, uncertain-remote stop and crash-lock protections remain in shared core.

## Public discovery

Verified `https://openrouter.ai/api/v1/models` and `https://openrouter.ai/api/v1/models/google/gemma-4-31b-it/endpoints` (2026-09-05). Exact model only `google/gemma-4-31b-it`; Qwen absent pending separate discovery/review. Model context 262144; model catalog advertises tools and structured outputs. Endpoint-specific support differs: DeepInfra `deepinfra/turbo` supports structured output but its endpoint list omits tools; `coreweave/fp4` lists tools/tool_choice and structured outputs. Therefore turbo tool requests fail closed. Observed endpoint pricing was .09/.34 and .10/.34 USD per million prompt/completion tokens respectively, not hardcoded universal pricing. Runtime accepts explicit max-price ceilings, using official provider-selection units (prompt/completion per million; request per request).

## Verification

TDD: first six new tests failed before implementation; two additional pin/provider tests failed before implementation; changing expected wire field to `max_tokens` failed before implementation. Synthetic tests cover immutable OFF/no network, stale/missing pins, exact token, fixed ledger path, mission persistence/mismatch, context bound, exact endpoint selection/provider mismatch, success/error telemetry, and existing ledger/deadline/retry regressions.

Project-wide TypeScript check encountered concurrent extraction/principle worker missing-export/module errors, not provider/manifests diagnostics. Required dev-protocol absolute path was unavailable; repository CLAUDE.md and lessons.md were read. Branch fetch confirmed HEAD equals origin/main; unrelated shared dirty files were untouched.

Parent recovery: reproduced final worker RED completion-limit regression (57 passed / 1 failed), then enforced a conservative common 16384 completion ceiling for the only approved model across both pinned endpoints. This is the DeepInfra turbo ceiling, not a claim all endpoints share that advertised maximum. CoreWeave may advertise higher capacity, which this mission does not use. Follow-up persistent checks explicitly reject 16385 before fetch on both pins and accept 16384 with matched returned provider names. Final provider suites: 2 files / 60 tests passed. Independent SPEC re-review remains required; immutable live switch stays OFF.
