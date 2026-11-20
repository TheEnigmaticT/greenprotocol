# Production reconciliation evidence — GreenProtoCol 0.9.0

Branch: `release/reconcile-0.9.0`
Merge base: `6e90ec9` (`feat: add signup and Sentinel operational alerts`, 2026-09-04)
Production baseline (ours): `997e835` (`release: promote main to production (release workflow fix + chemistry redeploy) (#44)`, 2026-09-30)
Integration source (theirs): `24fe51dd` (`chore: bump reproducibility hotfix to 0.9.0 (#54)`, 2026-11-13)

Command: `git merge --no-commit --no-ff origin/main` from `origin/production` (`997e835`).
Result: **35 unmerged paths**, all conflicts.

This document is the audit trail for how each conflict was resolved and why.
It is scoped to conflict resolution and the release-candidate safety fix described
in "Separate scope" below. It is **not** a production-readiness sign-off; see
"Blockers and unverified items".

## Why production was not treated as an independent source of truth

Production is not a divergent feature branch. Its seven commits
(`f3bba1c`, `bed6c82`, `1f52944`, `c3a39d1`, `2a7fd8d`, `fff685a`, `997e835`)
are squash merges of `main` into `production`. The consequence is decisive:

> **All 34 conflicted production code/configuration/test blobs occur in
> `main`'s history. `BACKLOG.md` is the documented exception below.**

Verified mechanically, not assumed:

- `git rev-list --first-parent 24fe51dd` → 263 commits. For **34 of the 35**
  conflicted paths, the blob at `997e835:<path>` is *exactly* the blob at some
  commit on main's first-parent chain. Production holds no unique content for
  those paths; it is a squash snapshot of an older main state.
- The 35th path (`BACKLOG.md`) is the only production blob anywhere in the
  repository that is absent from all of `main`'s history. Its one
  production-only line is the *unchecked* form of the PDF-import backlog card,
  which `main` carries as the **checked** `[x]` form plus a shipped-progress
  note. `main` is a strict superset here; no backlog item is lost.

So the reconciliation is not "choose a side per file" in the usual sense. For
every conflicted path, `main`'s version is the *later evolution of the same
lineage* that production was squashed from. Taking `main` therefore preserves
production's content and adds production's successor work; taking production
would revert improvements that were already validated on `main`.

### Independent confirmation

Two independent checks agree with the blob analysis:

1. **Line-level containment.** For each conflicted path, every non-blank
   production line was tested for presence in main's version. Only `BACKLOG.md`
   had a production-only line (the checked/unchecked card pair above). In all
   other files the production-only lines are *older forms* of logic that `main`
   has since refactored, and each was matched to its main-side successor
   (examples: `RecommendationApprovalReceipt` → `RecommendationDecisionReceipt`;
   `applyRecommendationApproval` → `applyDecisionReceipt`; inline
   `UNLIMITED_ANALYSIS_EMAILS` → extracted `lib/analysis-entitlements.ts` with
   the identical email set; `throw new Error(...)` → typed `AnalysisError` with
   error codes; `confidence="unavailable"` string → `ScoreProvenance` enum with
   legacy aliases preserved).
2. **No production-only paths.** `git diff --name-status 997e835 24fe51dd`
   reports 298 differing paths; **zero** are "present in production, absent from
   main". Production contributes no file that main does not have.

## Per-path resolution

All 35 conflicted paths were resolved to `main` (`git checkout --theirs`), and
each was then verified to be byte-identical to `main` at `24fe51dd` before
staging:

| # | Path | Prod blob | Main blob | Prod blob = main ancestor? |
|---|------|-----------|-----------|-----------------------------|
| 1 | `BACKLOG.md` | `e51e7192` | `2d692fa2` | No — main is a strict superset (card checked `[x]`, +14 new lines) |
| 2 | `app/analyze/[id]/page.tsx` | `e115bfa6` | `314c3133` | Yes (`3dff499`) |
| 3 | `app/analyze/page.tsx` | `e9e73eb7` | `1cc7d782` | Yes (`3dff499`) |
| 4 | `app/api/analyze/route.ts` | `6fb8442b` | `d60227cb` | Yes (`96b214b`) |
| 5 | `components/ChemistryDataNotice.tsx` | `ab0a4f7a` | `87404608` | Yes (`3dff499`) |
| 6 | `components/FinalizedProtocol.tsx` | `4b069215` | `0f0afb76` | Yes (`3dff499`) |
| 7 | `components/ProtocolInput.tsx` | `a20eaea1` | `738d09d3` | Yes (`3dff499`) |
| 8 | `components/TalkAboutThis.tsx` | `dd0f80ac` | `65cb32f1` | Yes (`3dff499`) |
| 9 | `lib/benchmark/stage-runner.ts` | `99a69150` | `feb450b4` | Yes (`96b214b`) |
| 10 | `lib/chemical-inputs.ts` | `65e8a11c` | `0547a7bc` | Yes (`3dff499`) |
| 11 | `lib/chemistry-service.ts` | `2e611daf` | `2df2e6da` | Yes (`feeeb06`) |
| 12 | `lib/declared-products.ts` | `76c2c4fd` | `b1f313b7` | Yes (`feeeb06`) |
| 13 | `lib/no-recommendations-summary.ts` | `61f58c24` | `08882ca4` | Yes (`3dff499`) |
| 14 | `lib/pipeline.ts` | `c9560f1a` | `7c26bab2` | Yes (`96b214b`) |
| 15 | `lib/prompts/parse.ts` | `f315967b` | `79c5c096` | Yes (`feeeb06`) |
| 16 | `lib/qwen-adapter.ts` | `58257fd7` | `dc281383` | Yes (`feeeb06`) |
| 17 | `lib/talk-about-this/agent.ts` | `7291f852` | `3c5110e4` | Yes (`3dff499`) |
| 18 | `lib/talk-about-this/context.ts` | `76b910f8` | `aecd155d` | Yes (`3dff499`) |
| 19 | `lib/talk-about-this/prompt.ts` | `9e0ffda5` | `49b4eb19` | Yes (`3dff499`) |
| 20 | `lib/talk-about-this/scope.ts` | `15b33c7a` | `42f0dca8` | Yes (`3dff499`) |
| 21 | `package-lock.json` | `16ff89a5` | `f476205c` | Yes (`96b214b`) |
| 22 | `package.json` | `c897d923` | `3220e8e3` | Yes (`96b214b`) — version `0.8.1` → `0.9.0` |
| 23 | `patterns.md` | `42697a2d` | `ead53cd1` | Yes (`3dff499`) |
| 24 | `services/chemistry/main.py` | `6a00dbe4` | `1e852812` | Yes (`feeeb06`) |
| 25 | `services/chemistry/scoring/models.py` | `39a10fcc` | `1392906e` | Yes (`feeeb06`) |
| 26 | `services/chemistry/scoring/p1_waste_prevention.py` | `f5c6d599` | `1d2cb815` | Yes (`feeeb06`) |
| 27 | `services/chemistry/scoring/p5_safer_solvents.py` | `212d2967` | `3c14f8db` | Yes (`feeeb06`) |
| 28 | `services/chemistry/scoring/p7_renewable_feedstocks.py` | `647181c4` | `99355dc1` | Yes (`feeeb06`) |
| 29 | `tests/lib/analyze-route-token-count.test.ts` | `69f162bf` | `e82aea28` | Yes (`96b214b`) |
| 30 | `tests/lib/chemical-inputs.test.ts` | `e7fafece` | `2d81dbd0` | Yes (`3dff499`) |
| 31 | `tests/lib/chemistry-data-notice.test.ts` | `138123cd` | `291ca030` | Yes (`3dff499`) |
| 32 | `tests/lib/declared-products.test.ts` | `ff46ae8f` | `f1496947` | Yes (`feeeb06`) |
| 33 | `tests/lib/no-recommendations-summary.test.ts` | `f7d9bdd6` | `3564979e` | Yes (`3dff499`) |
| 34 | `tests/lib/pipeline-qwen-provider.test.ts` | `659987ea` | `10eedfcb` | Yes (`feeeb06`) |
| 35 | `tests/lib/qwen-adapter.test.ts` | `41a84ef4` | `9f70c0af` | Yes (`feeeb06`) |

"Prod blob = main ancestor" means: the exact bytes production ships for that
path existed on `main`'s first-parent chain at the named commit. `main`'s
current version is a later commit on that same chain, i.e. the successor of the
production content rather than an unrelated fork.

### Behavioural deltas reviewed individually (not blanket-selected)

The largest semantic deltas were inspected file by file rather than assumed
safe. In each case the production behaviour is preserved on `main` in a
refactored form:

- **`app/api/analyze/route.ts`** — production defined `UNLIMITED_ANALYSIS_EMAILS`
  inline; `main` extracts it to `lib/analysis-entitlements.ts` with a
  **byte-identical** email set (`trevor.longino+gc1@gmail.com`,
  `alana@concannon.ie`) and the identical `@greenchemistry.ai` suffix rule.
  No entitlement is weakened.
- **`services/chemistry/scoring/models.py`** — production used bare
  `confidence="unavailable"` strings. `main` uses the `ScoreProvenance` enum
  and explicitly maps the legacy labels (`estimated` → `model-inferred`,
  `partial` → `benchmark`) while rejecting unknown labels instead of silently
  relabelling them. Legacy string callers still validate.
- **`services/chemistry/scoring/p1_waste_prevention.py`** — the largest rewrite
  (production 165 lines → main 98). Production fabricated a product mass from
  yield × atom economy; `main` refuses to derive PMI without a measured
  product mass and reports a benchmark PMI only as `BENCHMARK`, never as a
  protocol-derived output mass. This is the intended direction of
  `f170b44` ("reproducible analysis inputs and honest scoring coverage"),
  i.e. main is stricter, not looser.
- **`components/ChemistryDataNotice.tsx`** — production rendered an inline
  "We don't know what X is!" notice; `main` groups materials by failure reason
  (`not_recognized`, `reference_missing`, `provider_error`, `indefinite`,
  `unspecified`) via `lib/chemistry-unknowns.ts` and keeps the clarification
  path. Main's version is a superset of the production behaviours.
- **`lib/no-recommendations-summary.ts`** — production emitted terse bullets
  ("Indefinite materials: …"); `main` emits the same facts in plain language
  and adds an explicit fallback bullet. Same information, more readable.

### Auto-merged paths

The other 262 changed paths merged without conflict. They were checked for
hybrid artefacts: the staged index differs from `main`'s tree in **zero**
modified/deleted paths (`git diff --cached --name-status 24fe51dd` returns only
additions). No auto-merged file carries a mixture of the two sides, so there is
no auto-merge regression to repair.

## Verification

Run from the reconciled tree in this worktree.

| Gate | Command | Result |
|------|---------|--------|
| Lint | `npm run lint` | **PASS** — 0 errors, 13 pre-existing warnings (`no-unused-vars` in `tests/lib/**`), exit 0 |
| Typecheck | `npx tsc --noEmit` | **PASS** — exit 0 |
| Web tests | `npm run test` (vitest) | **PASS** — **1023 passed / 1023**, 106 files |
| Chemistry tests | `pytest -q` (Python 3.14.6 venv) | **PASS** — **285 passed**, 0 failed |
| Release-contract | `pytest -q test_release_scripts.py` | **PASS** — **31 passed** |
| Build | `npm run build` | **PASS** — exit 0, all routes generated |
| Conflict markers | `git grep -n '^<<<<<<< \|^>>>>>>> \|^=======$'` | **PASS** — none found |
| Tree equivalence | `git write-tree` vs `24fe51dd^{tree}` | **PASS** — identical: `e7a3855af25546b4f0c156d67c453c86bcc484ae` |
| CI release-contract gate | verbatim body of the `release-contract` job in `.github/workflows/ci.yml` | **PASS** — exit 0 |

Before the separate safety fix and this audit document were added, the
reconciled tree was byte-identical to `main` at `24fe51dd`. The final candidate
has four differing paths: this document, two workflow files and the release
script regression test. Product-code equivalence confirms this reconciliation
introduces no product-code delta beyond the intended staging promotion; it does
not independently prove every historical production behavior remains correct.

Chemistry tests were run against a rebuilt local evidence index
(`scripts/chemistry/build_solvent_evidence_index.py`), matching the CI
`chemistry-test` job, and against the LFS-backed raw assets present in this
checkout.

## Separate scope: release-candidate workflow Qwen alignment

**This is a prerequisite safety fix, not part of conflict resolution.** It is
recorded separately because it changes release-system behaviour rather than
product code.

### Defect

`.github/workflows/release-candidate.yml` runs on `pull_request` to `production`
with `types: [opened, synchronize, reopened, ready_for_review]` — **there is no
draft guard**, so opening a draft replacement PR triggers it. Its
`staging-sentinel` job deploys to the *same* staging Cloud Run service
(`gcai-chemistry`) as the known-good staging activation workflow
`.github/workflows/deploy-staging.yml`, but it supplied neither
`STAGING_ENGINE_CANDIDATE` nor `STAGING_OPENROUTER_MODEL`.

In `scripts/deploy-chemistry-cloud-run.sh`, staging routing is
`STAGING_ENGINE_CANDIDATE`-gated. With that variable unset the script binds
`OPENROUTER_MODEL=anthropic/claude-sonnet-4.5` and omits `GCAI_ENGINE_CANDIDATE`,
`GCAI_LLM_BASE_URL` and `GCAI_LLM_MODEL` entirely. The candidate deploy would
therefore **overwrite the validated staging runtime** with the legacy model and
strip the candidate bindings — destroying the configuration that
`deploy-staging.yml` had successfully activated. The verifier then compares
against the same unset expectation, so the regression would pass its own gate.

### Fix

`release-candidate.yml`'s `staging-sentinel` job now sets, on **both** the
deploy step and the verify step, exactly the values used by the known-good
activation workflow `deploy-staging.yml`:

```yaml
STAGING_ENGINE_CANDIDATE: '1'
STAGING_OPENROUTER_MODEL: qwen/qwen3.8-27b
```

The candidate deploy now reproduces the validated staging runtime instead of
replacing it, and the verifier asserts the candidate bindings it just deployed.

### Regression coverage

- `services/chemistry/test_release_scripts.py`
  - `test_release_candidate_staging_deploy_uses_the_validated_candidate_runtime_config`
    — asserts the candidate workflow requests the candidate runtime, asserts the
    candidate values are **equal to `deploy-staging.yml`'s values** (so the two
    cannot drift apart), and asserts the legacy Sonnet model string never
    appears in the candidate workflow.
  - `test_release_candidate_staging_deploy_and_verify_both_request_the_candidate_runtime`
    — asserts the candidate flags are present in the *specific* deploy and
    verify steps, and that alignment did not weaken the `IMAGE_DIGEST` or
    `STAGING_CHEMISTRY_SERVICE_TOKEN` gates.
- `.github/workflows/ci.yml` `release-contract` job — grep gates for
  `STAGING_ENGINE_CANDIDATE: '1'`, `STAGING_OPENROUTER_MODEL: qwen/qwen3.8-27b`,
  and the absence of the legacy model string in `release-candidate.yml`.

Both the workflow files and the Python regression test were validated by
re-running the CI `release-contract` gate body verbatim (exit 0) and
`pytest -q test_release_scripts.py` (31 passed).

## Blockers and unverified items

These are **not** resolved by this reconciliation and are outside its scope.

1. **`release-candidate.yml` still has no draft guard.** `types: [opened, …]`
   fires for draft PRs. The Qwen alignment above removes the *harm* of that
   trigger (the staging runtime is no longer clobbered), but the workflow still
   deploys to staging on a draft. Adding a draft guard changes release-system
   trigger semantics and is a separate decision.
2. **Migration validation is unverified.** No database migration was run or
   validated against staging or production. The reconciled tree carries 21
   Supabase migrations (`supabase/migrations/`) that have not been applied or
   verified in this environment.
3. **Production configuration is unverified.** No live staging or production
   Cloud Run service, Vercel alias, image digest, traffic split or
   configuration binding was read back. Nothing was deployed.
4. **Coordination is unverified.** No staging E2E run, chemistry sentinel, or
   deployed smoke was executed against a live environment. The web tests,
   chemistry tests and build in this document are local/static evidence only.
5. **No external systems were changed.** No push, no PR opened or closed, no
   merge to `production`, no deployment, no secret or configuration mutation.
   The work is committed locally on `release/reconcile-0.9.0` only.

## Rollback

The reconciliation is a single merge commit on `release/reconcile-0.9.0`. Until
it is merged, the known-good production state remains `997e835`. If the
reconciliation were merged and needed reverting, the correct path is a revert
PR to `production` — never a force push. See `docs/runbooks/release-rollback.md`.
