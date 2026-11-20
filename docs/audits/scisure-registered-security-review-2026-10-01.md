# SciSure registered integration security review — 2026-10-01

## Decision
**Not ready to call released.** Local security and schema acceptance is green; staging database application and an executable worker image remain blocked by separate credentials/artifact provenance.

## Findings fixed

1. **Review decision TOCTOU:** the route previously read job/source/revision/eligibility and later upserted. `gpc_record_scisure_review_decision` now locks the completed job and persisted analysis, verifies principal ownership, source hash, exact revision, selected source step mapping, swap type, and evidence eligibility, then writes in the same transaction. The HTTP route derives reviewer identity only from the authenticated session and calls this service-role-only RPC.
2. **Registered quota reset after 90-day raw deletion:** `gpc_registered_analysis_quota_ledger` retains only a SHA-256 user scope hash and opaque admission key. It records historical analysis/run admissions, normal reservations, and registered SciSure reservations; failed admissions release capacity while completed/uncertain admissions remain countable after raw job/analysis deletion.
3. **Admission race:** both registered ordinary and registered SciSure reservations use the same advisory-lock scope and count the durable ledger, replacing read-count-write admission.
4. **Prompt injection boundary:** assembly instructions are fixed system text. Protocol/step/recommendation payload is serialized as untrusted user data.
5. **Return redirect:** login and callback use a same-origin path-only return target helper.

## Verification performed

- RED then GREEN: prompt boundary and auth-return unit tests.
- `npm test -- --run tests/lib/scisure-review-route.test.ts tests/lib/scisure-prompt-boundary.test.ts tests/lib/analyze-route-token-count.test.ts tests/lib/scisure-worker.test.ts tests/lib/scisure-real-result-flow.test.ts` — 9 tests passed.
- Fresh isolated PostgreSQL 17 cluster under `.hermes/cache/scratch`, `LC_ALL=C`, no inherited `PG*`: registered decision/quota SQL acceptance passed.
- `npx tsc --noEmit` completed after the focused Vitest run.
- Staging Cloud Run readback: `gcai-chemistry`, 100% on revision `gcai-chemistry-00012-wll`, staging runtime identity `gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com`, staging-only Supabase/token/provider secret binding names.

## Remaining release gates

- Apply and read back migration `20261001030000_harden_scisure_registered_admission_and_review.sql` on project ref `qqyzyezwlzvckjtggoes` only.
- Supply a staging-built immutable Node/app image digest for the worker. The existing `gcai-chemistry` image is the Python chemistry service and is not asserted to contain `npx tsx scripts/run-scisure-worker.ts`.
- Validate the staging release identity has Cloud Run Job and Secret Accessor authorization before any job deploy; no scheduler was created.
- Do not merge PR45 until the independent changes are consolidated and the staging-connected SQL/readback test succeeds.
