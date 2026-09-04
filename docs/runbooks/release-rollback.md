# Production release and rollback

## Stop rule

Never push, force-push, or deploy an arbitrary checkout to `production`. A normal release is an approved `main` → `production` PR after every required check is green.

## Baseline

The initial protected baseline is recorded locally in `.hermes/release-evidence/production-baseline-2026-09-04.md` (not committed because it contains operational metadata). The release record must name the prior production Git SHA, Vercel deployment URL, Cloud Run revision/image digest, traffic allocation, configuration-binding names, and sentinel result.

## Release

1. Confirm the PR source is `main`, target is `production`, and its SHA is the tested SHA.
2. Confirm `web-quality`, `web-test`, `web-build`, `chemistry-test`, contract, staging E2E, and staging sentinel gates have all passed; missing/skipped/cancelled counts as failed.
3. Record the release reviewer approval and production Environment approval.
4. Merge through GitHub. Do not use a refspec push.
5. Read back Vercel production SHA/alias plus Cloud Run revision, SHA-tagged image digest, traffic, and secret-binding names.
6. Run the authenticated chemistry sentinel and the read-only app/browser smoke sentinel; attach evidence to the release.

## Rollback

1. Stop promotion if any verification fails.
2. Create a revert PR targeting `production` for the known-good production SHA. Never force-push a rollback.
3. Merge it through the same release gate and Environment approval.
4. Verify Vercel and Cloud Run now report the known-good release identifiers, then run production smoke sentinels.

## Break-glass

Use only for an active incident with an incident note, explicit approver, immutable artifact identity, and immediate verification. Set the documented override only for that command, record it, and create a follow-up PR restoring ordinary provenance.
