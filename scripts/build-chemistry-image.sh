#!/usr/bin/env bash
# Build a staging-validated, SHA-tagged chemistry image exactly once.
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

DEPLOY_ENV="${DEPLOY_ENV:-}"
[[ "$DEPLOY_ENV" == "staging" ]] || fail "Image builds are allowed only for DEPLOY_ENV=staging."

GIT_SHA="${GIT_SHA:-}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_SHA must be a full 40-character commit SHA."
[[ "$GIT_SHA" == "$(git rev-parse HEAD)" ]] || fail "GIT_SHA does not match checked-out HEAD."

GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail "gcloud is required."
REGION="${REGION:-us-central1}"
PROJECT_ID="${STAGING_GCP_PROJECT_ID:-greenchemistry-ai}"
# A shared registry preserves one image digest across staging and production;
# staging has no authority to deploy the production service or use its secrets.
REPOSITORY="${STAGING_ARTIFACT_REPOSITORY:-cloud-run-source-deploy}"
CHEMISTRY_IMAGE_NAME="${CHEMISTRY_IMAGE_NAME:-greenchemistry-chemistry}"
SOURCE_DIR="${SOURCE_DIR:-services/chemistry}"
[[ -d "$SOURCE_DIR" ]] || fail "Chemistry source directory does not exist: $SOURCE_DIR"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${CHEMISTRY_IMAGE_NAME}:${GIT_SHA}"
"$GCLOUD" artifacts repositories describe "$REPOSITORY" --location "$REGION" --project "$PROJECT_ID" >/dev/null

if IMAGE_DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" --format='value(image_summary.digest)' 2>/dev/null)" && [[ -n "$IMAGE_DIGEST" ]]; then
  printf 'Reusing existing immutable candidate image.\n' >&2
else
  BUILD_ID="$("$GCLOUD" builds submit "$SOURCE_DIR" --project "$PROJECT_ID" --tag "$IMAGE" --async \
    | sed -n 's#.*builds/\([^]]*\)].*#\1#p')"
  [[ "$BUILD_ID" =~ ^[0-9a-f-]{36}$ ]] || fail "Cloud Build did not return a build ID."

  for _ in $(seq 1 120); do
    BUILD_STATUS="$("$GCLOUD" builds describe "$BUILD_ID" --project "$PROJECT_ID" --format='value(status)')"
    case "$BUILD_STATUS" in
      SUCCESS) break ;;
      FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
        fail "Cloud Build did not finish successfully: $BUILD_STATUS"
        ;;
      QUEUED|WORKING|PENDING) sleep 5 ;;
      *) fail "Cloud Build returned an unknown status: $BUILD_STATUS" ;;
    esac
  done
  [[ "${BUILD_STATUS:-}" == "SUCCESS" ]] || fail "Cloud Build did not finish successfully before timeout."

  IMAGE_DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" --format='value(image_summary.digest)')"
fi

[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "Could not resolve an immutable image digest."
printf 'image=%s\nimage_digest=%s\n' "$IMAGE" "$IMAGE_DIGEST"
