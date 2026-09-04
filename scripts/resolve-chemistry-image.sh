#!/usr/bin/env bash
# Resolve, but never build or retag, the image approved through staging.
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

DEPLOY_ENV="${DEPLOY_ENV:-}"
[[ "$DEPLOY_ENV" == "production" ]] || fail "Only DEPLOY_ENV=production may resolve a release candidate."
GIT_SHA="${GIT_SHA:-}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_SHA must be a full 40-character commit SHA."
[[ "$GIT_SHA" == "$(git rev-parse HEAD)" ]] || fail "GIT_SHA does not match checked-out HEAD."

GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail "gcloud is required."
REGION="${REGION:-us-central1}"
PROJECT_ID="${PRODUCTION_GCP_PROJECT_ID:-greenchemistry-ai}"
REPOSITORY="${PRODUCTION_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
CHEMISTRY_IMAGE_NAME="${CHEMISTRY_IMAGE_NAME:-greenchemistry-chemistry}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${CHEMISTRY_IMAGE_NAME}:${GIT_SHA}"

IMAGE_DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" --format='value(image_summary.digest)' 2>/dev/null || true)"
[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || \
  fail "No immutable staging-validated image exists for ${GIT_SHA}; refusing production deployment."
printf 'image=%s\nimage_digest=%s\n' "$IMAGE" "$IMAGE_DIGEST"
