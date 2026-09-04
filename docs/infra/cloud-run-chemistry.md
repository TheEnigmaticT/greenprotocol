# Chemistry Service Release Contract

The chemistry FastAPI/RDKit service is deployed as an immutable Cloud Run release artifact. It is separate from the Vercel web deployment.

## Environment boundary

| Environment | Cloud Run service | Credentials | Provider routing |
| --- | --- | --- | --- |
| staging | `gcai-chemistry` (or explicit `STAGING_CHEMISTRY_SERVICE`) | staging-only Secret Manager bindings and service token | staging-only configuration |
| production | `greenchemistry-chemistry` (or explicit `PRODUCTION_CHEMISTRY_SERVICE`) | production-only bindings and service token | approved production configuration |

Do not use a staging service that shares production service tokens, provider keys, Supabase credentials, or URL.

## Normal release

Only the GitHub `release-production.yml` workflow calls the deploy script for production. It supplies `DEPLOY_ENV=production`, the exact `GITHUB_SHA`, and the approved workflow authority. The script:

1. refuses a missing/ambiguous environment or a SHA that is not the checkout;
2. never creates GCP projects, enables APIs, or creates Artifact Registry repositories;
3. builds a SHA-tagged image and resolves its digest;
4. selects service, project, repository, bindings, and model solely from the declared environment;
5. deploys only Secret Manager bindings, never literal credential values;
6. prints the Git SHA, image digest, revision, and URL for release evidence.

After deploy, `scripts/verify-chemistry-release.sh` requires the exact revision labels, 100% traffic, required binding names, `/health`, and an authenticated `/batch` sentinel. It is read-only.

## Required configuration

Production secrets must live in the GitHub `production` Environment, not repository-wide secrets:

- `GCP_PRODUCTION_RELEASE_CREDENTIALS`
- `PRODUCTION_CHEMISTRY_SERVICE_TOKEN`

The workflow identity must have only the Cloud Run, Artifact Registry, and Secret Manager access needed for the production service. A break-glass identity is separate and audited.

## Local safety checks

```bash
cd services/chemistry
pytest -q test_release_scripts.py
```

The tests verify that missing environment/SHA and wrong SHA fail before `gcloud` can be invoked.
