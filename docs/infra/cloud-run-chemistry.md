# Chemistry Service on Cloud Run

Cloud Run is the quickest production path for the deterministic scoring service. It runs the existing FastAPI/RDKit container without keeping the Mac mini or `localhost.run` in the request path.

## What This Uses

- Vercel keeps hosting the Next.js app.
- Supabase stays unchanged.
- Cloud Run hosts `services/chemistry`.
- Vercel calls Cloud Run through `CHEMISTRY_SERVICE_URL`.
- A shared `CHEMISTRY_SERVICE_TOKEN` protects `/convert`, `/batch`, and `/score`.

## One-Time Local Setup

Install Google Cloud CLI:

```bash
brew install --cask google-cloud-sdk
```

Then sign in:

```bash
gcloud auth login
gcloud auth application-default login
```

List billing accounts:

```bash
gcloud billing accounts list
```

## Deploy

From the repo root:

```bash
export PROJECT_ID=greenchemistry-ai-prod
export BILLING_ACCOUNT_ID=<billing-account-id-from-gcloud-list>
export CHEMISTRY_SERVICE_TOKEN="$(openssl rand -hex 32)"
export ANTHROPIC_API_KEY="<optional-but-recommended-for-LLM-assisted-scoring-inputs>"

bash scripts/deploy-chemistry-cloud-run.sh
```

The script will:

1. Create the Google Cloud project if it does not exist.
2. Link billing if `BILLING_ACCOUNT_ID` is provided.
3. Enable Cloud Run, Cloud Build, and Artifact Registry APIs.
4. Build `services/chemistry` with Cloud Build.
5. Deploy it to Cloud Run.
6. Print the resulting service URL.

Defaults:

- Service: `greenchemistry-chemistry`
- Region: `us-central1`
- CPU: `1`
- Memory: `2Gi`
- Timeout: `300s`
- Concurrency: `4`
- Min instances: `0`
- Max instances: `3`

Override any default:

```bash
REGION=us-east1 SERVICE_NAME=gpc-chemistry bash scripts/deploy-chemistry-cloud-run.sh
```

## Vercel Env Vars

After deploy, set production env vars in Vercel:

```bash
vercel env add CHEMISTRY_SERVICE_URL production
vercel env add CHEMISTRY_SERVICE_TOKEN production
```

Use the Cloud Run URL printed by the deploy script for `CHEMISTRY_SERVICE_URL`, and the same token used during deploy for `CHEMISTRY_SERVICE_TOKEN`.

Then redeploy:

```bash
vercel deploy --prod
```

## Smoke Tests

Public health check:

```bash
curl "$CHEMISTRY_SERVICE_URL/health"
```

Authenticated batch conversion:

```bash
curl -X POST "$CHEMISTRY_SERVICE_URL/batch" \
  -H "Content-Type: application/json" \
  -H "X-Chemistry-Service-Token: $CHEMISTRY_SERVICE_TOKEN" \
  -d '{"chemicals":[{"chemical_name":"ethanol","quantity":"5 mL"}]}'
```

Unauthenticated protected endpoints should fail:

```bash
curl -i -X POST "$CHEMISTRY_SERVICE_URL/batch" \
  -H "Content-Type: application/json" \
  -d '{"chemicals":[{"chemical_name":"ethanol","quantity":"5 mL"}]}'
```

Expected result: `401 Unauthorized`.

## Updating Later

```bash
git pull
PROJECT_ID=greenchemistry-ai-prod \
CHEMISTRY_SERVICE_TOKEN="<same-token>" \
bash scripts/deploy-chemistry-cloud-run.sh
```

## Warming the Chemistry Cache

PubChem asks programmatic clients to stay under 5 requests per second, and the
service may return `503` when it is overloaded or temporarily unable to serve a
request. Cloud Run can receive `503` from PubChem even when the same lookup
works from a local Mac.

Build a bundled cache from a machine that can reach PubChem:

```bash
python3 scripts/warm-pubchem-cache.py --input chemicals.txt --max 5000 --delay 1.5
```

Input can be a plain text file with one chemical name per line or a CSV whose
first column is the chemical name. Without `--input`, the script warms the
repo's built-in synonym list.

The script writes:

```text
services/chemistry/pubchem_cache_seed.json
```

Redeploy Cloud Run after generating or updating that file:

```bash
PROJECT_ID=insight-ai-455704 \
CHEMISTRY_SERVICE_TOKEN="<same-token>" \
bash scripts/deploy-chemistry-cloud-run.sh
```

The hosted service loads `pubchem_cache_seed.json` at startup, then layers its
runtime `/tmp/chemistry-cache/pubchem_cache.json` over it.

For demo-oriented async hydration, let Cloud Run record misses and have the Mac
hydrate them later:

```bash
python3 scripts/warm-pubchem-cache.py \
  --sync-url "$CHEMISTRY_SERVICE_URL" \
  --token "$CHEMISTRY_SERVICE_TOKEN" \
  --delay 1.5
```

This pulls `/cache/missing`, queries PubChem from the Mac, writes the local seed
cache file, and posts hydrated entries back to `/cache/upsert`.

## Cost Notes

This is configured for low idle cost with `--min-instances 0`. That means cold starts are possible, especially because RDKit increases image and import weight. If cold starts hurt demos, set `--min-instances 1` temporarily:

```bash
gcloud run services update greenchemistry-chemistry \
  --region us-central1 \
  --min-instances 1
```

Switch it back after the demo:

```bash
gcloud run services update greenchemistry-chemistry \
  --region us-central1 \
  --min-instances 0
```
