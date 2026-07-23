# GreenChemistry.ai Kanban Restoration Plan

**Date:** 2026-07-17  
**Board:** `green-chemistry-ai`  
**Status:** Frozen; restoration required before canonical execution resumes

## Current audit

- Markdown canonical cards: **79**
  - `Next`: 34
  - `Blocked / Waiting`: 3
  - `Done`: 42
- Hermes database cards: **1,540**
  - active: 98
  - done: 42
  - archived: 1,402
- Active DB cards absent from markdown: **59**
- Active task-link rows: **772**
- Active cards participating in a graph: **95 of 98**
- Active root candidates with no graph participation: **1**
- Active running cards: **0**
- Active board-repair/night-crew automation: **paused/disabled**

Interpretation: the board is safely stopped, but the DB is not yet a canonical execution representation of the markdown backlog. Most active cards are decomposition residue or stale runtime-side cards that are not represented in the human planning surface.

## Canonical operating contract

### Source of truth

- `BACKLOG.md` owns planning title, placement, priority, release, and human-facing scope.
- Hermes Kanban owns runtime state, claims, run history, worker comments, and execution summaries.
- Runtime states must not be silently overwritten by markdown sync when they represent a live technical or human gate.
- Conflicts are reported for review; they are not guessed away.

### Identity

- Every active markdown card has exactly one stable `<!-- hermes:t_<id> -->` marker.
- Every active Hermes card must be represented by exactly one markdown card, unless explicitly quarantined in an operator report.
- Titles are not task identity.
- No new task may be imported without capturing its stable ID in markdown or a sync state file.

### Safe round-trip schema

Sync only:

- ID
- title
- planning column/status
- priority/release metadata
- optional assignee
- short completion summary

Keep runtime claims, run IDs, heartbeats, retry history, and detailed worker logs Hermes-side.

## Restoration gates

### Gate 0 — Freeze and snapshot (complete)

- Keep `kanban.dispatch_in_gateway=false`.
- Keep `kanban.auto_decompose=false`.
- Keep board-repair, Night Crew on/off, and morning digest jobs paused.
- Preserve a verified board snapshot before each destructive cleanup pass.
- Verify no external runner is mutating the board.

### Gate 1 — Reconcile the survivor set

Required actions:

1. Treat the 79 linked markdown cards as the maximum automatic carry-forward set.
2. Classify the 59 active DB cards absent from markdown:
   - stale helper/decomposition residue → archive;
   - legitimate product work → manually re-justify and add one canonical markdown card;
   - runtime/technical gate → retain only if it has a precise reason and owner.
3. Do not bulk archive without a per-class count and snapshot.
4. Preserve audit comments explaining the reclamation boundary.

Pass condition: every active card is either linked to markdown or explicitly listed in a small quarantine report.

### Gate 2 — Collapse graph residue

Required actions:

1. Inspect the 772 active link rows.
2. Remove only stale links whose endpoints are archived residue and no longer represent a live dependency.
3. Archive helper cards that merely restate a canonical root or scaffold an old decomposition wave.
4. Collapse near-duplicate roots into one human-facing card.
5. Rewrite surviving root cards with Goal, Scope, Dependencies, Definition of Done, and Verification.
6. Enforce one decomposition layer: root → 2–5 bounded leaves. Children do not auto-decompose.

Pass condition:

- active graph is small enough to understand from the dashboard;
- each active root has a bounded purpose;
- no root is trapped in a historical recursive graph;
- genuinely dependent cards have explicit parent links;
- independent cards are not over-linked.

### Gate 3 — Repair status semantics

Current mismatch: markdown `Next` contains cards whose DB statuses are `todo` or `blocked`.

Required actions:

1. Decide whether those cards are genuinely ready, still require specification, or are blocked.
2. Move the markdown card and DB state together.
3. Never leave a blocked/quarantined card under a dispatchable heading.
4. Keep `In Progress` and `In Review` empty until a real first-wave smoke test begins.
5. Do not let a bulk sync revive blocked cards merely because their old markdown heading says `Next`.

Pass condition: the status shown in markdown and Hermes agrees for every active canonical card, except explicitly documented runtime-owned states.

### Gate 4 — Repair assignee and worker contracts

Required actions:

- `orchestrator`: architecture/specification, triage, broad repo investigation, dependency planning.
- `worker-gemma`: only bounded, single-surface implementation or verification cards with exact files and commands.
- `reviewer`: only review cards with explicit parents and review criteria.
- `default`: no unattended execution assignment.
- No card may name a profile that is not present in `hermes profile list`.
- Every first-wave child needs exact scope, out-of-scope boundaries, Definition of Done, verification commands, and blocker/escalation rules.

Pass condition: all ready cards have an intentional assignee and execution-grade body; no vague audit/spec card is assigned to `worker-gemma`.

### Gate 5 — Define the first release lane

Do not make all 0.8 cards dispatchable. The first canonical lane should be:

1. **0.8-A1:** persisted analysis context/procedure-type contract.
2. **0.8-B0:** provenance/service-contract repair and process-complexity integration.
3. **0.8-B1:** mode-profile and evidence-contract design, after A1/B0.
4. A reviewer gate after the above, before any PDF, cost proxy, structure search, or broad route work.

Existing provenance, PMI, literature, mechanochemistry, route, and two-pass cards should be linked as dependencies or folded into these roots, not dispatched as parallel duplicate projects.

Pass condition: no more than 1–2 entry cards are `ready` for the first smoke test; downstream cards remain gated in `todo` until dependencies are done.

### Gate 6 — Sync safely

Before any live sync:

1. Run dry-run and inspect created cards, status changes, and metadata changes.
2. Refuse a sync that would revive blocked cards, overwrite runtime claims, or create a large unexplained status churn.
3. Use stable IDs for upsert, not title matching.
4. Prefer selective sync/import of the curated first-wave set over whole-backlog reconciliation.
5. Write a sync report with counts and conflicts.

Pass condition: a second dry-run is idempotent: zero unexpected creates, zero unexpected status changes, and zero unexpected orphan IDs.

### Gate 7 — Smoke-test execution

Only after Gates 1–6:

1. Keep embedded gateway dispatch disabled.
2. Allowlist only `green-chemistry-ai` in the external runner, if using it.
3. Run one real dispatch pass, not only a dry-run.
4. Verify the intended task gets a fresh run record and enters `running`.
5. Verify the worker workspace is the greenchemistry.ai repo.
6. Reclaim/stop it if routing is wrong.
7. Run one review handoff and verify blocked → approved → ready behavior.
8. Confirm no unrelated board receives work.

Pass condition: one complete root → bounded worker → review cycle works with auditable state transitions.

### Gate 8 — Resume conservative utility

Initial live settings:

- one active task per execution profile;
- one decomposition layer maximum;
- no automatic decomposition of children;
- no whole-board nightly dispatch;
- markdown sync at shift start/end only, not hourly;
- explicit board allowlist;
- weekly board integrity report;
- automatic repair jobs remain paused until the first manual cycle is stable.

## Definition of canonical utility

The board is canonical and usable when all are true:

- the active markdown and active Hermes set agree;
- every active card has stable identity;
- stale active orphans are archived or explicitly quarantined;
- graph residue is reduced to intentional dependencies;
- status semantics round-trip without reviving blocked work;
- assignees map to real profiles and bounded contracts;
- only the first release lane is dispatchable;
- one real dispatch/review smoke test passes;
- a repeat dry-run is idempotent;
- no automation can mutate this board unless explicitly allowlisted.

## What is not required before restoration

- Finishing every product task.
- Implementing GC.ai 0.8.
- Cleaning every archived historical card.
- Enabling unattended night work immediately.
- Making the entire 34-card markdown `Next` section dispatchable.

Board restoration is complete when the queue is trustworthy, bounded, auditable, and safe to use—not when the product backlog is empty.
