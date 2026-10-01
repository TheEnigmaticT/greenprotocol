# GreenChemistry.ai — Code Quality & Decomposition Review

**Scope:** `/Users/ct-mac-mini/dev/greenchemistry-ai` (Next.js/TypeScript app + Python `services/chemistry` microservice)
**Date:** September 4, 2026
**Method:** Static review — line/function-size scan across `app/`, `lib/`, `components/`, `services/chemistry/`, `tests/`; spot-read of the largest files; verification of what actually runs in CI.

## Bottom line

This is a better-than-average codebase for a small production app. It is **not** in "rewrite it" territory. TypeScript strict mode is on, there are essentially zero `any` types, almost no `eslint-disable` or `TODO` litter, and there's a real test suite (29 files, ~5,400 lines) including tests that exercise the core pipeline directly. That's genuinely disciplined for a project that's grown this fast.

The maintainability pain you're feeling is concentrated in a handful of specific files, not spread evenly through the codebase — which is good news, because it means targeted surgery fixes most of it. And there's one gap that undercuts everything else: **your test suite doesn't run in CI**, so the safety net that would let you refactor confidently isn't actually armed.

## The one fix to do first

`.github/workflows/ci-cd.yml` runs three steps on every push/PR: lint, typecheck, build. It never runs `npm test` (vitest), and it never runs the Python `pytest` suite in `services/chemistry` either. Both suites exist and both look reasonably useful — but right now a PR can delete half of `analyzeProtocol`'s logic, get a green checkmark, and merge, because nothing ever executed the tests that would have caught it.

This is a ten-minute config change and it's the highest-leverage thing on this list: every other recommendation below becomes much safer to act on once you have a real safety net. Add a `test` step (`npm run test`) to the existing job, and a separate step (or job) that runs `pytest` inside `services/chemistry`.

## Where the actual decomposition problems are

I scanned every file's size and, for the largest ones, mapped where the function/component boundaries actually fall (a big *file* full of small functions is fine — a big *file* that's one giant function is the real problem). Three spots stand out:

### 1. `lib/pipeline.ts` → `analyzeProtocol()` — the main offender

This single function is roughly **330 lines** and is the orchestrator for the entire protocol-analysis flow: parsing, chemical rationalization, deterministic scoring, LLM evaluation of all 12 principles, literature grounding, re-evaluation against evidence, deduplication, and final ranking — all inline, with nested `try/catch` blocks and conditionals at multiple depths. Two of its helper functions in the same file are also oversized: `deduplicateRecommendations` (~130 lines) and `reevaluateAllRecommendations` (~110 lines).

Why this is the thing to fix: it's tested, but only end-to-end (`tests/lib/pipeline-ranking.test.ts` calls `analyzeProtocol()` as a black box). You can't unit-test "does the dedup step work" independently of "does parsing work" — every change to any phase risks a full integration-test failure with a stack trace that doesn't point at the actual broken phase. This is exactly the shape of problem that makes adding a feature feel scary: you're never sure what else lives inside that function that your change might touch.

**Fix:** split each commented "Phase N" block into its own named, exported function — `parsePhase`, `rationalizeAndScorePhase`, `evaluatePhase`, `groundInLiteraturePhase`, `reevaluatePhase`, `rankPhase` — each taking explicit inputs and returning explicit outputs (no shared mutable state between phases). `analyzeProtocol` then becomes a short function that just calls them in sequence — arguably under 40 lines. Each phase becomes independently unit-testable, and a bug in "dedup" now fails a dedup test, not a 300-line integration test.

### 2. `components/TalkAboutThis.tsx` — 790 lines, 13+ separate `useState` calls

This is the chat widget. One good sign: `handleComposerKeyDown` is already pulled out as a standalone, testable function rather than buried inline — that's the right instinct. But the main component itself tracks 13 independent pieces of state (`conversationId`, `isOpen`, `isStarting`, `isSending`, `error`, `messages`, `draft`, `activities`, `notifyOnReady`, `approvalReceipt`, `evidenceReceipts`, `approvalReceivedAt`, `conversationDisposition`, `verificationNotes`...). With that many `useState` calls in one place, it's easy for two of them to silently drift out of sync (e.g., `isSending` staying `true` after an error path forgets to reset it), and every new feature means adding yet another state variable to an already-long list.

**Fix:** pull the conversation state into a custom hook (`useTalkAboutThisConversation`) or a `useReducer` with named actions (`MESSAGE_SENT`, `APPROVAL_RECEIVED`, etc.) so state transitions are named and centralized instead of scattered `setX` calls. Then split the JSX itself into 3–4 subcomponents (message list, composer, receipts/verification panel) so each piece can be read and changed without scrolling through the whole file.

### 3. `app/page.tsx` — 1,022 lines, but a milder case

This is your landing page, and almost all of its size is JSX markup, not logic — the component itself only has two pieces of state and two effects. This is a lower-urgency issue than the two above (it's not where bugs hide), but it's still the kind of file where "I just want to tweak the hero copy" means scrolling past 900 lines of unrelated sections. Worth breaking into section subcomponents (`Hero`, `Showcase`, `Features`, `Footer`) mainly for editing convenience, not correctness.

## One structural smell worth naming: data baked into code

`lib/chemicals.ts` (1,310 lines) is a hardcoded array of 50 chemicals with hazard data, LCA estimates, and green-alternative suggestions — literally written as a TypeScript literal in source. That's a fine way to start a prototype. For a production app with real users, it has real costs: updating a single chemical's data requires a code change, a PR, a review, and a deploy; there's no way to version or audit data changes separately from code changes; and a single typo in a 1,300-line literal is a syntax error that breaks the whole app, not a bad data row. Since you already have Supabase in the stack, this is a natural candidate to move into a table (or at minimum a JSON file loaded at startup) — same for anything similarly shaped elsewhere in `lib/`.

## What's genuinely fine — don't let this list read as "everything's bad"

- `lib/talk-about-this/agent.ts` (680 lines) is actually a *good* example in this codebase: lots of small, single-purpose functions (`requireString`, `requireFiniteNumber`, `parseArguments`, `fingerprint`, `failureResult`...) doing one validation job each. This is the pattern to replicate elsewhere, not a problem file.
- The Python side (`services/chemistry`) is in decent shape — largest file is 543 lines, nothing near the `analyzeProtocol` situation. (Separately, I found in reviewing PR #3 that its `docker-compose.yml` is missing the new `OPENROUTER_API_KEY` passthrough — unrelated to decomposition, but worth fixing alongside.)
- Zero `any` types, one `eslint-disable` in the whole `app/lib/components` tree, zero `TODO`/`FIXME` markers. That's unusually clean — most codebases this size have dozens of each.

## Lower-priority repo hygiene

- `.worktrees/` is currently 235MB of (presumably stale) git worktrees sitting in the repo folder. Not a code-quality issue, but worth pruning (`git worktree list` → `git worktree remove` the ones you're done with).
- The repo root has 22 loose report/briefing files (`briefing-2026-08-21.md`, `ai_briefing_canonical_blocks.json`, etc.) plus an 89KB `BACKLOG.md`. Consider corralling the briefing/log files into a `notes/` or `docs/logs/` subfolder, and periodically archiving completed items out of `BACKLOG.md` into a dated archive file so the live backlog stays scannable.

## Recommended order of operations

1. **Wire the test suites into CI** (`npm run test` + `pytest` for `services/chemistry`). Do this before touching anything else — it's what makes every step below safe.
2. **Split `analyzeProtocol`** into named phase functions. This is the biggest maintainability win in the codebase.
3. **Extract `TalkAboutThis.tsx`'s state** into a hook/reducer and split its JSX into subcomponents.
4. **Break up `app/page.tsx`** into section components (quick, low-risk, mostly for editing convenience).
5. **Move `lib/chemicals.ts`'s data** out of source code and into a data file or Supabase table.
6. Repo hygiene sweep: prune `.worktrees`, corral the briefing/log files, archive stale `BACKLOG.md` items.

Happy to actually do the `analyzeProtocol` split with you next — that's the one where having a second pair of hands (and a green test suite watching your back) matters most.
