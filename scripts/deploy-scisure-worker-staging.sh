#!/usr/bin/env bash
# Create/update only the staging SciSure worker Cloud Run Job; never schedule it.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ "${DEPLOY_ENV:-}" == "staging" ]] || fail 'DEPLOY_ENV=staging is required.'
[[ "${GCP_PROJECT_ID:-}" == "greenchemistry-ai" ]] || fail 'GCP_PROJECT_ID must be the staging project greenchemistry-ai.'
[[ "${SCISURE_WORKER_IMAGE:-}" =~ @sha256:[a-f0-9]{64}$ ]] || fail 'SCISURE_WORKER_IMAGE must be an immutable @sha256 image digest.'
[[ "${GIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'GIT_SHA must be an exact 40-character commit SHA.'
[[ "${CONFIRM_STAGING_WORKER_DEPLOY:-}" == "yes" ]] || fail 'Set CONFIRM_STAGING_WORKER_DEPLOY=yes to mutate staging.'

REGION="${REGION:-us-central1}"
JOB="${SCISURE_STAGING_JOB:-gcai-scisure-worker}"
RUNTIME_SA="${SCISURE_STAGING_RUNTIME_SERVICE_ACCOUNT:-gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com}"
SUPABASE_URL_SECRET="${SCISURE_STAGING_SUPABASE_URL_SECRET:-staging-supabase-url}"
SUPABASE_ROLE_SECRET="${SCISURE_STAGING_SUPABASE_SERVICE_ROLE_SECRET:-staging-supabase-service-role-key}"
NONCE_SECRET="${SCISURE_STAGING_NONCE_SECRET:-staging-scisure-nonce-hash-key}"
ORIGIN_SECRET="${SCISURE_STAGING_ORIGINS_SECRET:-staging-scisure-allowed-origins}"

gcloud run jobs deploy "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" --image "$SCISURE_WORKER_IMAGE" \
  --service-account "$RUNTIME_SA" --tasks 1 --max-retries 0 --task-timeout 20m \
  --set-env-vars "GIT_SHA=$GIT_SHA,DEPLOY_ENV=staging" \
  --set-secrets "SUPABASE_URL=${SUPABASE_URL_SECRET}:latest,SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_ROLE_SECRET}:latest,SCISURE_NONCE_HASH_KEY=${NONCE_SECRET}:latest,SCISURE_ALLOWED_ORIGINS=${ORIGIN_SECRET}:latest" \
  --command npx --args tsx,scripts/run-scisure-worker.ts \
  --labels "deploy-env=staging,release-sha=$GIT_SHA,worker=scisure"

gcloud run jobs describe "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" \
  --format='json(metadata.name,spec.template.metadata.labels,spec.template.spec.serviceAccountName,spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
