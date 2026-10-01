# SciSure bridge local acceptance

## Production safety

`gcaiBridge.enabled` remains `false` in the add-on default configuration. Do not change that gate or deploy this migration from this worktree. The bridge uses server-owned tables with RLS and no browser policies; it does not enable Supabase Anonymous Auth.

## Local-only configuration

Use an isolated local Supabase project, never the production project.

```bash
SCISURE_ALLOWED_ORIGINS=https://sandbox.scisure.test
NEXT_PUBLIC_SCISURE_ALLOWED_ORIGINS=https://sandbox.scisure.test
SUPABASE_SERVICE_ROLE_KEY=...                 # server only
SCISURE_NONCE_HASH_KEY=<32+ random bytes>     # server only; missing value fails closed
ANALYSIS_RUN_LIMIT=10
```

Apply `supabase/migrations/20261001000000_create_scisure_bridge.sql` only to that local project. The migration supplies a real `UNIQUE(user_id)` constraint for registered principals, transaction/advisory-lock quota reservation and idempotent job creation, a skip-locked lease function, durable result/error state, and `gpc_purge_expired_scisure_lineage()` which removes linked raw traces/dedup logs before expiring bridge jobs.

Run the worker and cleanup with server-only credentials:

```bash
npm run scisure:worker
npm run scisure:purge
```

A worker leases one job and records either `completed` with a persisted result, or `uncertain` with an error code if execution may have reached the provider. It never leaves a claimed job queued. Registered jobs also create `gpc_analyses` and `gpc_analysis_runs`; guest jobs retain only their isolated bridge result and receive no general Auth role/capabilities.

## Guest admission

Production guest issuance remains fail-closed until an accessible abuse gate is configured and server-verified. A browser identity, body origin, email string, or cookie reset is not allowance. The current token verifier only accepts a short-lived signed issuer token and stores its hash as a durable guest principal. Email events remain `pending_configuration`; delivery is not claimed without a configured transport.

## Browser contract and local fixture

The add-on contract is `loaded → hello → ready → admission → result`, bound to the popup opener/window and configured SciSure origin. The bridge never trusts an origin supplied in the admission body; the receiver uses the observed opener origin for connection authorization. Secrets and credentials are not stored in add-on configuration, local storage, or messages.

Run the isolated Chromium fixture (mocked SciSure SDK/API and mock GCai bridge only; it is not live tenant or chemistry evidence):

```bash
(cd integrations/scisure-addon && npm run test:browser)
```

Run unit/type checks:

```bash
npm test -- --run tests/lib/scisure-contracts.test.ts tests/lib/scisure-jobs.test.ts tests/lib/scisure-worker.test.ts tests/lib/scisure-prompt-boundary.test.ts
npx tsc --noEmit
(cd integrations/scisure-addon && npm test && npm run check)
```

## Browser evidence (October 1, 2026)

- `npm run check`, `npm test`, and `npm run test:browser` in `integrations/scisure-addon` passed: **29 add-on tests**, strict JavaScript parse, and an isolated headless Chromium fixture with no page errors. The fixture now rejects a queued `gcai.scisure.result`, keeps its channel alive, and requires terminal result provenance (`sourceHash`, `runId`, and `revisionNumber`) before exposing an approved alternative.
- `npm test -- --run tests/lib/auth-return.test.ts tests/lib/scisure-review-route.test.ts tests/lib/scisure-contracts.test.ts` passed: **9 tests**. The review route test covers same-origin enforcement, connection-principal ownership, source-hash/revision binding, and only server-eligible recommendations.
- A separate headless Playwright instance opened the actual local Next page at `http://127.0.0.1:3100/integrations/scisure/connect`; screenshots: `docs/runbooks/scisure-connect-live-local.png` (direct navigation) and `docs/runbooks/scisure-connect-opener-local.png` (isolated SciSure opener → actual Next connector → actual connection route). The opener test correctly reached the server-owned route and failed closed with `SciSure integration is not configured` because no local service-role/Supabase configuration was supplied; neither screenshot exposes a credential.
- Parent verification after the final contract fixes: `npm test` passed **55 files / 389 tests**; `npx tsc --noEmit` and `npm run build` passed. The add-on passed **29 tests**, syntax and mocked Chromium smoke.
- `NEXT_PUBLIC_SCISURE_ALLOWED_ORIGINS=https://sandbox.scisure.test npx playwright test tests/scisure-connect.spec.ts --project=chromium` passed against the actual Next receiver page: queued polling, real-shaped eligible proposal, explicit approval, and non-empty accepted return. **API responses are intercepted fixtures**; this is UI/message-contract evidence, not a live database/provider round trip. Screenshot: `test-results/scisure-connect-reviewed-return.png`.
- `python3 scripts/test-scisure-sql.py` passed the actual migration and expanded acceptance assertions in a disposable Homebrew PostgreSQL 17 cluster. It strips inherited PG connection variables, listens only on a private scratch Unix socket, and stops/removes its cluster. SQL acceptance covers shared quota/idempotency, cross-principal source rejection, stale execution becoming uncertain, service-only RPC grants, raw snapshot purge and run-linked trace/dedup purge, and preservation of unrelated canonical-scoring snapshots.
- The signed-in Next → Supabase/PostgREST → worker → actual chemistry provider → review → SciSure round trip is **still unverified as one connected flow**. Schema/worker/route unit tests, real SQL acceptance and browser UI fixtures are separate evidence. No production database or migration was touched.

## Remaining release work

Configure a nonproduction Supabase/PostgREST environment and worker with isolated test credentials, then execute the connected registered-user journey and real SciSure sandbox acceptance. The migration is now SQL-tested without Docker, but must still be validated against the complete application schema and existing data on staging. Review the narrow shared `/api/analyze` quota change before rollout.

Guest admission remains unavailable in the popup until a real verified issuer/accessible abuse gate and recovery/account-claim flow are implemented. A signed token verifier alone is not guest issuance. Email events are durable but no service-backed mail transport is configured. The partnership/contact page is not implemented in this change. Production scheduling for worker/cleanup, exact sandbox origin configuration, integration credentials and approved release remain prerequisites. Keep bridge enabled=false until those gates are satisfied.
