#!/usr/bin/env bash
# Build and deploy a release-identified chemistry service. This script never
# creates cloud resources and never defaults to production.
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

DEPLOY_ENV="${DEPLOY_ENV:-}"
[[ -n "$DEPLOY_ENV" ]] || fail "DEPLOY_ENV is required (staging or production)."
[[ "$DEPLOY_ENV" == "staging" || "$DEPLOY_ENV" == "production" ]] || fail "DEPLOY_ENV must be staging or production."

GIT_SHA="${GIT_SHA:-}"
[[ -n "$GIT_SHA" ]] || fail "GIT_SHA is required."
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_SHA must be a full 40-character commit SHA."
HEAD_SHA="$(git rev-parse HEAD)"
[[ "$GIT_SHA" == "$HEAD_SHA" ]] || fail "GIT_SHA does not match checked-out HEAD ($HEAD_SHA)."

# Production needs the protected workflow identity. BREAK_GLASS is deliberately
# explicit so an incident command cannot look like an ordinary release.
if [[ "$DEPLOY_ENV" == "production" && "${BREAK_GLASS:-}" != "1" ]]; then
  [[ "${GITHUB_ACTIONS:-}" == "true" && "${RELEASE_AUTHORITY:-}" == "approved-production-release" ]] || \
    fail "Production deploy requires the approved release workflow or BREAK_GLASS=1."
fi

GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail "gcloud is required."
REGION="${REGION:-us-central1}"
SOURCE_DIR="${SOURCE_DIR:-services/chemistry}"
[[ -d "$SOURCE_DIR" ]] || fail "Chemistry source directory does not exist: $SOURCE_DIR"

case "$DEPLOY_ENV" in
  staging)
    PROJECT_ID="${STAGING_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${STAGING_CHEMISTRY_SERVICE:-gcai-chemistry}"
    RUNTIME_SERVICE_ACCOUNT="${STAGING_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-gcai-staging-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
    MIN_INSTANCES="${STAGING_MIN_INSTANCES:-0}"
    # The image registry is shared solely to preserve a single immutable digest
    # between staging verification and production promotion.
    REPOSITORY="${STAGING_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
    TOKEN_SECRET="${STAGING_CHEMISTRY_TOKEN_SECRET:-staging-chemistry-service-token}"
    SUPABASE_URL_SECRET="${STAGING_SUPABASE_URL_SECRET:-staging-supabase-url}"
    SUPABASE_SERVICE_ROLE_SECRET="${STAGING_SUPABASE_SERVICE_ROLE_SECRET:-staging-supabase-service-role-key}"
    PROVIDER_KEY_SECRET="${STAGING_OPENROUTER_API_KEY_SECRET:-staging-greenchemistry-openrouter-api-key}"
    PROVIDER_MODEL="${STAGING_OPENROUTER_MODEL:-anthropic/claude-sonnet-4.5}"
    ;;
  production)
    PROJECT_ID="${PRODUCTION_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${PRODUCTION_CHEMISTRY_SERVICE:-greenchemistry-chemistry}"
    RUNTIME_SERVICE_ACCOUNT="${PRODUCTION_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-greenchemistry-chemservice@${PROJECT_ID}.iam.gserviceaccount.com}"
    MIN_INSTANCES="${PRODUCTION_MIN_INSTANCES:-1}"
    REPOSITORY="${PRODUCTION_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
    TOKEN_SECRET="${PRODUCTION_CHEMISTRY_TOKEN_SECRET:-chemistry-service-token}"
    SUPABASE_URL_SECRET="${PRODUCTION_SUPABASE_URL_SECRET:-supabase-url}"
    SUPABASE_SERVICE_ROLE_SECRET="${PRODUCTION_SUPABASE_SERVICE_ROLE_SECRET:-supabase-service-role-key}"
    PROVIDER_KEY_SECRET="${PRODUCTION_OPENROUTER_API_KEY_SECRET:-greenchemistry-openrouter-api-key}"
    PROVIDER_MODEL="${PRODUCTION_OPENROUTER_MODEL:-anthropic/claude-sonnet-4.5}"
    ;;
esac

for required in TOKEN_SECRET SUPABASE_URL_SECRET SUPABASE_SERVICE_ROLE_SECRET PROVIDER_KEY_SECRET PROVIDER_MODEL; do
  [[ -n "${!required}" ]] || fail "$required must be configured for $DEPLOY_ENV; refusing to infer credentials or routing."
done

# Deployment never builds an image. Staging must establish an immutable candidate
# first; production may only promote that exact digest after a reviewed release PR.
IMAGE_DIGEST="${IMAGE_DIGEST:-}"
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || \
  fail "IMAGE_DIGEST is required and must be an immutable sha256 digest."
# The image name is intentionally independent from the runtime service name so
# staging and production deploy the same immutable artifact digest.
CHEMISTRY_IMAGE_NAME="${CHEMISTRY_IMAGE_NAME:-greenchemistry-chemistry}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${CHEMISTRY_IMAGE_NAME}:${GIT_SHA}"

"$GCLOUD" run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --image "${IMAGE}@${IMAGE_DIGEST}" \
  --service-account "$RUNTIME_SERVICE_ACCOUNT" \
  --labels "release-sha=${GIT_SHA},deploy-env=${DEPLOY_ENV}" \
  --set-secrets "CHEMISTRY_SERVICE_TOKEN=${TOKEN_SECRET}:latest,SUPABASE_URL=${SUPABASE_URL_SECRET}:latest,SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_SECRET}:latest,OPENROUTER_API_KEY=${PROVIDER_KEY_SECRET}:latest" \
  --set-env-vars "OPENROUTER_MODEL=${PROVIDER_MODEL}" \
  --cpu 1 --memory 2Gi --timeout 300 --concurrency 4 --min-instances "$MIN_INSTANCES" --max-instances 3

REVISION="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.latestReadyRevisionName)')"
SERVICE_URL="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
printf 'deploy_env=%s\ngit_sha=%s\nimage=%s\nimage_digest=%s\nrevision=%s\nservice_url=%s\n' "$DEPLOY_ENV" "$GIT_SHA" "$IMAGE" "$IMAGE_DIGEST" "$REVISION" "$SERVICE_URL"
