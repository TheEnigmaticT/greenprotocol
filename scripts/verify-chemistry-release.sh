#!/usr/bin/env bash
# Read back an already-deployed chemistry release. It makes no mutations.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }

DEPLOY_ENV="${DEPLOY_ENV:-}"
[[ -n "$DEPLOY_ENV" ]] || fail "DEPLOY_ENV is required (staging or production)."
[[ "$DEPLOY_ENV" == "staging" || "$DEPLOY_ENV" == "production" ]] || fail "DEPLOY_ENV must be staging or production."
EXPECTED_GIT_SHA="${GIT_SHA:-}"
[[ "$EXPECTED_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "GIT_SHA must be a full 40-character commit SHA."

# Candidate routing is staging-only and must be requested explicitly. Validate it
# before resolving gcloud so bad release inputs cannot contact cloud services.
STAGING_ENGINE_CANDIDATE="${STAGING_ENGINE_CANDIDATE:-}"
EXPECTED_CANDIDATE_BASE_URL=""
EXPECTED_CANDIDATE_MODEL=""
if [[ "$DEPLOY_ENV" == "staging" ]]; then
  [[ -z "$STAGING_ENGINE_CANDIDATE" || "$STAGING_ENGINE_CANDIDATE" == "1" ]] || \
    fail "STAGING_ENGINE_CANDIDATE must be 1 or unset."
  if [[ "$STAGING_ENGINE_CANDIDATE" == "1" ]]; then
    EXPECTED_CANDIDATE_BASE_URL="${STAGING_OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
    [[ "$EXPECTED_CANDIDATE_BASE_URL" == "https://openrouter.ai/api/v1" ]] || \
      fail "STAGING_OPENROUTER_BASE_URL must be the exact https://openrouter.ai/api/v1 candidate endpoint."
    EXPECTED_CANDIDATE_MODEL="${STAGING_OPENROUTER_MODEL:-}"
    [[ "$EXPECTED_CANDIDATE_MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*$ ]] || \
      fail "STAGING_OPENROUTER_MODEL is required and must be a provider/model identifier when STAGING_ENGINE_CANDIDATE=1."
  fi
else
  [[ -z "$STAGING_ENGINE_CANDIDATE" ]] || \
    fail "STAGING_ENGINE_CANDIDATE is allowed only for DEPLOY_ENV=staging."
  [[ -z "${STAGING_OPENROUTER_BASE_URL:-}" ]] || \
    fail "STAGING_OPENROUTER_BASE_URL is allowed only for DEPLOY_ENV=staging."
fi

REGION="${REGION:-us-central1}"
case "$DEPLOY_ENV" in
  staging)
    PROJECT_ID="${STAGING_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${STAGING_CHEMISTRY_SERVICE:-gcai-chemistry}"
    RUNTIME_SERVICE_ACCOUNT="${STAGING_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-gcai-staging-runtime@${PROJECT_ID}.iam.gserviceaccount.com}"
    TOKEN="${STAGING_CHEMISTRY_SERVICE_TOKEN:-}"
    TOKEN_SECRET="${STAGING_CHEMISTRY_TOKEN_SECRET:-staging-chemistry-service-token}"
    SUPABASE_URL_SECRET="${STAGING_SUPABASE_URL_SECRET:-staging-supabase-url}"
    SUPABASE_SERVICE_ROLE_SECRET="${STAGING_SUPABASE_SERVICE_ROLE_SECRET:-staging-supabase-service-role-key}"
    PROVIDER_KEY_SECRET="${STAGING_OPENROUTER_API_KEY_SECRET:-staging-greenchemistry-openrouter-api-key}"
    ;;
  production)
    PROJECT_ID="${PRODUCTION_GCP_PROJECT_ID:-greenchemistry-ai}"
    SERVICE_NAME="${PRODUCTION_CHEMISTRY_SERVICE:-greenchemistry-chemistry}"
    RUNTIME_SERVICE_ACCOUNT="${PRODUCTION_CHEMISTRY_RUNTIME_SERVICE_ACCOUNT:-greenchemistry-chemservice@${PROJECT_ID}.iam.gserviceaccount.com}"
    TOKEN="${PRODUCTION_CHEMISTRY_SERVICE_TOKEN:-}"
    TOKEN_SECRET="${PRODUCTION_CHEMISTRY_TOKEN_SECRET:-chemistry-service-token}"
    SUPABASE_URL_SECRET="${PRODUCTION_SUPABASE_URL_SECRET:-supabase-url}"
    SUPABASE_SERVICE_ROLE_SECRET="${PRODUCTION_SUPABASE_SERVICE_ROLE_SECRET:-supabase-service-role-key}"
    PROVIDER_KEY_SECRET="${PRODUCTION_OPENROUTER_API_KEY_SECRET:-greenchemistry-openrouter-api-key}"
    ;;
esac
[[ -n "$TOKEN" ]] || fail "${DEPLOY_ENV^^}_CHEMISTRY_SERVICE_TOKEN is required for authenticated release verification."

GCLOUD="${GCLOUD:-$(command -v gcloud || true)}"
[[ -n "$GCLOUD" ]] || fail "gcloud is required."

SERVICE_JSON="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format=json)"
python3 -c '
import json, sys
(
    expected_sha,
    expected_env,
    expected_service_account,
    expected_token_secret,
    expected_supabase_url_secret,
    expected_supabase_role_secret,
    expected_provider_key_secret,
    expect_candidate,
    expected_candidate_model,
    expected_candidate_base_url,
) = sys.argv[1:]
service = json.load(sys.stdin)
traffic = service.get("status", {}).get("traffic", [])
if len(traffic) != 1 or traffic[0].get("percent") != 100:
    raise SystemExit("Expected exactly one revision with 100% traffic.")
revision = traffic[0].get("revisionName")
template = service.get("spec", {}).get("template", {})
labels = template.get("metadata", {}).get("labels", {})
if labels.get("release-sha") != expected_sha or labels.get("deploy-env") != expected_env:
    raise SystemExit("Cloud Run revision labels do not match the expected release identity.")
spec = template.get("spec", {})
if spec.get("serviceAccountName") != expected_service_account:
    raise SystemExit(f"Cloud Run runtime service account does not match the selected {expected_env} environment.")
env = spec.get("containers", [{}])[0].get("env", [])
secret_names = {e["name"]: e.get("valueFrom", {}).get("secretKeyRef", {}).get("name") for e in env}
expected_secrets = {
    "CHEMISTRY_SERVICE_TOKEN": expected_token_secret,
    "SUPABASE_URL": expected_supabase_url_secret,
    "SUPABASE_SERVICE_ROLE_KEY": expected_supabase_role_secret,
    "OPENROUTER_API_KEY": expected_provider_key_secret,
}
if any(secret_names.get(name) != secret for name, secret in expected_secrets.items()):
    raise SystemExit(f"Cloud Run secret bindings do not match the selected {expected_env} environment.")
runtime_env = {e["name"]: e.get("value") for e in env if "value" in e}
candidate_names = {"GCAI_ENGINE_CANDIDATE", "GCAI_LLM_BASE_URL", "GCAI_LLM_MODEL"}
if expect_candidate == "1":
    expected_runtime = {
        "GCAI_ENGINE_CANDIDATE": "1",
        "GCAI_LLM_BASE_URL": expected_candidate_base_url,
        "GCAI_LLM_MODEL": expected_candidate_model,
        "OPENROUTER_MODEL": expected_candidate_model,
    }
    for name, value in expected_runtime.items():
        if runtime_env.get(name) != value:
            raise SystemExit(f"Candidate runtime binding {name} does not match the requested staging value.")
elif candidate_names.intersection(runtime_env):
    raise SystemExit("Candidate runtime bindings are present without an explicit staging candidate request.")
url = service.get("status", {}).get("url")
if not url or not revision:
    raise SystemExit("Cloud Run service has no ready URL or revision.")
print(f"revision={revision}")
print(f"service_url={url}")
print("secret_bindings=" + ",".join(f"{k}:{secret_names[k]}" for k in sorted(expected_secrets)))
' "$EXPECTED_GIT_SHA" "$DEPLOY_ENV" "$RUNTIME_SERVICE_ACCOUNT" "$TOKEN_SECRET" "$SUPABASE_URL_SECRET" "$SUPABASE_SERVICE_ROLE_SECRET" "$PROVIDER_KEY_SECRET" "$STAGING_ENGINE_CANDIDATE" "$EXPECTED_CANDIDATE_MODEL" "$EXPECTED_CANDIDATE_BASE_URL" <<<"$SERVICE_JSON"

SERVICE_URL="$("$GCLOUD" run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
curl --fail --silent --show-error "$SERVICE_URL/health" >/dev/null
curl --fail --silent --show-error --request POST "$SERVICE_URL/batch" \
  --header 'Content-Type: application/json' \
  --header "X-Chemistry-Service-Token: $TOKEN" \
  --data '{"chemicals":[{"chemical_name":"ethanol","quantity":"1 mL"}]}' \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data.get("results"), "Batch sentinel returned no results"'
printf 'health=ok\nbatch_sentinel=ok\n'
