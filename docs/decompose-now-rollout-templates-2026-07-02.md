# GreenChemistry.ai decompose-now rollout templates — 2026-07-02

- Scope: the 13 ready cards already classified as `decompose now`
- Goal: give each root a safe one-level decomposition template before any automated fan-out resumes
- Policy: root -> bounded child leaves only; children do not auto-decompose

## Global rules

- Max 2–5 child cards per root.
- Any child assigned to `worker-gemma` must name exact files/surfaces and a concrete verification step.
- Any child that still reads like research/spec/audit stays on orchestrator or becomes a fresh triage card.
- When the root wakes, it may close, block precisely, or create one fresh triage follow-up; it may not decompose again.

## t_ce70f5ed — UI: Clean up zinc/Tailwind colors in Evidence Atlas route

Suggested child tasks:

1. **Audit remaining non-token classes in target files** — assignee: `orchestrator`
   - Scope: Search `app/analyze/[id]/page.tsx`, `EvidenceAtlas.tsx`, and `PrincipleSection.tsx` for `bg-zinc-*`, `bg-green-*`, `bg-yellow-*`, `bg-red-*`; record exact class occurrences and the matching design-token replacements.
   - Done when: Existing code search only; establishes exact edit surface.
2. **Replace page-level zinc styling in analyze route** — assignee: `worker-gemma`
   - Scope: Edit `app/analyze/[id]/page.tsx` to replace remaining zinc/dark card styles with existing brand tokens.
   - Done when: Run grep for `zinc-` in the file and confirm zero hits.
3. **Replace semantic colors in Evidence Atlas components** — assignee: `worker-gemma`
   - Scope: Edit `EvidenceAtlas.tsx` and `PrincipleSection.tsx` to replace semantic Tailwind color classes with the project token system.
   - Done when: Run grep for `bg-green-`, `bg-yellow-`, `bg-red-`, `bg-zinc-` in those files and confirm zero hits.
4. **Review visual consistency of updated Atlas surfaces** — assignee: `reviewer`
   - Scope: Read the changed files/diffs and confirm the replacements are consistent with the existing design system.
   - Done when: Reviewer signs off or leaves precise follow-up blockers.

Gemma-eligible leaves: Replace page-level zinc styling in analyze route, Replace semantic colors in Evidence Atlas components

## t_c298edc0 — UI: New Analysis no save/share before clearing

Suggested child tasks:

1. **Locate confirmation dialog and saved-analysis state path** — assignee: `orchestrator`
   - Scope: Find the New Analysis clear-confirmation flow, identify where analysis IDs are available, and note the exact component/API surfaces involved.
   - Done when: Names the exact component and state source for the implementation leaves.
2. **Add Copy link action to saved-analysis clear dialog** — assignee: `worker-gemma`
   - Scope: Implement a conditional `Copy link` action in the confirmation dialog when the current analysis has a persistent ID.
   - Done when: UI shows Copy link only for saved analyses.
3. **Add test coverage for copy-link behavior** — assignee: `worker-gemma`
   - Scope: Add or update tests for saved vs unsaved analysis dialog behavior.
   - Done when: Relevant test command passes for the touched area.
4. **Review UX wording and edge cases** — assignee: `reviewer`
   - Scope: Check that the dialog wording and branching remain clear for unsaved analyses and for analyses with a shareable link.
   - Done when: Reviewer signs off or requests a bounded follow-up.

Gemma-eligible leaves: Add Copy link action to saved-analysis clear dialog, Add test coverage for copy-link behavior

## t_2d06b3cc — UI: Analysis page view toggle matches filter bar style

Suggested child tasks:

1. **Inspect current toggle and filter-tab implementation** — assignee: `orchestrator`
   - Scope: Identify the current components/styles for the Full Analysis / Quick Wins toggle and the filter bar styling to mirror.
   - Done when: Exact component names and style approach documented.
2. **Replace toggle pill with tab-style control** — assignee: `worker-gemma`
   - Scope: Implement a tab-style toggle with a bottom-border active indicator matching the filter tabs.
   - Done when: New control renders and matches the intended visual language.
3. **Verify active/inactive states and keyboard behavior** — assignee: `worker-gemma`
   - Scope: Check interaction states for the new tabs and ensure no regressions in toggle behavior.
   - Done when: Behavior still switches views correctly.
4. **Review visual parity with filter bar** — assignee: `reviewer`
   - Scope: Compare the updated toggle against the filter tabs and confirm they read as one control system.
   - Done when: Reviewer signs off or requests a bounded style fix.

Gemma-eligible leaves: Replace toggle pill with tab-style control, Verify active/inactive states and keyboard behavior

## t_716ba86e — UI: Analysis page radius standardization

Suggested child tasks:

1. **Audit radius usage in analysis-page components** — assignee: `worker-gemma`
   - Scope: Enumerate where `rounded-xl`, `rounded-lg`, `rounded-full`, and `rounded` appear in the analysis-page surface.
   - Done when: A concrete file/class inventory exists.
2. **Normalize card and button radius classes** — assignee: `worker-gemma`
   - Scope: Update cards/buttons on the analysis page to the chosen radius system: cards 8px, buttons 4px, pills 9999px.
   - Done when: Changed components use only approved radius values.
3. **Verify no stray radius classes remain in scope** — assignee: `worker-gemma`
   - Scope: Search the touched analysis-page files for disallowed radius variants.
   - Done when: Search results confirm only approved radius classes remain.
4. **Review consistency against design system** — assignee: `reviewer`
   - Scope: Read the diffs and confirm the normalized radii are applied consistently.
   - Done when: Reviewer signs off or leaves a narrow fix list.

Gemma-eligible leaves: Audit radius usage in analysis-page components, Normalize card and button radius classes, Verify no stray radius classes remain in scope

## t_6b89852b — UI: Evidence Atlas P1 waste section density

Suggested child tasks:

1. **Map current P1 section layout and metric groups** — assignee: `orchestrator`
   - Scope: Identify which metric grids should stay visible by default and which should collapse behind a breakdown affordance.
   - Done when: Exact default vs collapsed content list documented.
2. **Implement collapsible lower-detail breakdown** — assignee: `worker-gemma`
   - Scope: Add a Show breakdown control and move liquid/process burden grids behind it.
   - Done when: Default view shows only top-line content; expanded view reveals details.
3. **Preserve existing data rendering in collapsed mode** — assignee: `worker-gemma`
   - Scope: Ensure no metrics disappear permanently and the expand/collapse logic preserves current values.
   - Done when: Expanded state still renders all prior detail content.
4. **Review information hierarchy and readability** — assignee: `reviewer`
   - Scope: Confirm the default P1 view now emphasizes the primary waste takeaway without losing access to detail.
   - Done when: Reviewer signs off or leaves a bounded UX refinement.

Gemma-eligible leaves: Implement collapsible lower-detail breakdown, Preserve existing data rendering in collapsed mode

## t_ba32202a — UI: Restore per-recommendation anchor links into Evidence Atlas

Suggested child tasks:

1. **Map recommendation cards to Atlas section identifiers** — assignee: `orchestrator`
   - Scope: Identify the stable mapping from recommendation cards/principles to Evidence Atlas anchors.
   - Done when: A clear mapping contract exists for implementation.
2. **Add stable anchor IDs to Atlas sections** — assignee: `worker-gemma`
   - Scope: Implement or normalize section anchors on the Evidence Atlas side.
   - Done when: Atlas sections expose stable anchor IDs.
3. **Add deep links from recommendation cards** — assignee: `worker-gemma`
   - Scope: Wire recommendation-card links to the correct Atlas anchors.
   - Done when: Clicking a recommendation opens the matching Atlas section.
4. **Review link correctness and fallback behavior** — assignee: `reviewer`
   - Scope: Confirm the mapping is correct and degraded states are handled sanely if an anchor is unavailable.
   - Done when: Reviewer signs off or leaves an exact fix.

Gemma-eligible leaves: Add stable anchor IDs to Atlas sections, Add deep links from recommendation cards

## t_8476eda4 — UI: Surface numeric PMI with provenance in results and Evidence Atlas

Suggested child tasks:

1. **Locate PMI source fields and provenance derivation path** — assignee: `orchestrator`
   - Scope: Trace where numeric PMI and provenance are produced or can be derived in the pipeline/result model.
   - Done when: Implementation leaves receive the exact data contract.
2. **Expose PMI + provenance in result view model** — assignee: `worker-gemma`
   - Scope: Update the relevant server/client model layers so numeric PMI and provenance state are available to the UI.
   - Done when: Required fields are available in the UI layer.
3. **Render PMI + provenance in main results** — assignee: `worker-gemma`
   - Scope: Show numeric PMI and provenance in the main analysis results surface.
   - Done when: Results view visibly shows PMI and provenance state.
4. **Render PMI + provenance in Evidence Atlas** — assignee: `worker-gemma`
   - Scope: Show the same PMI + provenance information in the Atlas with benchmark/calculation context.
   - Done when: Atlas also shows the same information consistently.
5. **Review consistency across both surfaces** — assignee: `reviewer`
   - Scope: Check wording, consistency, and whether the provenance presentation matches scientific expectations.
   - Done when: Reviewer signs off or leaves a bounded copy/UX fix.

Gemma-eligible leaves: Expose PMI + provenance in result view model, Render PMI + provenance in main results, Render PMI + provenance in Evidence Atlas

## t_f4c9c486 — UI: Confidence bars for declared vs inferred vs benchmark-derived scoring inputs

Suggested child tasks:

1. **Define minimal confidence/provenance presentation contract** — assignee: `orchestrator`
   - Scope: Specify the minimal states and where they should render first, without trying to solve the whole product at once.
   - Done when: A first-slice rendering contract exists.
2. **Expose provenance state to score UI components** — assignee: `worker-gemma`
   - Scope: Thread the needed provenance/status values into the score UI component props/model layer.
   - Done when: Components can access provenance state.
3. **Implement confidence/provenance indicators on key score surfaces** — assignee: `worker-gemma`
   - Scope: Render the first-slice indicators for the most important score outputs.
   - Done when: Indicators appear on the targeted score surfaces.
4. **Add drill-down or helper copy for interpretation** — assignee: `worker-gemma`
   - Scope: Add concise explanatory text or tooltip/detail treatment so users can interpret the indicators.
   - Done when: Users can understand what the indicator states mean.
5. **Review scientific clarity and consistency** — assignee: `reviewer`
   - Scope: Check that the indicators are interpretable and consistent with the provenance taxonomy direction.
   - Done when: Reviewer signs off or leaves bounded follow-up.

Gemma-eligible leaves: Expose provenance state to score UI components, Implement confidence/provenance indicators on key score surfaces, Add drill-down or helper copy for interpretation

## t_7028b7fa — Audit: Pipeline process trace

Suggested child tasks:

1. **Specify trace-table schema and insertion points** — assignee: `orchestrator`
   - Scope: Confirm the exact schema for `gpc_analysis_traces` and `gpc_dedup_log`, plus where the writes belong in the pipeline.
   - Done when: Implementation leaves get exact schema + hook points.
2. **Add schema/migrations for trace and dedup logs** — assignee: `worker-gemma`
   - Scope: Create or update the schema layer for per-call trace rows and dedup log rows.
   - Done when: Schema exists and is loadable by the app.
3. **Persist per-call traces in the LLM call path** — assignee: `worker-gemma`
   - Scope: Instrument the call helper to store model/tokens/latency/request-response trace metadata.
   - Done when: Trace rows are written during analysis execution.
4. **Persist pre-dedup recommendation merge log** — assignee: `worker-gemma`
   - Scope: Record pre-dedup recommendation state and merge-map information during dedup.
   - Done when: Dedup log rows are written with usable structure.
5. **Review trace usefulness and cost sanity** — assignee: `reviewer`
   - Scope: Confirm the stored data is sufficient for debugging/forensics without obvious waste.
   - Done when: Reviewer signs off or leaves a bounded refinement.

Gemma-eligible leaves: Add schema/migrations for trace and dedup logs, Persist per-call traces in the LLM call path, Persist pre-dedup recommendation merge log

## t_bfbf3567 — Qwen: Local endpoint configuration

Suggested child tasks:

1. **Choose first local serving path and config contract** — assignee: `orchestrator`
   - Scope: Decide the first supported path (Ollama or vLLM first) and the minimum config knobs needed.
   - Done when: Implementation leaves know the exact target path.
2. **Document/start local Qwen serving command** — assignee: `worker-gemma`
   - Scope: Add the startup/config instructions for the chosen local serving path.
   - Done when: A local Qwen model can be started reproducibly.
3. **Wire pipeline config to local endpoint variables** — assignee: `worker-gemma`
   - Scope: Ensure the pipeline reads the local endpoint/model configuration cleanly.
   - Done when: Pipeline can target the local endpoint via config/env.
4. **Verify a real local inference path** — assignee: `worker-gemma`
   - Scope: Run a real or minimal verification that confirms the pipeline can hit the local endpoint.
   - Done when: Verification evidence shows the route works or blocks precisely.
5. **Review docs and operational sanity** — assignee: `reviewer`
   - Scope: Check that startup instructions and verification evidence are sufficient for reuse.
   - Done when: Reviewer signs off or leaves exact gaps.

Gemma-eligible leaves: Document/start local Qwen serving command, Wire pipeline config to local endpoint variables, Verify a real local inference path

## t_7ebb66cf — Qwen: Validate structured output schemas

Suggested child tasks:

1. **Define exact schema test cases for parse/evaluate/assemble** — assignee: `orchestrator`
   - Scope: Identify the exact schema obligations to test in the Qwen path.
   - Done when: Validation leaves have a concrete test matrix.
2. **Validate parse-stage structured output** — assignee: `worker-gemma`
   - Scope: Run/inspect the parse stage against the required schema outputs.
   - Done when: Evidence shows parse either conforms or fails precisely.
3. **Validate evaluate-stage structured output** — assignee: `worker-gemma`
   - Scope: Run/inspect the evaluate stage against the schema obligations.
   - Done when: Evidence shows evaluate either conforms or fails precisely.
4. **Validate assemble-stage structured output** — assignee: `worker-gemma`
   - Scope: Run/inspect the assemble stage against the schema obligations.
   - Done when: Evidence shows assemble either conforms or fails precisely.
5. **Synthesize compatibility result** — assignee: `reviewer`
   - Scope: Combine the stage results into a clear compatibility verdict or blocker report.
   - Done when: Reviewer produces a final yes/no/blocker conclusion.

Gemma-eligible leaves: Validate parse-stage structured output, Validate evaluate-stage structured output, Validate assemble-stage structured output

## t_d28f8da8 — Qwen: Benchmark vs Claude Sonnet

Suggested child tasks:

1. **Define benchmark protocol and comparison rubric** — assignee: `orchestrator`
   - Scope: Pin the exact workflow, prompts, metrics, and artifact expectations for the comparison.
   - Done when: Execution leaves have an exact benchmark contract.
2. **Run and record Qwen benchmark series** — assignee: `worker-gemma`
   - Scope: Execute the Qwen-side benchmark run(s) and capture artifacts/results.
   - Done when: A reusable artifact tree or exact blocker report exists.
3. **Normalize and compare against Claude Sonnet baseline** — assignee: `worker-gemma`
   - Scope: Compare Qwen outputs/results against the existing Claude Sonnet benchmark baseline.
   - Done when: A direct comparison table or summary exists.
4. **Review recommendation and caveats** — assignee: `reviewer`
   - Scope: Produce the benchmark verdict with tradeoffs and operational caveats.
   - Done when: Reviewer signs off on the comparison result.

Gemma-eligible leaves: Run and record Qwen benchmark series, Normalize and compare against Claude Sonnet baseline

## t_e9475e3e — Retrieval: Backlogged data retrieval from Sci-Hub

Suggested child tasks:

1. **Identify exact backlog subset and access assumptions** — assignee: `orchestrator`
   - Scope: Define the initial subset of papers/gaps to target and the expected retrieval path.
   - Done when: Execution leaves have a precise target list.
2. **Implement/acquire first retrieval slice** — assignee: `worker-gemma`
   - Scope: Retrieve the initial subset of missing full-text targets through the chosen path.
   - Done when: Initial target subset is actually retrieved or blocked precisely.
3. **Ingest retrieved content into searchable store** — assignee: `worker-gemma`
   - Scope: Process the retrieved documents into the existing searchable corpus/vector path.
   - Done when: Retrieved content becomes searchable in the intended system.
4. **Verify retrieval and searchability** — assignee: `worker-gemma`
   - Scope: Run a concrete verification that the retrieved content can be found/accessed downstream.
   - Done when: Verification evidence shows retrieval + searchability succeeded.
5. **Review legal/operational caveats and completeness** — assignee: `reviewer`
   - Scope: Assess whether the retrieval slice is usable and what caveats remain.
   - Done when: Reviewer signs off or leaves a bounded blocker list.

Gemma-eligible leaves: Implement/acquire first retrieval slice, Ingest retrieved content into searchable store, Verify retrieval and searchability

