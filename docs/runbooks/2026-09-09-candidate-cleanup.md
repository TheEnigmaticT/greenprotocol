# Candidate checkpoint and cleanup — 2026-09-09

## Scope and checkpoint

The user authorized a local working-state commit, a cleanup, then a second local commit. No push, merge, deployment, database mutation, or sibling-worktree reset was authorized or performed.

Working source checkpoint: **`4ba0a345e6e4d08b9e36728091bb3b8ee39dbf8b`**, branch `feat/portable-engine-candidate`, checkout `/Users/ct-mac-mini/dev/greenchemistry-ai-engine-candidate`.

The checkpoint includes the candidate runtime, regression tests, public fixtures, launcher, runner, verifier, and runbook. Ignored dependencies, generated indexes, private configuration, and raw local run artifacts are not Git source backups.

## Removed from the active checkout

| Path | Why it is obsolete | Replacement / recovery |
| --- | --- | --- |
| `scripts/run-qwen-parity.ts` | One-off probe hardcoded to a temporary Suzuki file and chemistry port 8006. No runtime, package-script, or test caller. The implementation plan referenced it only as an earlier implementation aid. | `npm run engine:analyze` and `npm run engine:chemistry`; original file is in the checkpoint. The separate parity checkout is preserved. |
| `scripts/add_tracing.py` | One-time regex source rewriter for an older `lib/pipeline.ts`, not a tracing runtime component. No package, application, or test caller; the earlier audit already identified it as vestigial. | Current tracing remains in `lib/pipeline.ts` / `lib/trace.ts`, unchanged. Original codemod is in the checkpoint. |
| `scripts/update-pipeline-tracing.sh` | Older sed-based source rewrite overlapping the Python codemod, with no caller. It is not a supported development or deployment command. | Same retained runtime; original script is in the checkpoint. |

The historical implementation plan now points to the supported runbook and identifies the obsolete probe by its Git checkpoint, rather than implying it is a current entry point.

## Archived without content changes

Eight historical `.superpowers/sdd/` implementation reports were moved to [the linked agent-report archive](../archive/agent-reports/README.md). SHA-256 comparison verified every move byte-for-byte. Their testing and design evidence was preserved, not discarded.

## Deliberately retained

- All application/runtime code, tests, benchmark fixtures, package/dependency manifests, model transports (including legacy opt-in behavior), and the candidate runner/launcher/verifier are unchanged from the checkpoint.
- Chemical source datasets, PubChem seed/cache, solvent-reference raw assets/manifests/index, and literature ingestion/retrieval tools were not removed.
- Main's local literature and chemical-seed directories remain outside this cleanup. A missing runtime connection does not make a dataset disposable.
- Main's dirty backlog/release-plan/package changes, untracked work, broader scientific-audit checkout, parity checkout, and other live worktrees were not reset, committed, or deleted by this cleanup.
- Thirteen Git worktree registrations were marked prunable, but filesystem checks found twelve of those checkout directories still existed. No blanket `git worktree prune`, `git clean`, branch deletion, or removal of those directories was performed. They need separate preservation/reconciliation, not classification as empty directories from the Git label alone.
- Ignored dependency/build/runtime caches were retained: they are rebuildable infrastructure attached to current workflows, not unattached source files.

## ORD inventory finding

A bounded read-only audit found no ORD data file, importer, schema, or integration in the four named GreenChemistry worktrees or their locally available Git-ref histories. Filename-only discovery under `/Users/ct-mac-mini/dev` likewise did not locate an ORD-named dataset/repository. This does not establish that no download exists elsewhere or remotely. No reaction dataset was deleted, and no new ingestion/integration was started.

## Verification

Before the working-state commit and again after cleanup:

- Web tests: **246 passed across 30 files**.
- Python chemistry tests: **101 passed**; 33 dependency deprecation warnings remain.
- TypeScript and production build passed.
- Global lint still has the same **four existing UI errors**; the affected UI files are unchanged.
- `git diff --check` passed.

Post-cleanup checks also passed for both no-network runner/launcher preflights, the existing five-fixture artifact verifier, archive link resolution, and archive byte equality. A Git comparison confirms the runtime/validation code is byte-identical to the working checkpoint; cleanup did not initiate another paid model run. The previously verified live result remains `/tmp/gcai-candidate-source-wired-02`.

For current operation and scientific/release limitations, use [the working-engine runbook](working-engine-candidate.md). To inspect a removed file without overwriting current work, use `git show 4ba0a34:<original-path>`.
