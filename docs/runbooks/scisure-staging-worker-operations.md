# SciSure staging worker operations

## Boundaries

- Web: `https://staging.greenchemistry.ai`, Vercel project `greenchemistryai`, branch `main`.
- Database: Supabase `qqyzyezwlzvckjtggoes`. The root checkout's CLI link is production; never use an implicitly targeted migration push.
- Worker: `gcai-scisure-worker`, GCP project `greenchemistry-ai`, region `us-central1`.
- Runtime: `gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com`.
- Chemistry service: `gcai-chemistry`, with `staging-chemistry-service-token` from Secret Manager.
- Scheduler: `gcai-scisure-worker-1m`, once per minute, UTC, dedicated `gcai-scisure-scheduler@greenchemistry-ai.iam.gserviceaccount.com` identity.

The scheduler POSTs to `https://run.googleapis.com/v2/projects/greenchemistry-ai/locations/us-central1/jobs/gcai-scisure-worker:run` with OAuth/cloud-platform scope. Its identity has `roles/run.invoker` on this Job only. The Cloud Scheduler service agent can mint its tokens through a service-account-scoped `roles/iam.serviceAccountTokenCreator` binding. Scheduler retries are disabled. Each execution leases at most one already admitted job; lease fencing, quota audit and uncertain-result rules remain unchanged. Multiple executions may overlap; they do not intentionally retry uncertain chemistry work.

Cloud Scheduler and Cloud Run executions incur cloud usage charges even when the queue is empty. Container startup may add several minutes to the cadence; once-per-minute triggering is not a one-minute analysis-completion guarantee.

## Protected Vercel probes

The domain is correctly verified and branch-tracked. A raw request returns a 302 to Vercel SSO because Deployment Protection is enabled. Use the existing authorized automation secret as the `x-vercel-protection-bypass` header, never a URL parameter or committed value. Do not follow redirects and treat Vercel login HTML as application evidence. Verify an application-specific landmark and the deployment's Git SHA.

Vercel Cron does not run preview deployments. The staging worker is therefore scheduled by Google Cloud Scheduler, not `vercel.json`. The operational sentinel's existing Vercel cron is unaffected.

## Registered entitlement parity

`lib/analysis-entitlements.ts` preserves the existing web-analysis account policy. SciSure derives that policy only from the verified Supabase Auth owner of the registered integration principal. A NULL limit on the service-only reservation RPC represents uncapped admission; audit ledger, ownership and idempotency still apply. Imported actor identity and consent/delivery email do not grant entitlement. Normal registered accounts and guests remain capped. No usage history is deleted or reset.

The isolated `tests/sql/scisure-unlimited-admission.sql` acceptance fixture tests the deployed schema-qualified reservation function above the normal quota, checks replay/audit preservation and proves anon/authenticated cannot invoke it directly.

## Controls and rollback

On this Mac, use `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11` for gcloud. Every command must explicitly select project and region.

Pause or resume automatic processing without touching production:

```bash
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11 gcloud --project greenchemistry-ai scheduler jobs pause gcai-scisure-worker-1m --location us-central1
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11 gcloud --project greenchemistry-ai scheduler jobs resume gcai-scisure-worker-1m --location us-central1
```

Inspect or force one scheduler invocation:

```bash
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11 gcloud --project greenchemistry-ai scheduler jobs describe gcai-scisure-worker-1m --location us-central1
CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.11 gcloud --project greenchemistry-ai scheduler jobs run gcai-scisure-worker-1m --location us-central1
```

Use `--update-env-vars` for a narrow configuration repair. `--set-env-vars` replaces all plain env vars and previously removed the worker's explicit model routing. Full deployments deliberately specify every required plain variable and Secret Manager binding in `scripts/deploy-scisure-worker-staging.sh`.

## Verification evidence

The repaired runtime was read back with chemistry bindings and model-routing metadata intact. Direct execution `gcai-scisure-worker-8zc5k` completed. Cloud Scheduler returned HTTP 200 and independently launched executions including `gcai-scisure-worker-hnrfr`, which completed with structured `worker: scisure, status: idle` output. This establishes unattended trigger, container startup and database lease access; it is not a fresh successful scientific analysis or SciSure writeback proof.

Local validation: 429 Vitest tests, four isolated PostgreSQL acceptance fixtures, build and typecheck passed. Lint returned zero errors with existing warnings. Dependency install reported audit findings; no dependency upgrades were included in this scope.

Production branch, aliases, chemistry release and database were not promoted or migrated. DNS was not changed.
