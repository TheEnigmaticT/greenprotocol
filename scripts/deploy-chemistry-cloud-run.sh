#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-greenchemistry-chemistry}"
REGION="${REGION:-us-central1}"
SOURCE_DIR="${SOURCE_DIR:-services/chemistry}"
REPOSITORY="${REPOSITORY:-greenchemistry}"

GCLOUD="${GCLOUD:-}"
if [[ -z "$GCLOUD" ]] && command -v gcloud >/dev/null 2>&1; then
  GCLOUD="$(command -v gcloud)"
elif [[ -z "$GCLOUD" && -x "/opt/homebrew/share/google-cloud-sdk/bin/gcloud" ]]; then
  GCLOUD="/opt/homebrew/share/google-cloud-sdk/bin/gcloud"
fi

if [[ -z "$GCLOUD" ]]; then
  echo "gcloud is not installed. Install Google Cloud CLI first:"
  echo "https://cloud.google.com/sdk/docs/install"
  exit 1
fi

if [[ -z "${CLOUDSDK_PYTHON:-}" && -x "/opt/homebrew/opt/python@3.13/libexec/bin/python" ]]; then
  export CLOUDSDK_PYTHON="/opt/homebrew/opt/python@3.13/libexec/bin/python"
fi

if [[ -d "/opt/homebrew/opt/expat/lib" ]]; then
  export DYLD_LIBRARY_PATH="/opt/homebrew/opt/expat/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi

if [[ -z "${PROJECT_ID:-}" ]]; then
  echo "PROJECT_ID is required."
  echo "Example: PROJECT_ID=greenchemistry-ai-prod CHEMISTRY_SERVICE_TOKEN=... $0"
  exit 1
fi

if [[ -z "${CHEMISTRY_SERVICE_TOKEN:-}" ]]; then
  echo "CHEMISTRY_SERVICE_TOKEN is required."
  echo "Generate one with: openssl rand -hex 32"
  exit 1
fi

if ! "$GCLOUD" projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  "$GCLOUD" projects create "$PROJECT_ID" --name="Green Chemistry AI"
fi

"$GCLOUD" config set project "$PROJECT_ID"

if [[ -n "${BILLING_ACCOUNT_ID:-}" ]]; then
  "$GCLOUD" billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
fi

"$GCLOUD" services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com

if ! "$GCLOUD" artifacts repositories describe "$REPOSITORY" \
  --location "$REGION" >/dev/null 2>&1; then
  "$GCLOUD" artifacts repositories create "$REPOSITORY" \
    --repository-format docker \
    --location "$REGION" \
    --description "GreenChemistry.ai containers"
fi

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:latest"

ENV_VARS="CHEMISTRY_SERVICE_TOKEN=${CHEMISTRY_SERVICE_TOKEN}"
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  ENV_VARS="${ENV_VARS},ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
fi
if [[ -n "${LOCAL_LLM_URL:-}" ]]; then
  ENV_VARS="${ENV_VARS},LOCAL_LLM_URL=${LOCAL_LLM_URL}"
fi
if [[ -n "${LLM_MODEL:-}" ]]; then
  ENV_VARS="${ENV_VARS},LLM_MODEL=${LLM_MODEL}"
fi

"$GCLOUD" builds submit "$SOURCE_DIR" --tag "$IMAGE"

"$GCLOUD" run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 2Gi \
  --timeout 300 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "$ENV_VARS"

SERVICE_URL="$("$GCLOUD" run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

echo
echo "Cloud Run service URL:"
echo "$SERVICE_URL"
echo
echo "Set these in Vercel production:"
echo "CHEMISTRY_SERVICE_URL=$SERVICE_URL"
echo "CHEMISTRY_SERVICE_TOKEN=<same token>"
