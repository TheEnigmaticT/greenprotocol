# 0.8.0 Mobile Laboratory Workflow Specification

**Status:** proposed release scope

**Goal:** let an authenticated scientist use GC.ai at a lab bench to submit a protocol, understand analysis state, make one defensible recommendation decision, inspect supporting evidence, and recover from a degraded response on a 375px or 430px phone without horizontal scrolling.

**Product thesis:** This is not a mobile redesign. It is a narrow, high-consequence workflow layer for a scientist who needs the next safe action while standing at an experiment. The phone surface should make *state, evidence, and decision* legible before it makes the entire desktop report available.

## Evidence and current-state basis

- DSV explicitly described the phone experience as “awful” and wanted a usable lab-station interaction: review recommendations and ask why a substitution should change when circumstances change.
- DSV also experienced streamed analyses ending unexpectedly, missing grades, and partial outputs. Mobile must explain which part failed and preserve the scientist’s work; a generic terminal stream error is not sufficient.
- The app already has responsive building blocks: stacked recommendation/pending cards, a mobile Evidence Atlas drawer, recovery panels, and 375/430px as the backlog acceptance widths.
- The core result page is not yet organized around a phone decision loop. It presents scorecard, recommendation review, impact, and scale-up as a long report. Existing `AnalysisResults.tsx` is not currently rendered by either analysis route; `FinalizedProtocol.tsx` is the live decision surface.
- The existing scoped `TalkAboutThis` feature is already rendered from live recommendation surfaces. The post-0.8 card remains the correct place for expanding agent capability; 0.8 only keeps the current action usable and correctly scoped on a phone.

## 0.8.0 scope

### 1. Input: a deliberate start state

**Surface:** `app/analyze/page.tsx`, `components/ProtocolInput.tsx`

- Keep protocol paste/edit as the primary phone action. The textarea must be readable at 16px minimum to prevent iOS zoom and preserve a 44×44px target for examples, submit, and retry actions.
- Preserve entered text after validation, network, authentication, or stream failure. Never clear the protocol until a result is saved to the existing session flow.
- Use one compact source choice area only: paste/edit, then optional examples. Do not introduce camera capture, document import, ELN selection, or a procedure-type wizard in 0.8.0.
- On submit, lock duplicate submission, retain the protocol in view, and make the next state explicit.

### 2. Analysis: a truthful, bench-readable progress state

**Surface:** `components/ProtocolInput.tsx`; replace/generalize `components/AnalysisSkeleton.tsx` only if it becomes the shared progress surface.

- Replace the current decorative rotating quips/spinner emphasis with a state-based progress presentation: `Submitting protocol` → `Checking chemistry data` → `Calculating deterministic scores` → `Preparing recommendations` → `Saving analysis`.
- Display completed/total only when it maps to actual durable pipeline work. Do not imply a percentage is scientifically meaningful when the server has not supplied one.
- Keep the progress card in the normal document flow, with protocol text accessible above it. No modal, full-screen lockout, or indefinite animation.
- On loss of the event stream, show a named state: “Analysis connection ended before completion.” Preserve the draft and offer: `Try again`, `Return to protocol`, and, if an analysis ID exists, `Open saved partial analysis`.
- For missing deterministic scoring, retain the existing `DeterministicScoreRecovery` disclosure but add a concise status explanation, retry state, and analysis reference/correlation ID when the backend supplies it. It must distinguish: score unavailable; recommendations may still be present; retry has not changed the existing analysis.

### 3. Results: a single recommendation decision loop first

**Surfaces:** `app/analyze/[id]/page.tsx`, `app/analyze/page.tsx`, `components/FinalizedProtocol.tsx`, `components/ScoreCard.tsx`, `components/ChemistryDataNotice.tsx`

At phone widths, the first usable result screen must follow this order:

1. analysis title plus a compact evidence/status badge;
2. score status, including the honest unavailable/deferred state where applicable;
3. `Recommendations to review` with count and the highest-priority pending card;
4. one recommendation card with original condition, recommended change, caveat, evidence state, and actions;
5. a persistent but unobtrusive `Back to recommendations`/next-pending affordance after a decision.

- Keep accept and decline distinct, equal-weight, adjacent actions. Do not hide decline in a menu, make acceptance destructive, or add bulk-accept to the phone-primary flow.
- A decision must receive immediate local confirmation and then a quiet saving state. If persistence fails, keep the chosen state visible, mark it “not yet saved,” and give a retry/reload-safe instruction. Do not report success before the existing PATCH returns.
- “Talk about this” remains a secondary action. It must open as a bottom sheet or full-height mobile panel with a clear close control, explicit selected-recommendation context, no nested scrolling trap, and no claim that discussion has changed the protocol.
- Keep ScoreCard, impact, scale-up, print, and full procedure as secondary sections behind clear section headings or compact expanders. They remain reachable but cannot push the first pending decision beyond a long report on initial render.

### 4. Evidence Atlas: inspect one claim without losing place

**Surfaces:** `app/analyze/[id]/evidence/page.tsx`, `components/EvidenceAtlas.tsx`, `components/EvidenceSidebar.tsx`, `components/PrincipleSection.tsx`

- Preserve the existing mobile drawer navigation, but make the top header unambiguous: close/back to analysis, current analysis title, and the Atlas menu control must not overlap.
- Convert the `Chemicals of Concern` desktop table to a stacked, labeled record layout below 640px, or place its table in an explicit horizontally scrollable region with an accessible caption and visual affordance. It must not expand the page width.
- A recommendation’s evidence action should land on its relevant principle/anchor, then return to the same recommendation state through a stable back link or preserved scroll position.
- Every evidence item on a phone must keep its provenance state visible: calculated, declared, benchmark-derived, model-inferred, deferred, unavailable, or no result. Citation text/DOIs must wrap or truncate with an intentional reveal; no long scientific identifier may force viewport overflow.

### 5. Network and source degradation: recoverable rather than vague

**Surfaces:** `components/ChemistryDataNotice.tsx`, `components/DeterministicScoreRecovery.tsx`, analysis routes, source-status UI introduced by the ingestion lane.

- Use the release-wide status taxonomy: available, searching, queued/deferred (with next retry if known), partially available, unavailable, unauthorized, no results, and failed.
- Never represent unavailable/deferred data as `not found`, and never show a final grade when the deterministic path has failed.
- Provide a human-readable error plus a stable analysis/job reference that support can locate. Never show provider secrets, raw payloads, or stack traces.
- Mobile recovery must work with intermittent connectivity: buttons have disabled/in-flight states, duplicate submissions are prevented, and retry does not discard existing saved analysis/recommendation decisions.

## Interaction and visual rules

- Keep the existing field-notebook system: cream ground, forest controls, gold only for meaningful state/progress, Libre Baskerville for prose, IBM Plex Mono for protocol/data labels. Do not introduce a separate mobile palette or generic app-shell chrome.
- Use the established 24px mobile page margin where possible. Card padding may compress to 16px, but type and touch targets do not.
- Targets for primary actions, drawer toggle, close controls, tabs, filters, and accept/decline controls: at least 44×44 CSS px, with visible focus states. Small metadata badges are not targets.
- No critical horizontal overflow at 375px or 430px. Long chemical names, DOI strings, protocol text, and status messages must wrap/truncate intentionally. Apply `min-width: 0` to flex/grid children containing unbounded strings.
- Use calm mechanical feedback: a 1–2px press compression for decision buttons; a short status transition when a decision saves; and directional/state-based shimmer only while known analysis work is active. Respect `prefers-reduced-motion`. No decorative infinite spinners, card-lift choreography, or parallax.
- Preserve keyboard and screen-reader parity: semantic buttons, `aria-expanded` for disclosure, labelled drawers, focus moved into and returned from a mobile sheet/drawer, live region for progress and request errors, and no hover-only explanation.

## Explicit non-goals

- A wholesale desktop/mobile visual redesign, new navigation taxonomy, or new design system.
- Full ELN flows, camera/OCR/PDF capture, offline analysis, or a standalone mobile app.
- Automatic acceptance, automatic rescore, source write-back, or automatic procedure mutation.
- New context-aware scientific-agent capabilities beyond the existing scoped conversation/action.
- Broad Evidence Atlas information architecture redesign or removal of detailed scientific reporting.

## Delivery slices

1. **Protect the existing path:** audit both live analysis routes and Evidence Atlas at 375px/430px; fix width/target/focus failures and add stable test fixtures.
2. **Make progress and failure truthful:** introduce the named progress and recovery states, preserve draft/session data, and wire correlation IDs/status taxonomy when APIs expose them.
3. **Put the decision loop first:** mobile results ordering, one-card review, explicit save feedback, and a phone-safe scoped discussion panel.
4. **Finish evidence traversal:** small-screen chemicals layout, deep-link/return behavior, provenance and identifier wrapping.
5. **Lock the release gate:** Playwright phone tests plus one manual lab-bench acceptance pass on an actual iPhone-class browser and a low-connectivity simulation.

## Release acceptance criteria

At Playwright viewports **375×812** and **430×932**, with synthetic/sanitized fixtures:

- An authenticated user can paste/edit a protocol, submit once, see named progress, and retain the draft after validation error, request failure, or unexpected stream end.
- A completed/saved analysis renders without document-level horizontal overflow. A long chemical name, DOI, title, and error message do not create overflow.
- A user can find the highest-priority pending recommendation without traversing scorecard/impact/scale-up sections; inspect original condition, alternative, caveat, and evidence state; accept or decline; and see success only after persistence or a clearly visible unsaved/retry state.
- A score/data failure distinguishes deterministic scoring unavailable from source evidence deferred/unavailable and exposes a safe retry without changing the prior analysis unexpectedly.
- A user can open the scoped discussion from a recommendation, identify the selected context, close it with keyboard/touch, and return to the same recommendation. The test must verify no automatic accept/rescore/procedure mutation occurs.
- A user can open Evidence Atlas, navigate to a linked principle, inspect provenance/citation content, return to the analysis, and continue review. The mobile drawer is keyboard operable and cannot trap focus.
- Targeted `vitest`, `npm run lint`, `tsc --noEmit`, production build, and the new Playwright mobile suite pass. Existing lint warnings may remain only if unchanged and explicitly recorded; no new warnings/errors.
- A manual actual-device pass validates touch target comfort, iOS text zoom behavior, browser back navigation, and a temporary network loss/retry path.

## Primary implementation touchpoints

- `app/analyze/page.tsx`
- `app/analyze/[id]/page.tsx`
- `app/analyze/[id]/evidence/page.tsx`
- `components/ProtocolInput.tsx`
- `components/FinalizedProtocol.tsx`
- `components/DeterministicScoreRecovery.tsx`
- `components/ChemistryDataNotice.tsx`
- `components/EvidenceAtlas.tsx`
- `components/EvidenceSidebar.tsx`
- `components/PrincipleSection.tsx`
- `components/TalkAboutThis.tsx`
- `tests/e2e/mobile-laboratory-workflow.spec.ts` (create once the Sentinel runner owns the E2E layout)

## Backlog hygiene decision

Keep **0.8.0 UX: Mobile laboratory workflow** as the release card. Fold the older generic **UI: Mobile viewport improvements** into it as historical context rather than running both. Do not pull the post-0.8 `Talk about this` expansion into this release: the UI action exists today; 0.8 validates its mobile containment and preserves its decision boundary.
