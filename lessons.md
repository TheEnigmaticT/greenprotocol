### 2026-05-19 Mobile landing page overflow came from grid min-content behavior, not just obvious wide elements
**Rule:** On custom CSS grid landing pages, set `min-width: 0` on grid children and verify any decorative float or rich-text block at phone width before shipping.
**Why:** A single grid child can force all tracks wider than the viewport via min-content sizing, which makes the whole section overflow even when the container itself is correctly sized.

### 2026-05-19 Mixed `c*` span classes and `cs*` start classes need explicit mobile full-span rules
**Rule:** When collapsing desktop grid columns on mobile, use `grid-column: 1 / -1` for mixed span/start helper classes instead of `span 12`.
**Why:** Elements that also carry `grid-column-start` helper classes can compute to start-only placement on mobile, collapsing into a narrow sliver even though the intent is full-width.

### 2026-09-04 Alert work must start from a synchronized GreenChemistry.ai checkout
**Rule:** Fetch and reconcile `main` with `origin/main` before inspecting, editing, or deploying alert code; stage only alert paths in the shared dirty checkout.
**Why:** GreenChemistry.ai receives parallel external pushes. Building from a stale local branch delayed the production alert rollout and made the source-of-truth boundary unclear.
