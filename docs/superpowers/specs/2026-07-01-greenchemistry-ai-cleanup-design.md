# Greenchemistry-AI Cleanup Design

**Date:** 2026-07-01
**Status:** Approved for planning
**Decision:** Balanced triage, ending in a rescue branch plus a fresh clean worktree for active development

## Problem

The repository is no longer easy to commit from because useful work, generated artifacts, stale worktree state, and obvious scratch debris are mixed together.

Observed state during design:

- Main repo path: `~/dev/greenchemistry-ai`
- Current branch: `main`
- Branch state: `main...origin/main [ahead 1]`
- Tracked modifications in the main worktree: 30 files
- Untracked paths reported by `git status`: 51 paths
- Expanded untracked files reported by `git ls-files --others --exclude-standard`: about 600 files
- Untracked file concentration:
  - `tmp/`: 505 files
  - `docs/`: 70 files
  - `tests/`: 12 files
  - `lib/`: 7 files
  - `components/`: 3 files
- Linked worktree state:
  - Main repo: live
  - Hermes worktree `t_20938fb6`: live, detached HEAD, small dirty change set
  - Hermes worktree `t_7c80faa2`: prunable/stale
  - Hermes worktree `t_f58594e3`: prunable/stale, path missing
- Obvious malformed scratch artifact at repo root: ` \"..` containing a nested `components/` subtree
- Obvious scratch marker at repo root: `.hermes_write_test`

This is not a single bug. It is a repository hygiene and work preservation problem.

## Goal

Restore a commit-friendly development posture without silently discarding useful work.

Concretely, the cleanup should leave the repo in a state where:

1. stale worktree metadata is removed
2. live detached worktree changes are intentionally preserved
3. generated or scratch artifacts stop dominating `git status`
4. active code changes are classified into coherent buckets instead of one undifferentiated dirty tree
5. the user has one clean place to resume normal commits

## Non-Goals

- Finishing or validating every in-progress product change
- Refactoring application code unrelated to cleanup
- Curating the entire docs tree for content quality
- Running the full project test suite before the repository shape is stabilized
- Rewriting Hermes or other meta-tool behavior in this pass

## Constraints

- Preserve plausible product work before deleting anything
- Prefer isolation over heroic in-place cleanup on dirty `main`
- Delete only high-confidence garbage without further review
- Keep the cleanup steps observable and reversible where possible
- End with a clean active workspace suitable for new commits

## Approach Options Considered

### 1. Fast hygiene

Prune dead worktrees, ignore `tmp/`, delete obvious junk, and keep using the current dirty `main`.

Why rejected:
- leaves real work mixed together
- does not solve commit ambiguity
- keeps recovery burden on the user later

### 2. Balanced triage

Inventory everything first, preserve live work intentionally, isolate generated noise, bucket meaningful changes, then switch active development to a clean workspace.

Why chosen:
- preserves useful work
- reduces risk of accidental loss
- restores a normal commit lane quickly
- does not require deciding every product change immediately

### 3. Hard reset / rehydrate

Create a fresh clean worktree and cherry-pick only obviously wanted changes, treating the rest as archive material.

Why not chosen:
- cleanest end state, but highest risk of losing useful half-finished work
- too aggressive for the user’s stated preference

## Chosen Design

The cleanup will proceed in five phases.

### Phase 1: Safety snapshot

Before deleting or pruning anything:

- capture current worktree inventory
- capture per-worktree dirty status
- save patch/manifests for any dirty non-main worktree state
- inventory untracked trees that may contain source work

This phase exists to make later pruning reversible.

### Phase 2: Worktree triage

- preserve the live detached Hermes worktree by converting its state into a named branch, patch, or both
- prune stale worktree records that are already marked prunable
- verify the resulting worktree list is authoritative and boring

Expected result:
- no dangling worktree metadata
- no detached dirty state that could be lost casually

### Phase 3: Noise isolation

- snapshot and remove the malformed root artifact ` \"..`
- remove `.hermes_write_test`
- stop `tmp/` outputs from polluting status, either by moving them out of repo scope or by explicitly ignoring the generated subtree that should never be committed

Expected result:
- `git status` reflects source changes, not operational exhaust

### Phase 4: Change bucketing on main

Classify the remaining dirty work into buckets:

1. product code and tests
2. research/spec/docs artifacts
3. repo hygiene or configuration changes

Each bucket gets one of three dispositions:

- keep in the rescue branch for later split
- promote into the clean active lane if clearly current
- archive/park if real but not needed for immediate commit recovery

The intent is not to finish these buckets now. The intent is to stop them from blocking normal development.

### Phase 5: Clean commit lane recovery

Preferred end state:

- a rescue branch containing preserved dirty work
- a fresh clean worktree for active development
- optional follow-up patch files for ambiguous buckets

This is preferred over continuing on the current dirty main worktree because it gives the user an immediately usable place to commit while preserving the archaeological layer elsewhere.

## High-Confidence Cleanup Targets

These items should be removed or isolated during execution unless fresh evidence says otherwise:

- stale/prunable Hermes worktree records
- `.hermes_write_test`
- malformed root artifact ` \"..`
- generated `tmp/` outputs that are not intentional source artifacts

## Preserve-First Targets

These items should be classified, not deleted by default:

- new files under `components/`
- new files under `lib/`
- new files under `tests/`
- modified UI/result/scoring components
- `README.md`, `BACKLOG.md`, `patterns.md`
- research, spec, and audit documents under `docs/`

## Verification Strategy

Verification for the cleanup pass is repository-state verification, not product-behavior verification.

Success checks:

1. `git worktree list --porcelain` contains no stale prunable entries after cleanup
2. live non-main work has an intentional preservation path
3. `git status --short --branch` in the active development workspace is clean or intentionally minimal
4. generated scratch noise no longer dominates repo status
5. the user can make a new focused commit without first untangling historical debris

## Risks

### Risk: deleting work that only looks like scratch
Mitigation: snapshot first, preserve detached worktree changes explicitly, and classify source-like files before removal.

### Risk: preserving too much and staying stuck
Mitigation: end on a clean active worktree rather than requiring the current main worktree to become perfect.

### Risk: adding ignores that hide real source
Mitigation: limit ignore changes to clearly generated or operational paths, especially `tmp/`-style outputs.

## Implementation Handoff

The next step is an implementation plan that turns this design into concrete, reversible repo operations with exact commands, artifact paths, and verification steps.
