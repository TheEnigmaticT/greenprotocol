### 2026-05-19 Mobile landing page overflow came from grid min-content behavior, not just obvious wide elements
**Rule:** On custom CSS grid landing pages, set `min-width: 0` on grid children and verify any decorative float or rich-text block at phone width before shipping.
**Why:** A single grid child can force all tracks wider than the viewport via min-content sizing, which makes the whole section overflow even when the container itself is correctly sized.

### 2026-05-19 Mixed `c*` span classes and `cs*` start classes need explicit mobile full-span rules
**Rule:** When collapsing desktop grid columns on mobile, use `grid-column: 1 / -1` for mixed span/start helper classes instead of `span 12`.
**Why:** Elements that also carry `grid-column-start` helper classes can compute to start-only placement on mobile, collapsing into a narrow sliver even though the intent is full-width.

### 2026-09-04 Alert work must start from a synchronized GreenChemistry.ai checkout
**Rule:** Fetch and reconcile `main` with `origin/main` before inspecting, editing, or deploying alert code; stage only alert paths in the shared dirty checkout.
**Why:** GreenChemistry.ai receives parallel external pushes. Building from a stale local branch delayed the production alert rollout and made the source-of-truth boundary unclear.

### 2026-09-05 Delegation-loop recovery must produce serial implementation rather than more orchestration
**Rule:** After a delegation guardrail stops an authorized sprint, preserve its session, artifacts, review findings and spend boundary; continue direct serial RED/GREEN work without spawning more agents or raising limits. Mark changed scopes awaiting independent review, and checkpoint unfinished work as pending rather than requesting renewed blanket approval.
**Why:** Repeating orchestration consumes the bounded runtime without closing defects. A new executor is not a new budget or independent certification of its own changes.

### 2026-09-06 Operator-confirmed baseline provenance is sufficient to proceed
**Rule:** When the deployment owner explicitly confirms the production model, record that confirmation as provenance and proceed with the authorized comparison. Do not keep treating absent response metadata as a blocker or demand redundant verification.
**Why:** Repeating attribution caveats after the owner resolved them delays the actual end-to-end port without improving its chemistry or engineering quality.
