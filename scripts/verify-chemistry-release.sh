#!/usr/bin/env bash
# Read back an already-deployed chemistry release. It makes no mutations.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
DEPLOY_ENV="${DEPLOY_ENV:-}"
[[ -n "$DEPLOY_ENV" ]] || fail "DEPLOY_ENV is required (staging or production)."
[[ "$DEPLOY_ENV" == "staging" || "$DEPLOY_ENV" == "production" ]] || fail "DEPLOY_ENV must be staging or production."
EXPECTED_GIT_SHA="${GIT_SHA:-}"
[[ "$EXPECTED_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_SHA must be a full 40-character commit SHA."
GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail "gcloud is required."
REGION="${REGION:-us-central1}"
case "$DEPLOY_ENV" in
  staging)
    PROJECT_ID="${STAGING_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${STAGING_CHEMISTRY_SERVICE:-gcai-chemistry}"
    TOKEN="${STAGING_CHEMISTRY_SERVICE_TOKEN:-}"
    ;;
  production)
    PROJECT_ID="${PRODUCTION_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${PRODUCTION_CHEMISTRY_SERVICE:-greenchemistry-chemistry}"
    TOKEN="${PRODUCTION_CHEMISTRY_SERVICE_TOKEN:-}"
    ;;
esac
[[ -n "$TOKEN" ]] || fail "${DEPLOY_ENV^^}_CHEMISTRY_SERVICE_TOKEN is required for authenticated release verification."

SERVICE_JSON="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format=json)"
python3 -c '
import json, sys
expected_sha, expected_env = sys.argv[1:]
service = json.load(sys.stdin)
traffic = service.get("status", {}).get("traffic", [])
if len(traffic) != 1 or traffic[0].get("percent") != 100:
    raise SystemExit("Expected exactly one revision with 100% traffic.")
revision = traffic[0].get("revisionName")
template = service.get("spec", {}).get("template", {})
labels = template.get("metadata", {}).get("labels", {})
if labels.get("release-sha") != expected_sha or labels.get("deploy-env") != expected_env:
    raise SystemExit("Cloud Run revision labels do not match the expected release identity.")
env = template.get("spec", {}).get("containers", [{}])[0].get("env", [])
secret_names = {e["name"]: e.get("valueFrom", {}).get("secretKeyRef", {}).get("name") for e in env}
required = {"CHEMISTRY_SERVICE_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY"}
if not required.issubset(secret_names) or any(not secret_names[key] for key in required):
    raise SystemExit("Required secret bindings are absent from the deployed revision.")
url = service.get("status", {}).get("url")
if not url or not revision:
    raise SystemExit("Cloud Run service has no ready URL or revision.")
print(f"revision={revision}")
print(f"service_url={url}")
print("secret_bindings=" + ",".join(f"{k}:{secret_names[k]}" for k in sorted(required)))
' "$EXPECTED_GIT_SHA" "$DEPLOY_ENV" <<<"$SERVICE_JSON"
SERVICE_URL="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
curl --fail --silent --show-error "$SERVICE_URL/health" >/dev/null
curl --fail --silent --show-error --request POST "$SERVICE_URL/batch" \
  --header 'Content-Type: application/json' \
  --header "X-Chemistry-Service-Token: $TOKEN" \
  --data '{"chemicals":[{"chemical_name":"ethanol","quantity":"1 mL"}]}' \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("results"), "Batch sentinel returned no results"'
printf 'health=ok\nbatch_sentinel=ok\n'
