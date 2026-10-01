#!/usr/bin/env bash
# Build a clean-archive, SHA-tagged SciSure worker image for staging only.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ "${DEPLOY_ENV:-}" == "staging" ]] || fail 'Image builds are allowed only for DEPLOY_ENV=staging.'
GIT_SHA="${GIT_SHA:-}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'GIT_SHA must be a full 40-character commit SHA.'
[[ "$GIT_SHA" == "$(git rev-parse HEAD)" ]] || fail 'GIT_SHA does not match checked-out HEAD.'

GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail 'gcloud is required.'
REGION="${REGION:-us-central1}"
PROJECT_ID="${STAGING_GCP_PROJECT_ID:-greenchemistry-ai}"
[[ "$PROJECT_ID" == 'greenchemistry-ai' ]] || fail 'STAGING_GCP_PROJECT_ID must be greenchemistry-ai.'
REPOSITORY="${STAGING_ARTIFACT_REPOSITORY:-greenchemistry}"
IMAGE_NAME="${SCISURE_WORKER_IMAGE_NAME:-gcai-scisure-worker}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${GIT_SHA}"

"$GCLOUD" artifacts repositories describe "$REPOSITORY" --project "$PROJECT_ID" --location "$REGION" >/dev/null
if IMAGE_DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" --format='value(image_summary.digest)' 2>/dev/null)" && [[ -n "$IMAGE_DIGEST" ]]; then
  printf 'Reusing existing immutable candidate image.\n' >&2
else
  # Archive the exact committed tree. Dirty worktree files can never enter this build.
  BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/gcai-scisure-worker.${GIT_SHA}.XXXXXX")"
  trap 'rm -rf "$BUILD_CONTEXT"' EXIT
  git archive --format=tar "$GIT_SHA" | tar -xf - -C "$BUILD_CONTEXT"
  [[ -f "$BUILD_CONTEXT/services/scisure-worker/Dockerfile" ]] || fail 'Committed worker Dockerfile is absent.'
  [[ -f "$BUILD_CONTEXT/cloudbuild-scisure-worker.yaml" ]] || fail 'Committed worker Cloud Build config is absent.'
  SUBMIT_OUT="$("$GCLOUD" builds submit "$BUILD_CONTEXT" --project "$PROJECT_ID" --config "$BUILD_CONTEXT/cloudbuild-scisure-worker.yaml" --substitutions "_GIT_SHA=$GIT_SHA,_IMAGE=$IMAGE" --async 2>&1)" || fail 'Cloud Build submit failed.'
  printf '%s\n' "$SUBMIT_OUT" >&2
  [[ "$SUBMIT_OUT" =~ builds/([0-9a-f-]{36}) ]] || fail 'Cloud Build did not return a build ID.'
  BUILD_ID="${BASH_REMATCH[1]}"
  for _ in $(seq 1 120); do
    BUILD_STATUS="$("$GCLOUD" builds describe "$BUILD_ID" --project "$PROJECT_ID" --format='value(status)')"
    case "$BUILD_STATUS" in
      SUCCESS) break ;;
      FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED) fail "Cloud Build did not finish successfully: $BUILD_STATUS" ;;
      QUEUED|WORKING|PENDING) sleep 5 ;;
      *) fail "Cloud Build returned an unknown status: $BUILD_STATUS" ;;
    esac
  done
  [[ "${BUILD_STATUS:-}" == SUCCESS ]] || fail 'Cloud Build did not finish successfully before timeout.'
  IMAGE_DIGEST="$("$GCLOUD" artifacts docker images describe "$IMAGE" --project "$PROJECT_ID" --format='value(image_summary.digest)')"
fi
[[ "$IMAGE_DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Could not resolve an immutable image digest.'
printf 'image=%s\nimage_digest=%s\n' "$IMAGE" "$IMAGE_DIGEST"
