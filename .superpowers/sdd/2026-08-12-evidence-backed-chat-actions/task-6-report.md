# Task 6 report

## TDD

- **RED:** `npm test -- tests/lib/talk-about-this/activity.test.ts` failed as expected for the new literature evidence label and missing `evidenceFromEvent` / `approvalFromEvent` helpers. The first RED run also exposed an incomplete test import, corrected before implementation.
- **GREEN:** `npm test -- tests/lib/talk-about-this/activity.test.ts` passed: 1 file, 21 tests.

## Files

- `components/TalkAboutThis.tsx`
  - Whitelists and validates structured literature-evidence SSE payloads before rendering source ID, title, pages, quote, literal status, applicability, limitations, and retrieval time.
  - Renders `Candidate evidence` only when the persisted structured status is exactly `candidate`; other structured statuses are labeled `Adjudicated evidence`.
  - Validates stable recommendation approval receipts, suppresses duplicate action IDs, displays receipt ID/revision/time, and calls the parent only for valid matching receipts.
  - Adds focus-on-open, Escape-to-close, and a synchronous duplicate-send guard.
  - Shows the explicit `approve this` instruction only for stable recommendation scopes.
- `components/AnalysisResults.tsx`
  - Adds a Talk About This action beside the Evidence Atlas action.
- `tests/lib/talk-about-this/activity.test.ts`
  - Adds literature activity/evidence validation and stable approval identity coverage.

`components/FinalizedProtocol.tsx` already had the required Talk About This control beside Accept/Decline and passed the parent approval callback; it required no change.

## Verification

```text
npm test -- tests/lib/talk-about-this/activity.test.ts
1 file passed, 21 tests passed

npx tsc --noEmit
exit 0
```

## Commit

`80171b3 feat: render evidence and scoped approval receipts`

## Self-review and concerns

- Candidate evidence is not presented as experimentally verified; it retains status, pages, quote, applicability, and limitations.
- Approval state is driven by a validated server receipt rather than the existing debounced PATCH path.
- Focused unit/type checks passed. No browser smoke test was run because this UI requires an authenticated analysis and the scoped chat backend configuration; the component-level contract is covered by the focused test and TypeScript check.

## Corrective UI review (2026-08-12)

- **RED:** `npm test -- tests/lib/talk-about-this/activity.test.ts` ran 25 tests with 5 expected failures: malformed optional evidence fields passed validation, and the candidate receipt, scope instruction, and P1 Atlas rendering contracts were absent. The initial JSX-in-`.ts` test parse error was corrected before the behavioral RED run.
- **GREEN:** `npm test -- tests/lib/talk-about-this/activity.test.ts` passed: 1 file, 25 tests. `npx tsc --noEmit` exited 0.
- `components/TalkAboutThis.tsx` now treats the persisted `candidate_pending_adjudication` status as Candidate evidence (while rendering the literal status), rejects malformed optional text fields before React rendering, and exposes the actual receipt/instruction UI to focused server-rendered component tests.
- `components/AnalysisResults.tsx` labels the Atlas chat entry as P1, makes its content scope explicit, and derives its evidence state solely from citations attached to P1-scoped recommendations.
- `tests/lib/talk-about-this/activity.test.ts` adds server-rendered component assertions for candidate status, optional payload guards, stable vs. non-stable scope instructions, and P1 Atlas scope/evidence state. React DOM is already installed; jsdom/testing-library are not, so server rendering is the least-indirect available component harness.
- **Concern:** Browser interaction tests for focus/Escape and duplicate receipt delivery remain infeasible with the installed Node-only Vitest environment. Existing focused behavior tests cover receipt validation/rejection; production code retains focus-on-open, Escape-to-close, and action-ID deduplication.

## Closed-dialog conversation-open error repair (2026-08-12)

- **Root cause:** The failed conversation-open request sets `error` without opening the dialog, but the error was only rendered inside the `isOpen` dialog branch.
- **RED exact output:**

```text
❯ tests/lib/talk-about-this/activity.test.ts (26 tests | 1 failed) 22ms
     × renders a failed conversation-open request as an accessible alert while the dialog is closed 3ms

FAIL  tests/lib/talk-about-this/activity.test.ts > closed conversation-open errors > renders a failed conversation-open request as an accessible alert while the dialog is closed
AssertionError: expected undefined to be type of 'function'

Expected: "function"
Received: "undefined"

Test Files  1 failed (1)
     Tests  1 failed | 25 passed (26)
```

- **GREEN exact output:**

```text
> greenchemistry-ai@0.6.0 test
> vitest run tests/lib/talk-about-this/activity.test.ts


 RUN  v4.1.7 /Users/ct-mac-mini/dev/greenchemistry-ai/.worktrees/evidence-backed-chat


 Test Files  1 passed (1)
      Tests  26 passed (26)
   Start at  16:46:53
   Duration  260ms (transform 74ms, setup 0ms, import 176ms, tests 19ms, environment 0ms)
```

- `npx tsc --noEmit` completed successfully with no output (exit 0).
- `components/TalkAboutThis.tsx` renders the existing failure message as `role="alert"` immediately after the launcher only while the dialog is closed; the open dialog retains its current error rendering.
- `tests/lib/talk-about-this/activity.test.ts` server-renders that closed state and verifies both alert semantics and message visibility.
