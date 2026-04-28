# CI/CD Setup for GreenChemistry-AI

This project uses GitHub Actions for continuous integration and deployment.

## Required GitHub Secrets

To enable the pipeline, please add the following secrets in **Settings > Secrets and variables > Actions**:

### Build & Test
- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous key.

### Vercel Deployment
- `VERCEL_TOKEN`: Your Vercel Personal Access Token.
- `VERCEL_ORG_ID`: Your Vercel Organization ID.
- `VERCEL_PROJECT_ID`: Your Vercel Project ID.

## Environments

The workflow uses GitHub Environments for staging and production. You can configure protection rules (like required reviewers) for the `production` environment in **Settings > Environments**.

## Workflow Logic

1. **Pull Request to `main`**: Runs Lint, Typecheck, and Build.
2. **Push/Merge to `main`**: Runs Build and Test, then automatically deploys to **Staging**.
3. **Manual Promotion**: Use the "Run workflow" button in the Actions tab to deploy to **Production**.
