#!/usr/bin/env bash
# Create/update only the staging SciSure worker Cloud Run Job; never schedule it.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ "${DEPLOY_ENV:-}" == "staging" ]] || fail 'DEPLOY_ENV=staging is required.'
[[ "${GCP_PROJECT_ID:-}" == "greenchemistry-ai" ]] || fail 'GCP_PROJECT_ID must be the staging project greenchemistry-ai.'
[[ "${SCISURE_WORKER_IMAGE:-}" =~ ^us-central1-docker\.pkg\.dev/greenchemistry-ai/greenchemistry/gcai-scisure-worker:[0-9a-f]{40}@sha256:[a-f0-9]{64}$ ]] || fail 'SCISURE_WORKER_IMAGE must be the staging worker SHA tag plus immutable digest.'
[[ "${GIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'GIT_SHA must be an exact 40-character commit SHA.'
[[ "${CONFIRM_STAGING_WORKER_DEPLOY:-}" == "yes" ]] || fail 'Set CONFIRM_STAGING_WORKER_DEPLOY=yes to mutate staging.'

REGION="${REGION:-us-central1}"
JOB="${SCISURE_STAGING_JOB:-gcai-scisure-worker}"
RUNTIME_SA="${SCISURE_STAGING_RUNTIME_SERVICE_ACCOUNT:-gcai-staging-runtime@greenchemistry-ai.iam.gserviceaccount.com}"
SUPABASE_URL_SECRET="${SCISURE_STAGING_SUPABASE_URL_SECRET:-staging-supabase-url}"
SUPABASE_ROLE_SECRET="${SCISURE_STAGING_SUPABASE_SERVICE_ROLE_SECRET:-staging-supabase-service-role-key}"
NONCE_SECRET="${SCISURE_STAGING_NONCE_SECRET:-staging-scisure-nonce-hash-key}"
PROVIDER_SECRET="${SCISURE_STAGING_OPENROUTER_API_KEY_SECRET:-staging-greenchemistry-openrouter-api-key}"
CHEMISTRY_TOKEN_SECRET="staging-chemistry-service-token"
CHEMISTRY_URL="$(gcloud run services describe gcai-chemistry --project "$GCP_PROJECT_ID" --region "$REGION" --format='value(status.url)')"
[[ "$CHEMISTRY_URL" == https://gcai-chemistry-*.a.run.app ]] || fail 'Staging chemistry service URL is unavailable or unexpected.'
MODEL="${SCISURE_STAGING_OPENROUTER_MODEL:-qwen/qwen3.8-27b}"
[[ "$MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ ]] || fail 'SCISURE_STAGING_OPENROUTER_MODEL must be a provider/model identifier.'

# Validate only staging resource names; secret values never enter this script or logs.
for secret in "$SUPABASE_URL_SECRET" "$SUPABASE_ROLE_SECRET" "$NONCE_SECRET" "$PROVIDER_SECRET" "$CHEMISTRY_TOKEN_SECRET"; do
  gcloud secrets describe "$secret" --project "$GCP_PROJECT_ID" >/dev/null || fail "Required staging secret is unavailable: $secret"
done
gcloud iam service-accounts describe "$RUNTIME_SA" --project "$GCP_PROJECT_ID" >/dev/null || fail 'Staging runtime service account is unavailable.'

gcloud run jobs deploy "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" --image "$SCISURE_WORKER_IMAGE" \
  --service-account "$RUNTIME_SA" --tasks 1 --max-retries 0 --task-timeout 20m --cpu 1 --memory 2Gi \
  --set-env-vars "GIT_SHA=$GIT_SHA,DEPLOY_ENV=staging,GCAI_ENGINE_CANDIDATE=1,GCAI_LLM_BASE_URL=https://openrouter.ai/api/v1,GCAI_LLM_MODEL=$MODEL,CHEMISTRY_SERVICE_URL=$CHEMISTRY_URL" \
  --set-secrets "NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL_SECRET}:latest,SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_ROLE_SECRET}:latest,SCISURE_NONCE_HASH_KEY=${NONCE_SECRET}:latest,OPENROUTER_API_KEY=${PROVIDER_SECRET}:latest,CHEMISTRY_SERVICE_TOKEN=${CHEMISTRY_TOKEN_SECRET}:latest" \
  --command npx --args tsx,scripts/run-scisure-worker.ts \
  --labels "deploy-env=staging,release-sha=$GIT_SHA,worker=scisure"

gcloud run jobs describe "$JOB" --project "$GCP_PROJECT_ID" --region "$REGION" \
  --format='json(metadata.name,spec.template.metadata.labels,spec.template.spec.serviceAccountName,spec.template.spec.template.spec.containers[0].image,spec.template.spec.template.spec.containers[0].env)'
