# GreenChemistry.ai Kanban Survivor Review

**Purpose:** classify active Hermes cards that are not represented in `BACKLOG.md`.

**Review date:** 2026-07-17  
**Board:** `green-chemistry-ai`  
**Cards requiring decision:** 59

## How Trevor should review

For each card, choose exactly one disposition:

- **KEEP** — legitimate product work; we will add one canonical markdown card.
- **ARCHIVE** — stale helper, duplicate, or historical decomposition residue.
- **QUARANTINE** — retain temporarily because it is a real technical/human gate; add a precise reason and owner.
- **MERGE** — duplicate of a named canonical markdown card; record the target ID.

Do not edit the database manually. Reply with a list such as `KEEP t_xxxx`, `ARCHIVE t_yyyy`, `MERGE t_zzzz -> t_aaaa`, or `QUARANTINE t_bbbb — reason`. You can review by group rather than all at once.

## Recommended review order

1. Blocked cards first — decide whether any are legitimate gates.
2. Ready cards assigned to `orchestrator` — likely roots or stale spec work.
3. Todo cards assigned to `worker-gemma`/`reviewer` — likely decomposition leaves.

## Cards

### READY / orchestrator
- [ ] `t_718f6f5c` — **Audit remaining non-token classes in target files**
  - links: 4 (parents 0, children 4); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: establish the exact edit surface for the Evidence Atlas color-token cleanup before Gemma edits files.  Files to inspect: - `app/analyze/[id]/page.tsx` - `components/EvidenceAtlas.tsx` - `components/PrincipleSection.t...
- [ ] `t_b3979775` — **Locate confirmation dialog and saved-analysis state path**
  - links: 3 (parents 0, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: identify the exact Analysis-page clear/reset dialog surface and the state source that indicates whether the current analysis has a persisted ID/shareable URL.  Files to inspect first: - `app/analyze/[id]/page.tsx` - ...
- [ ] `t_47a018e1` — **Inspect current toggle and filter-tab implementation**
  - links: 3 (parents 0, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: identify the exact Analysis-page files/components that render the Full Analysis / Quick Wins toggle and the filter-tab styling it should match.  Files to inspect first: - `components/AnalysisResults.tsx` - any extrac...
- [ ] `t_ffa21f15` — **Map current P1 section layout and metric groups**
  - links: 3 (parents 0, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: identify exactly which P1 waste metrics stay visible by default and which move behind the breakdown toggle.  Files to inspect first: - `components/WasteScoreCard.tsx` - any Evidence Atlas component that renders the P...
- [ ] `t_5521d0c8` — **Map recommendation cards to Atlas section identifiers**
  - links: 2 (parents 0, children 2); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: identify the stable mapping contract between recommendation cards/principles and Evidence Atlas sections before Gemma wires anchors and deep links.  Files to inspect first: - `components/AnalysisResults.tsx` - `compo...
- [ ] `t_11095fa9` — **Define benchmark protocol and comparison rubric**
  - links: 2 (parents 0, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: pin the exact benchmark workflow, prompts, metrics, and artifact expectations before Gemma runs the comparison.  Inspect first: - `lib/pipeline.ts` - `tests/lib/pipeline-ranking.test.ts` - `docs/pipeline-v2-architectu...
- [ ] `t_122d21c7` — **Identify exact backlog subset and access assumptions**
  - links: 2 (parents 0, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: define the first retrieval slice and expected access path before Gemma attempts acquisition.  Inspect first: - `lib/pipeline.ts` - any retrieval/documentation path identified by search  Required output in a task comme...
- [ ] `t_18552a66` — **Specify trace-table schema and insertion points**
  - links: 2 (parents 0, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: pin the exact schema and hook points for trace/dedup logging before Gemma edits the pipeline.  Inspect first: - `lib/pipeline.ts` - `supabase/migrations/` - `docs/infra/supabase-migration-audit.md`  Required output in...
- [ ] `t_2fded312` — **Choose first local serving path and config contract**
  - links: 3 (parents 0, children 3); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: choose the first supported local serving path and define the minimum config contract before Gemma edits docs/config handling.  Inspect first: - `lib/pipeline.ts` - project docs mentioning models/config  Required outpu...
- [ ] `t_419d4a53` — **Locate PMI source fields and provenance derivation path**
  - links: 2 (parents 0, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: trace where numeric PMI and provenance are produced or can be derived before Gemma changes UI surfaces.  Inspect first: - `lib/pipeline.ts` - `lib/types.ts` - `components/AnalysisResults.tsx` - `components/EvidenceAtl...
- [ ] `t_93c3ab39` — **Define minimal confidence/provenance presentation contract**
  - links: 2 (parents 0, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: define the first-slice provenance taxonomy and exactly where it should render before Gemma edits UI components.  Inspect first: - `components/AnalysisResults.tsx` - `components/EvidenceAtlas.tsx` - `lib/types.ts` - an...
- [ ] `t_e51d9d8e` — **Define exact schema test cases for parse/evaluate/assemble**
  - links: 4 (parents 0, children 4); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: define the exact structured-output obligations to test before Gemma runs stage-specific validation.  Inspect first: - `lib/pipeline.ts`  Required output in a task comment: 1. The exact parse/evaluate/assemble schemas ...

### READY / worker-gemma
- [ ] `t_d1cee3e1` — **Audit radius usage in analysis-page components**
  - links: 3 (parents 0, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: enumerate the in-scope radius usage across the Analysis page before standardization.  Files to inspect first: - `components/AnalysisResults.tsx` - any Analysis-page subcomponents that render score cards, recommendati...

### TODO / reviewer
- [ ] `t_e0adfa21` — **Review visual consistency of updated Atlas surfaces**
  - links: 4 (parents 3, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the completed Evidence Atlas token-migration work after the execution tasks finish.  Inputs to review: - Audit output from the orchestrator scope task - Code changes in `app/analyze/[id]/page.tsx` - Code changes in `components/EvidenceAtlas.tsx` - Code changes in `compo...
- [ ] `t_74fb4c2a` — **Review UX wording and edge cases for clear-dialog link flow**
  - links: 4 (parents 3, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the New Analysis clear-dialog change after the implementation and test tasks finish.  Review checklist: 1. `Copy link` appears only when a persisted analysis can be revisited. 2. Unsaved analyses do not show the action. 3. Dialog wording still clearly warns about cleari...
- [ ] `t_d1741a69` — **Review visual parity with filter bar**
  - links: 4 (parents 3, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the completed Analysis toggle change after implementation and verification finish.  Review checklist: 1. The Full Analysis / Quick Wins control now reads as part of the same system as the filter tabs. 2. The active state uses a bottom-border tab indicator rather than pi...
- [ ] `t_f2df52ee` — **Review consistency against design system**
  - links: 4 (parents 3, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the Analysis-page radius standardization after the Gemma execution tasks finish.  Review checklist: 1. Cards/surfaces use the approved card radius. 2. Buttons use the approved button radius. 3. Pills/badges use the approved pill radius. 4. Layout and interaction quality...
- [ ] `t_fc86e8b0` — **Review information hierarchy and readability**
  - links: 4 (parents 3, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the P1 waste-section density change after implementation and preservation checks finish.  Review checklist: 1. Default state emphasizes the primary waste takeaway. 2. Lower-detail grids remain accessible after expansion. 3. Toggle wording and behavior are clear. 4. Any ...
- [ ] `t_d3c652b7` — **Review link correctness and fallback behavior**
  - links: 3 (parents 2, children 1); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Review the Evidence Atlas deep-link work after the anchor and recommendation-link tasks finish.  Review checklist: 1. The recommendation-to-Atlas mapping matches the orchestrator contract. 2. Links land on the intended Atlas section, not just the page top. 3. Unmapped or unava...
- [ ] `t_0fc0b44b` — **Synthesize compatibility result**
  - links: 4 (parents 3, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review and synthesize the stage-specific Qwen schema validation results.  Review checklist: 1. Parse/evaluate/assemble each have a clear pass/fail result. 2. The final compatibility verdict is explicit. 3. Any blocker is recorded precisely.  **Definition of Done** - Reviewer s...
- [ ] `t_1b719683` — **Review docs and operational sanity**
  - links: 2 (parents 1, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the local Qwen configuration rollout after docs/config/verification tasks finish.  Review checklist: 1. The documented path is reusable. 2. The config contract is coherent. 3. Verification evidence is sufficient or the blocker is precise.  **Definition of Done** - Revie...
- [ ] `t_65f85fc3` — **Review recommendation and caveats**
  - links: 2 (parents 1, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the Qwen-vs-Claude benchmark output after the execution tasks finish.  Review checklist: 1. The comparison result is explicit. 2. Caveats and operational tradeoffs are called out. 3. Any issue is recorded as a precise blocker.  **Definition of Done** - Reviewer sign-off...
- [ ] `t_74cc98ae` — **Review trace usefulness and cost sanity**
  - links: 3 (parents 2, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the trace/dedup logging rollout after schema and pipeline tasks finish.  Review checklist: 1. Stored data is sufficient for debugging/forensics. 2. The shape is not obviously wasteful. 3. Any issue is recorded as a precise blocker.  **Definition of Done** - Reviewer sig...
- [ ] `t_a251c856` — **Review scientific clarity and consistency**
  - links: 3 (parents 2, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the confidence/provenance indicator rollout after implementation finishes.  Review checklist: 1. The provenance states are understandable and consistent. 2. The presentation matches scientific expectations. 3. Any issue is recorded as a precise blocker.  **Definition of...
- [ ] `t_a4d58a62` — **Review consistency across both surfaces**
  - links: 3 (parents 2, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the PMI + provenance rollout after the model and both UI tasks finish.  Review checklist: 1. Main results and Evidence Atlas show the same PMI/provenance story. 2. The provenance wording is scientifically legible. 3. Any inconsistency is recorded as a precise blocker.  ...
- [ ] `t_bc879db2` — **Review legal/operational caveats and completeness**
  - links: 2 (parents 1, children 1); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Review the first retrieval-slice outcome after retrieval/ingestion/verification finish.  Review checklist: 1. The slice is usable or its blockers are explicit. 2. Operational/legal caveats are called out. 3. Any issue is recorded as a precise blocker.  **Definition of Done** -...

### TODO / worker-gemma
- [ ] `t_0503c05f` — **Normalize card and badge radius classes**
  - links: 4 (parents 1, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: update in-scope Analysis-page cards/surfaces to 8px radius and pills/badges/chips to 9999px radius.  Files to edit: - Use the exact Analysis-page files identified by the audit task. - Start with `components/AnalysisR...
- [ ] `t_aa55cd3c` — **Normalize button radius classes**
  - links: 4 (parents 1, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: update in-scope Analysis-page buttons to 4px radius.  Files to edit: - Use the exact Analysis-page files identified by the audit task. - Include the accept-button surface and any other in-scope Analysis-page buttons ...
- [ ] `t_6f63b61c` — **Add stable anchor IDs to Atlas sections**
  - links: 4 (parents 1, children 3); created_by: `trevor-safe-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: implement or normalize stable anchor IDs on the Evidence Atlas sections using the mapping contract from the orchestrator scope task.  Files to edit: - `components/EvidenceAtlas.tsx` - any directly related Atlas secti...
- [ ] `t_13085248` — **Implement collapsible lower-detail breakdown**
  - links: 4 (parents 1, children 3); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: modify the P1 waste section so the lower-detail liquid/process-burden grids are hidden by default and revealed via an explicit breakdown toggle.  Files to edit: - Start with `components/WasteScoreCard.tsx` - Include ...
- [ ] `t_3f15a870` — **Preserve existing data rendering in collapsed mode**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: verify and, if needed, adjust the implementation so no existing P1 waste details disappear permanently after the collapse behavior is introduced.  Files/surface in scope: - `components/WasteScoreCard.tsx` - any direc...
- [ ] `t_4ca199d8` — **Verify no stray radius classes remain in scope**
  - links: 4 (parents 2, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: perform the bounded verification pass after the Analysis-page radius cleanup is complete.  Verification: - Re-run `rg -n 'rounded-xl|rounded-lg|rounded-full|rounded'` against the touched Analysis-page files. - Conf...
- [ ] `t_66781136` — **Replace page-level zinc styling in analyze route**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: remove the remaining zinc/dark card styling from the analyze route Evidence Atlas surface and replace it with the existing brand-token treatment already used elsewhere.  File to edit: - `app/analyze/[id]/page.tsx`  R...
- [ ] `t_9759bb32` — **Verify active/inactive states and keyboard behavior**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: perform the bounded verification pass for the updated Analysis toggle.  Files/surface in scope: - `components/AnalysisResults.tsx` - any directly related toggle helper/component touched by the implementation task  Ve...
- [ ] `t_9a58c698` — **Add deep links from recommendation cards**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: wire recommendation-card deep links so they navigate to the exact Evidence Atlas section anchors established by the anchor task.  Files to edit: - `components/AnalysisResults.tsx` - any directly related recommendatio...
- [ ] `t_9ccee29f` — **Replace toggle pill with tab-style control**
  - links: 4 (parents 1, children 3); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: replace the Analysis-page pill toggle with a tab-style control that matches the filter bar's visual language.  File to edit first: - `components/AnalysisResults.tsx`  Execution constraints: - Replace the current pill...
- [ ] `t_9ed7e599` — **Add test coverage for copy-link behavior**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: add or update tests covering the saved-vs-unsaved behavior for the Analysis clear/reset dialog after the Copy link action is implemented.  Files to inspect/edit: - The nearest existing test file for the touched dialo...
- [ ] `t_a4e72da0` — **Add Copy link action to saved-analysis clear dialog**
  - links: 4 (parents 1, children 3); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: implement a conditional `Copy link` action in the Analysis-page clear/reset confirmation dialog when the current analysis has a persisted ID/shareable URL.  Files to edit: - Start with the exact dialog/component path...
- [ ] `t_bd5c3994` — **Replace semantic colors in Evidence Atlas components**
  - links: 3 (parents 1, children 2); created_by: `trevor-gemma-contract-rewrite`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai`  Goal: replace remaining semantic Tailwind background colors in the Atlas components with the project's established token system.  Files to edit: - `components/EvidenceAtlas.tsx` - `components/PrincipleSection.tsx`  Executi...
- [ ] `t_01b44aad` — **Implement/acquire first retrieval slice**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: retrieve the initial subset of missing full-text targets through the chosen path, or block precisely if access is unavailable.  Verification: - Leave a comment naming the targets attempted and what was acquired or blo...
- [ ] `t_167323b7` — **Expose provenance state to score UI components**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: thread the required provenance state into the score UI model/props layer.  Files to edit: - `lib/types.ts` - `lib/pipeline.ts` - any directly related score-model helper identified by the scope task  Verification: - Le...
- [ ] `t_5f0fd457` — **Validate assemble-stage structured output**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: validate the assemble stage against the required schema contract.  Files/surface in scope: - `lib/pipeline.ts` - any fixture/invocation path identified by the scope task  Verification: - Execute the agreed assemble-st...
- [ ] `t_61573d21` — **Render PMI + provenance in Evidence Atlas**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: render the same numeric PMI and provenance information in the Evidence Atlas with benchmark/calculation context.  Files to edit: - `components/EvidenceAtlas.tsx` - any directly related Atlas subcomponent identified by...
- [ ] `t_7d0aa9d0` — **Expose PMI + provenance in result view model**
  - links: 4 (parents 1, children 3); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: make numeric PMI and provenance state available to the UI layer.  Files to edit: - `lib/pipeline.ts` - `lib/types.ts` - any directly related model/helper file identified by the scope task  Verification: - Leave a comm...
- [ ] `t_806f5249` — **Add drill-down or helper copy for interpretation**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: add concise explanatory treatment so users can understand what the new provenance states mean.  Files to edit: - the exact score UI surface(s) touched by the indicator task  Verification: - Leave a comment describing ...
- [ ] `t_9847b38b` — **Persist pre-dedup recommendation merge log**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: persist pre-dedup recommendation state and merge-map information in the pipeline dedup path.  Files to edit: - `lib/pipeline.ts` - any directly related persistence helper introduced by the schema task  Verification: -...
- [ ] `t_9e55bf32` — **Wire pipeline config to local endpoint variables**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: make the pipeline read the chosen local endpoint/model configuration cleanly.  Files to edit: - `lib/pipeline.ts` - any directly related config helper identified by the scope task  Verification: - Leave a comment nami...
- [ ] `t_a04d6cfd` — **Run and record Qwen benchmark series**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: execute the Qwen-side benchmark run(s) and capture the agreed artifacts or blockers.  Verification: - Use the protocol defined by the scope task. - Leave a comment with the exact command(s) run, artifact location(s), ...
- [ ] `t_accdabe9` — **Verify a real local inference path**
  - links: 4 (parents 2, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: run the smallest real verification that confirms the pipeline can hit the local Qwen endpoint, or block precisely if the environment is missing.  Verification: - Use the documented startup/config path. - Leave a comme...
- [ ] `t_ad98c0c7` — **Document/start local Qwen serving command**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: add the startup instructions for the chosen local Qwen serving path.  Files to edit: - project documentation file(s) identified by the scope task  Verification: - Leave a comment with the exact startup command documen...
- [ ] `t_b68979fe` — **Validate evaluate-stage structured output**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: validate the evaluate stage against the required schema contract.  Files/surface in scope: - `lib/pipeline.ts` - any fixture/invocation path identified by the scope task  Verification: - Execute the agreed evaluate-st...
- [ ] `t_b77abb15` — **Persist per-call traces in the LLM call path**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: instrument the LLM call path so model/tokens/latency/request-response trace data is persisted.  Files to edit: - `lib/pipeline.ts` - any directly related persistence helper introduced by the schema task  Verification:...
- [ ] `t_b997c1a1` — **Verify retrieval and searchability**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: run a concrete verification that the retrieved content can be found/accessed downstream.  Verification: - Leave a comment with the exact downstream lookup/search check performed and the result.  **Definition of Done**...
- [ ] `t_d10ad5cf` — **Validate parse-stage structured output**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: validate the parse stage against the required schema contract.  Files/surface in scope: - `lib/pipeline.ts` - any fixture/invocation path identified by the scope task  Verification: - Execute the agreed parse-stage ch...
- [ ] `t_d6658f61` — **Ingest retrieved content into searchable store**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: process the retrieved documents into the existing searchable corpus/path.  Verification: - Leave a comment naming where the retrieved content was ingested.  **Definition of Done** - Retrieved content is loaded into th...
- [ ] `t_f7c8e536` — **Render PMI + provenance in main results**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: render numeric PMI and provenance in the main analysis results surface.  Files to edit: - `components/AnalysisResults.tsx` - any directly related result subcomponent identified by the scope task  Verification: - Leave...
- [ ] `t_f8a35882` — **Normalize and compare against Claude Sonnet baseline**
  - links: 3 (parents 1, children 2); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: normalize the Qwen benchmark results and compare them directly to the Claude Sonnet baseline.  Verification: - Leave a comment with the comparison table/summary location and the key deltas.  **Definition of Done** - A...
- [ ] `t_fb7b3606` — **Add schema/migrations for trace and dedup logs**
  - links: 4 (parents 1, children 3); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: add the database schema for `gpc_analysis_traces` and `gpc_dedup_log`.  Files to edit: - `supabase/migrations/*.sql` (new migration or minimal update in the existing pattern)  Verification: - Leave a comment naming th...
- [ ] `t_feab3264` — **Implement confidence/provenance indicators on key score surfaces**
  - links: 4 (parents 1, children 3); created_by: `trevor-remaining-first-wave`; failures: 0
  - body: Repo root: `/Users/ct-mac-mini/dev/greenchemistry-ai` Goal: render the first-slice confidence/provenance indicators on the targeted score surfaces.  Files to edit: - `components/AnalysisResults.tsx` - `components/EvidenceAtlas.tsx` - any directly related score component identi...

## Decision log

| Card ID | Disposition | Canonical target / reason |
|---|---|---|
| `t_718f6f5c` |  |  |
| `t_b3979775` |  |  |
| `t_47a018e1` |  |  |
| `t_ffa21f15` |  |  |
| `t_5521d0c8` |  |  |
| `t_11095fa9` |  |  |
| `t_122d21c7` |  |  |
| `t_18552a66` |  |  |
| `t_2fded312` |  |  |
| `t_419d4a53` |  |  |
| `t_93c3ab39` |  |  |
| `t_e51d9d8e` |  |  |
| `t_d1cee3e1` |  |  |
| `t_e0adfa21` |  |  |
| `t_74fb4c2a` |  |  |
| `t_d1741a69` |  |  |
| `t_f2df52ee` |  |  |
| `t_fc86e8b0` |  |  |
| `t_d3c652b7` |  |  |
| `t_0fc0b44b` |  |  |
| `t_1b719683` |  |  |
| `t_65f85fc3` |  |  |
| `t_74cc98ae` |  |  |
| `t_a251c856` |  |  |
| `t_a4d58a62` |  |  |
| `t_bc879db2` |  |  |
| `t_0503c05f` |  |  |
| `t_aa55cd3c` |  |  |
| `t_6f63b61c` |  |  |
| `t_13085248` |  |  |
| `t_3f15a870` |  |  |
| `t_4ca199d8` |  |  |
| `t_66781136` |  |  |
| `t_9759bb32` |  |  |
| `t_9a58c698` |  |  |
| `t_9ccee29f` |  |  |
| `t_9ed7e599` |  |  |
| `t_a4e72da0` |  |  |
| `t_bd5c3994` |  |  |
| `t_01b44aad` |  |  |
| `t_167323b7` |  |  |
| `t_5f0fd457` |  |  |
| `t_61573d21` |  |  |
| `t_7d0aa9d0` |  |  |
| `t_806f5249` |  |  |
| `t_9847b38b` |  |  |
| `t_9e55bf32` |  |  |
| `t_a04d6cfd` |  |  |
| `t_accdabe9` |  |  |
| `t_ad98c0c7` |  |  |
| `t_b68979fe` |  |  |
| `t_b77abb15` |  |  |
| `t_b997c1a1` |  |  |
| `t_d10ad5cf` |  |  |
| `t_d6658f61` |  |  |
| `t_f7c8e536` |  |  |
| `t_f8a35882` |  |  |
| `t_fb7b3606` |  |  |
| `t_feab3264` |  |  |
