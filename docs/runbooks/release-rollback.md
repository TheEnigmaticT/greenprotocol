# Production release and rollback

## Stop rule

Never push, force-push, or deploy an arbitrary checkout to `production`. A normal release is an approved `main` → `production` PR after every required check is green.

## Baseline

The initial protected baseline is recorded locally in `.hermes/release-evidence/production-baseline-2026-09-04.md` (not committed because it contains operational metadata). The release record must name the prior production Git SHA, Vercel deployment URL, Cloud Run revision/image digest, traffic allocation, configuration-binding names, and sentinel result.

## Release

1. Open a PR from `main` to `production`. The candidate SHA must be the exact `main` commit intended for release.
2. The PR runs `build-staging-image`, `staging-sentinel`, and `staging-e2e` in addition to `web-quality`, `web-test`, `web-build`, `chemistry-test`, and `release-contract`. Missing, skipped, cancelled, or failing checks block release.
3. The staging build creates (or reuses) the SHA-tagged artifact once, records its digest, deploys that digest to the isolated staging service, then verifies chemistry and web smoke behavior.
4. Record PR review approval and obtain the separate Production Environment approval.
5. Merge through GitHub. Do not use a refspec push. The production workflow resolves the pre-existing SHA image to its immutable digest and refuses to build or retag an image.
6. Read back Vercel production SHA/alias plus Cloud Run revision, SHA-tagged image digest, traffic, secret-binding names, and authenticated chemistry sentinel result. Attach the sanitized evidence artifact to the release record.

## Rollback

1. Stop promotion if any verification fails.
2. Create a revert PR targeting `production` for the known-good production SHA. Never force-push a rollback.
3. Merge it through the same release gate and Environment approval.
4. Verify Vercel and Cloud Run now report the known-good release identifiers, then run production smoke sentinels.

## Break-glass

Use only for an active incident with an incident note, explicit approver, immutable artifact identity, and immediate verification. Set the documented override only for that command, record it, and create a follow-up PR restoring ordinary provenance.
