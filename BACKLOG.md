---
kanban-plugin: board
---

## Backlog

Roadmap framing:
- **0.5.x — Equivalent chemistry hardening:** substitution quality, deterministic scoring, evidence grounding, retrieval, validation, and clearer before/after impact.
- **0.6 — Equivalent process redesign:** route architecture, one-pot/telescoped alternatives, transfer/purification burden, and literature-backed procedural redesign.
- **Platform / GTM / Infra:** keep shipping blockers visible, but do not let them blur the product boundary between 0.5.x and 0.6.

### UI / Design

- [ ] **Data: Green chemistry literature pipeline for citable recommendations** — Build an ingestion pipeline targeting open-access green chemistry sources so recommendations can cite primary literature in standard scientific bibliography format (ACS, APA, or BibTeX). Priority sources to target: (1) ACS Sustainable Chemistry & Engineering open-access articles, (2) Green Chemistry journal (RSC, open-access subset), (3) CHEM21 published solvent guide and methodology papers, (4) EPA Safer Chemical Ingredients List and associated hazard assessments, (5) P2 Pollution Prevention resource library (EPA), (6) ACS GCI Pharmaceutical Roundtable published benchmark datasets, (7) ChemRxiv preprints tagged green chemistry. Pipeline should: scrape/pull full-text or abstracts, extract chemical substitution claims with DOI/URL, store in vector DB alongside existing PubChem data, surface as `evidenceTier: 'sourced'` recommendations with structured citation objects (authors, title, journal, year, DOI, URL). Requires journal partnership or API access for paywalled content; open-access sources can be scraped directly. [added::2026-05-29] [done-when::At least 3 open-access sources are ingested, at least one recommendation per analysis is tagged sourced with a citable DOI, and the Evidence Atlas renders the citation in ACS format with a working link] [priority::high]

- [ ] **UI: Clean up zinc/Tailwind colors in Evidence Atlas route** — `app/analyze/[id]/page.tsx:171` has the dark zinc Evidence Atlas card that was fixed in AnalysisResults but missed here. `EvidenceAtlas.tsx` and `PrincipleSection.tsx` have residual `bg-zinc-*`, `bg-green-100`, `bg-yellow-100`, `bg-red-100` Tailwind semantic classes. Replace with brand tokens to match the rest of the app. [added::2026-05-29] [done-when::grep for zinc- and bg-green-/bg-yellow-/bg-red- in those three files returns zero results] [needs-ui::true] [priority::low]

- [ ] **Improve greenchemistry.ai UI** [added::2026-05-29] [priority::medium] [needs-ui::true] [done-when::All P0/P1 issues resolved; audit score improves from 13/20 to 17+/20 on re-run]

  Full impeccable audit run 2026-05-29. Score: **13/20 — Acceptable (significant work needed)**.

  #### Anti-Patterns Verdict
  Landing page is genuinely distinctive (Swedish modernist, scroll-linked color, structural type). App UI has one loud tell: zinc-palette cards (`bg-zinc-900/50`, `border-zinc-700/60`, `text-zinc-200`) inside a warm cream-and-forest interface. `.gold-shimmer` (gradient text — banned) defined in globals.css but unused. Delete it before it gets applied.

  #### Health Score

  | # | Dimension | Score | Key Finding |
  |---|-----------|-------|-------------|
  | 1 | Accessibility | 2/4 | No skip nav, no spinner role, nav CTA likely under 44px |
  | 2 | Performance | 3/4 | `showcase-progress` animates `width` (layout property) |
  | 3 | Responsive Design | 3/4 | Good coverage; one consistent touch target gap |
  | 4 | Theming | 2/4 | 64+ hard-coded `#1B4332` (wrong value), body defaults to `system-ui`, zinc leak |
  | 5 | Anti-Patterns | 3/4 | Zinc cards off-brand; `gold-shimmer` defined but unused |
  | **Total** | | **13/20** | **Acceptable** |

  #### Findings

  **[P1] Body font defaults to `system-ui`, not Libre Baskerville**
  `globals.css:74` — `body { font-family: var(--font-sans) }` where `--font-sans: system-ui`. Any element without an explicit font class renders wrong. Fix: change body to `font-family: var(--font-serif)`.

  **[P1] `#1B4332` vs `#1C3822` — two different forest greens**
  64 occurrences of `#1B4332` (wrong value) vs the token `--color-forest: #1C3822`. Global replace `#1B4332` → `#1C3822` or `var(--color-forest-deep)`. Update CLAUDE.md which lists the wrong value.

  **[P1] Zinc palette intrusion in app UI**
  `AnalysisResults.tsx:430–444`, `EvidenceAtlas.tsx:147–166`, `PrincipleSection.tsx:271–316`. Replace: `zinc-900` → `--brand-near-black`, `zinc-700` → `--brand-forest-mid`, `zinc-300` → `--brand-sage`, `zinc-200` → `--brand-cream-light`.

  **[P1] `showcase-progress` animates `width` — layout property**
  `app/page.tsx:441–448`. Runs for 10 seconds continuously. Replace with `transform: scaleX()` + `transform-origin: left`.

  **[P1] No skip-to-content link (WCAG 2.4.1 Level A)**
  Missing on all pages. Add `<a href="#main-content" className="sr-only focus:not-sr-only">Skip to main content</a>` as first child of body, `id="main-content"` on `<main>`.

  **[P1] Nav CTA touch target under 44px (WCAG 2.5.5)**
  `app/page.tsx:168–172` — "ANALYZE →", padding `0.5rem 0.8rem` at `0.65rem` font, ~32px tall. Increase to `0.65rem 1rem` minimum.

  **[P1] Loading spinner missing accessible role**
  `app/analyze/page.tsx:120` — no `role="status"` or `aria-label`. Add both, plus `<span className="sr-only">Loading...</span>` inside.

  **[P2] `.gold-shimmer` defined — gradient text, absolute ban**
  `globals.css:125–132`. Currently unused but dangerous. Delete the entire class.

  **[P2] Token system exists but 64+ hard-coded hex values bypass it**
  `#FAF8F3`, `#FAFAF8`, `#F5F0E8` in app pages — not in token system, close to cream but not exact. Use `/impeccable extract` to pull all raw hex into named tokens.

  **[P2] ScoreBar button missing aria-expanded**
  `ScoreCard.tsx:56–83`. Add `aria-expanded={showDetails}` and `aria-label` describing the principle.

  **[P3] `<nav>` missing aria-label**
  `app/page.tsx:146`. Add `aria-label="Main navigation"`.

  #### Systemic Issues
  - Token bypass is the norm — components inline hex values directly instead of using CSS custom properties
  - Body font is broken at root — every correctly-rendered element is fighting the global default
  - Zinc colors = component built without consulting DESIGN.md — recurring pattern when building quickly

  #### What's Working
  - Landing page design is genuinely distinctive and non-AI-looking
  - Animation choices correct: `ease-out`, `opacity`/`transform` only, no bounce
  - Semantic HTML solid throughout
  - `aria-hidden` on decorative dropcaps
  - Print stylesheet thoughtful
  - Font loading via `next/font/google` — no CLS

  #### Recommended Command Sequence
  1. `/impeccable typeset` — fix body font root, audit all font-family usages
  2. `/impeccable colorize` — reconcile `#1B4332` vs `#1C3822`, replace zinc with brand tokens
  3. `/impeccable harden` — skip nav, ARIA roles, touch targets
  4. `/impeccable optimize` — showcase-progress `width` → `scaleX`
  5. `/impeccable extract` — pull remaining inline hex into tokens, delete `.gold-shimmer`
  6. `/impeccable polish` — final pass

### 0.5.x — Finish the current thesis

- [x] **Scoring: Unit conversion engine** [done::2026-05-12] — Build robust quantity parsing in the Python microservice: extract raw values + units from LLM, then convert between mol/g/mL/M/equiv using verified MW and density from PubChem/RDKit (NOT LLM math). Store both `quantityKg` and `quantityMol` for every chemical. Foundation for all scoring. [added::2026-03-15]
- [x] **Scoring: Python microservice** [done::2026-05-12] — Set up FastAPI + RDKit on Google Cloud Run with Docker, PubChem API integration, chemical name → SMILES resolution pipeline [added::2026-03-15]
- [x] **Scoring: P1 Waste/PMI** [done::2026-05-19] — Reaction-type classifier → yield lookup from ACS GCI data → PMI range calculation [added::2026-03-15]
- [x] **Scoring: P2 Atom Economy** [done::2026-05-19] — PubChem name→SMILES → rxnSMILES4AtomEco calculation, LLM reactant/product role extraction [added::2026-03-15]
- [x] **Scoring: P3 Less Hazardous** [done::2026-05-19] — GHS hazard scoring formula (H-codes × quantity), PubChem PUG-View fallback for chemicals not in DB [added::2026-03-15]
- [x] **Scoring: P5 Safer Solvents** [done::2026-05-19] — Import CHEM21 full CSV from AI4Green, weighted score by mass [added::2026-03-15]
- [x] **Scoring: P6 Energy Efficiency** [done::2026-05-19] — Parse numeric temperatures from strings, score by deviation from ambient [added::2026-03-15]
- [x] **Scoring: P7 Renewable Feedstocks** [done::2026-05-21] — Add `isRenewable` boolean to chemical database, scoring formula [added::2026-03-15]
- [x] **Scoring: P8 Reduce Derivatives** [done::2026-05-21] — Rxn-INSIGHT reaction classification, Baran ideality metric, synthesis-type context adjustment [added::2026-03-15]
- [x] **Scoring: P9 Catalysis** [done::2026-05-21] — Score catalytic vs. stoichiometric reagent ratio from parsed roles [added::2026-03-15]
- [x] **Scoring: P10 Degradation** [done::2026-05-21] — Environmental persistence scoring from GHS environmental hazard codes [added::2026-03-15]
- [x] **Scoring: P11 Real-time Analysis** [done::2026-05-26] — AI-assessed score for monitoring opportunities [added::2026-03-15]
- [ ] **Article: Green Analytical Chemistry (GAC) Review** — Integrate principles from "Green Analytical Chemistry: A critical review" (ScienceDirect 2025) into P11 scoring and real-time analysis framework. <https://www.sciencedirect.com/science/article/abs/pii/S0003267025004465> [added::2026-03-17]
- [x] **Scoring: P12 Accident Prevention** [done::2026-05-26] — Physical hazard scoring from GHS codes (flammability, explosivity) × quantity [added::2026-03-15]
- [ ] **Scoring: Before/After Prediction** — Re-run scoring formulas with alternative chemicals substituted, AI prediction for estimated principles [added::2026-03-15]
- [ ] **Scoring: UI** — Per-principle score bars, summary scorecard/radar chart, confidence indicators (calculated vs. AI-estimated), before/after visualization [added::2026-03-15]
- [ ] **Scoring: Validation** — Run against known protocols, compare with DOZN scores for sanity checking; add literature-backed benchmark cases where a greener equivalent route or substitution is already known [added::2026-03-15]
- [x] **Retrieval: Full vector database search** [done::2026-05-10] — Support literature-aware recommendation grounding and retrieval of precedent around substitutions, hazards, and score rationales. [added::2026-03-15] [done-when::Semantic search can retrieve relevant papers/snippets for a queried protocol, chemical, or principle with source IDs surfaced to the app] [priority::high]
- [x] **Retrieval: Backlogged data retrieval from PubMed** [done::2026-05-10] — Pull literature needed to support evidence-backed substitutions and validation cases for 0.5.x. [added::2026-03-15] [done-when::PubMed ingestion pipeline populates searchable records and at least one validation set is built from retrieved papers] [priority::high]
- [ ] **Retrieval: Backlogged data retrieval from Sci-Hub** — Fill gaps where PubMed metadata exists but full text is needed for extraction and validation. [added::2026-03-15] [done-when::Full-text retrieval path exists for selected backlog papers and extracted content is searchable alongside PubMed records] [priority::medium]
- [ ] **Audit: Pipeline process trace** — Store per-LLM-call traces (model, tokens in/out, latency, raw request/response) in `gpc_analysis_traces` table. Store pre-dedup recommendations + merge map in `gpc_dedup_log`. Enables: cost accounting, "why did it recommend X" forensics, dedup transparency, model version tracking. ~15 JSONB rows per analysis, negligible storage. Wire into `callClaude` helper and dedup step in pipeline.ts [added::2026-04-02]
- [ ] **UI: Citations per principle** — Show data source citations for each of the 12 principle evaluations. Currently not surfaced. Pick one principle to fully cite for the Millipore Sigma demo [added::2026-03-21]
- [ ] **Bug: Investigate triazolo result inconsistency** — 3 runs of same protocol: 2 produced ~38 recs, 1 produced 67 recs. All completed fully (no timeouts). Outlier used more granular per-step decomposition with lower confidence. Root cause: LLM non-determinism. **Note:** The deterministic scoring formulas backlog (11 principles) will largely resolve this — once recommendations are grounded in quantitative scoring, LLM variance only affects wording, not substance. Short-term mitigations if needed: lower temperature, tighter output constraints, or deduplication [added::2026-03-21]
- [x] **Qwen: Abstract AI provider interface in Next.js pipeline** [done::2026-05-25] — Created `lib/llm.ts` with `LLMAdapter` pattern supporting Anthropic and OpenAI-compatible providers. Refactored `lib/pipeline.ts` to use this abstraction, enabling local model support via `LLM_BASE_URL` and `LLM_MODEL`. [added::2026-03-21] [priority::high] [done-when::All three pipeline phases (parse, evaluate, assemble) can run against a local OpenAI-compatible endpoint configured via env vars, with Anthropic as the default fallback when no base URL is set]
- [ ] **Qwen: Local endpoint configuration** — Add config for Qwen3-32B or Qwen3-72B on M5 Mac Studio (256GB RAM) via Ollama or vLLM; document model selection and startup instructions [added::2026-03-21] [priority::high] [done-when::A local Qwen model can be started with a single command and the pipeline routes to it via LLM_BASE_URL]
- [ ] **Qwen: Validate structured output schemas** — Re-test all 3 pipeline phases (parse, evaluate, assemble) against Qwen tool-use/JSON format; document any schema compatibility gaps and fix them [added::2026-03-21] [priority::high] [done-when::All three phases return valid structured output on at least 5 consecutive runs with no schema errors]
- [ ] **Qwen: Benchmark vs Claude Sonnet** — Run triazolo-peptidomimetics protocol 5+ times on both models; compare output quality, latency, consistency, recommendation count variance [added::2026-03-21] [priority::medium] [done-when::Benchmark results documented with pass/fail criteria for recommendation quality and structured output reliability]
- [ ] **Qwen: Test streaming SSE** — Verify SSE heartbeat and progress events work with local model endpoint; test Phase 2 parallel principle evaluation under local model latency [added::2026-03-21] [priority::medium] [done-when::Progress events stream correctly to the browser during a full local-model analysis run]
- [ ] **UI: Mobile viewport improvements** — Better responsive layout for demo scenario (GC.ai running on mobile-sized viewport alongside slideshow). Ensure analysis progress, results, and accept/reject all work well at small screen sizes [added::2026-03-21]
- [ ] **UI: "Quick Wins" summary view for Millipore Sigma** — Stripped-down output showing only the top chemical swaps (1-3) with direct drop-in replacement instructions. Purchasing accelerator framing: original chemical → recommended swap → Millipore Sigma catalog link. Separate from full 12-principle analysis [added::2026-03-21]
- [ ] **Website: Make greenchemistry.ai production-ready** — Current site is a stub. Needs to be serious enough for enterprise prospects. Target: by end of April, potentially show logos from Millipore Sigma, CST, MIT, Apple if LOIs secured [added::2026-03-21]
- [ ] **Find moderately complex chemical reaction for Home Page demo** — Blocked: Pending @Chris Carter [added::2026-03-12]
- [ ] **Fix home page to show complete start-to-finish results for the demo reaction** [added::2026-03-12]

### 0.6 — Equivalent process redesign

- [x] **0.6 Design: Process redesign architecture** [done::2026-05-10] — Define how GC.ai evolves from equivalent chemistry to equivalent process without overclaiming experimental certainty. Scope deterministic vs. LLM-assisted components, new data model needs, and UX boundaries between substitutions and redesign proposals. [added::2026-05-08] [done-when::A design doc exists covering scope, claims, data model, scoring changes, and rollout plan for process redesign] [priority::high]
- [x] **Scoring: Process complexity / transfer-loss proxy** [done::2026-05-10] — Quantify transfer count, vessel count, solution-prep count, purification count, and workflow complexity as proxies for waste, failure risk, and operator burden. Inspired by literature where one-pot consolidation improves yield and reduces waste without changing reaction intent. [added::2026-05-08] [done-when::Protocols receive a process-complexity score with explainable sub-metrics surfaced in the analysis output] [priority::high] [needs-ui::true]
- [x] **Scoring: Purification and cleanup burden** [done::2026-05-20] — Estimate wash-step count, recrystallization burden, solvent-intensive cleanup, and isolation friction so GC.ai can distinguish greener process architecture from greener molecule swaps. [added::2026-05-08] [done-when::Analysis captures purification/cleanup burden and shows when a redesign reduces solvent and cleanup load] [priority::high] [needs-ui::true]
- [x] **Scoring: Waste impact composite score** [done::2026-05-20] — Add a simple top-line waste score on the report card that rolls up direct chemical waste, toxic/hazard-segmented waste, liquid mass burden, and process burden into one defensible recommendation-facing metric. Keep carbon adjacent but separate so waste is not collapsed into emissions. [added::2026-05-20] [done-when::Every analysis has a single waste score/grade plus a short primary explanation, and the formula transparently references the underlying waste sub-metrics without requiring the user to open drill-downs] [priority::high] [needs-ui::true]
- [x] **Data model: Structured waste analysis record** [done::2026-05-20] — Persist deep waste calculations in `analysis_result` as a structured object: summary score, direct chemical waste kg, toxic waste kg, hazard-segmented waste buckets, liquid handled/discarded kg, process burden metrics, upstream/LCA placeholders, confidence, and evidence sources. This becomes the source of truth for ranking recommendations and optional UI drill-downs. [added::2026-05-20] [done-when::Stored analyses retain a machine-readable waste analysis object that can be reused for recommendation ranking, exports, and future LCA augmentation without re-parsing old runs] [priority::high]
- [ ] **Evidence: SDS-aware waste and safety context** — Add SDS support as an evidence layer for chemicals: link or cache supplier/authoritative SDS references where available, extract workflow-relevant handling/disposal/safety notes, and attach them to chemical-level evidence without making vendor SDS text the primary scoring source. Use PubChem/GHS and curated datasets for the score; use SDS to strengthen trust and recommendation context. [added::2026-05-20] [done-when::Recommendations and/or chemical drill-downs can show SDS-backed safety/disposal context when available, while core hazard scoring still runs on normalized structured data] [priority::medium]
- [ ] **Evidence: US waste-regulation mapping layer** — Use the US waste-regulations research as a compliance-context layer for 0.6 waste analysis: map waste-relevant chemicals, solvents, and byproducts to federal baseline concepts such as RCRA hazardous-waste characteristics/listed-waste heuristics and disposal-category cues, then attach those signals to the evidence layer and recommendation explanations. Keep this explicitly framed as decision support and citation context, not legal advice and not the sole scoring source. [added::2026-05-29] [done-when::Waste analyses can surface regulation-aware evidence notes and citations for applicable US hazardous-waste/disposal categories, distinguish score-driving hazard data from compliance-context annotations, and gracefully mark gaps where coverage is incomplete or state-specific] [priority::high]
- [ ] **UI: Waste cockpit summary + drill-down** — Keep the default report-card view simple: one waste score, one primary reason, one best next action. Store and expose deeper waste calculations behind optional expanders/tabs so scientists can inspect details only when they care. Recommendation cards should default to a single workflow-relevant reason such as “reduces toxic waste” or “cuts liquid cleanup burden.” [added::2026-05-20] [done-when::The default results view surfaces only the top-line waste takeaway while allowing users to open detailed waste breakdowns, evidence, and process-burden data on demand] [priority::high] [needs-ui::true]
- [ ] **Citability: Stamp software release on every recommendation** — Include the GC.ai release/version number and persistent analysis metadata on every recommendation, report-card output, export, and citation-facing result so scientists can reference exactly which software build generated the advice. Version data should come from a single source of truth and be stored with each analysis for later auditability. [added::2026-05-20] [done-when::Each saved analysis and every rendered/exported recommendation includes a visible or inspectable GC.ai version identifier tied to a stable release source, and old analyses preserve the version they were generated with even after later deploys] [priority::high] [needs-ui::true]
- [ ] **Retrieval: Literature-backed route optimization** — Retrieve and rank papers describing one-pot, telescoped, shortened, or lower-waste equivalents of a protocol so redesign suggestions can cite procedural precedent instead of only chemical-property evidence. [added::2026-05-08] [done-when::Given a protocol, the system can surface route-level precedents with source links and extract the procedural differences relevant to green chemistry] [priority::high]
- [ ] **Engine: Route architecture comparison** — Compare original vs redesigned protocol structure at the step level: fewer transfers, shorter runtime, less purification, lower total throughput, and changed principle scores. [added::2026-05-08] [done-when::A before/after route comparison view exists for redesigned procedures with explicit step-level and score-level deltas] [priority::high] [needs-ui::true]
- [ ] **Validation: Published process-redesign benchmark set** — Build a benchmark corpus from papers where greener route changes are already validated experimentally, then test whether GC.ai ranks the published redesign above the original route. [added::2026-05-08] [done-when::At least one benchmark set exists and is used to evaluate process-redesign suggestions separately from substitution suggestions] [priority::high]

### 0.61 — Mechanochemistry alternatives

- [ ] **Recommendations: Evaluate mechanochemistry alternatives for solvent, energy, and waste reduction** — Add a scoped mechanochemistry evaluation layer that can search literature for plausible ball-milling / mechanochemical analogs of a target transformation, surface them as recommendation candidates, and score them against the existing Green Chemistry framework with emphasis on P5 safer solvents (often no solvent), P6 energy efficiency (often room temperature), and P1 waste prevention. Scope the first slice to literature retrieval + structured extraction of reaction conditions and evidence-backed recommendation framing; do **not** scope full retrosynthetic pathway assembly or a standalone mechanochemistry planning product into this release. [added::2026-05-20] [done-when::Given a conventional protocol, GC.ai can identify at least some literature-backed mechanochemistry alternatives or explicitly say none were found; extracted conditions include fields such as milling time, frequency, ball-to-powder ratio, and additives when available; surfaced alternatives are scored with the existing principles engine and clearly labeled as literature-backed mechanochemistry options rather than experimentally validated in-house recommendations] [priority::medium] [needs-ui::true]

### 0.7 — Evidence-grounded generation

- [ ] **Engine: Two-pass retrieval re-evaluation pipeline** — After generating recommendations (pass 1), run a second LLM pass per recommendation that retrieves evidence from the vector DB and re-evaluates confidence — confirming, downgrading, or flagging each suggestion based on what was found. This is distinct from 0.6's post-generation retrieval scoring (which reranks without re-evaluating substance). 0.7 allows the engine to actually change or suppress a recommendation based on literature evidence. [added::2026-05-21] [done-when::Each recommendation has been re-evaluated against retrieved literature before display; the engine can downgrade or suppress a recommendation whose substance contradicts retrieved evidence; two-pass cost/latency impact is documented] [priority::high] [needs-ui::true]

### Platform / GTM / Infra

- [ ] **Auth: E2E test new account signup** — Test email confirmation flow, Google OAuth flow, redirect to dashboard; verify middleware blocks unauthenticated access to /analyze [added::2026-03-21]
- [x] **Infra: Staging + Production environments** [done::2026-05-22] — production branch created; Vercel production branch tracking set to production; all other branches (including main) create preview deployments only; deploy to prod via `git push origin main:production` [added::2026-03-21]
- [ ] **Infra: CI/CD pipeline** — GitHub Actions for: lint + typecheck on PR, build verification, automated tests (when we have them), deploy to staging on merge to main, manual promote to prod [added::2026-03-21]
- [ ] **Demo: April 2 pitch deck** — Slides for Millipore Sigma presentation. Narrative: DOZN is the best pre-AI scorecard, GC.ai turns it into a coach. Frame as Web 2.0 → AI era (iterative, transparent, human as discriminator). Include roadmap for next 6 months. Demo flow: paste protocol, talk through background processing while results generate live on mobile viewport [added::2026-03-21]
- [ ] **Biz: LOI/NDA templates** — Prepare letter of intent and NDA templates for greenchemistry.ai LLC (not Longino Consulting). Needed for CST engagement starting next week [added::2026-03-21]
- [ ] **Biz: Corporate entity setup** — LLC this weekend, then C Corp → B Corp certification path. 51/49 ownership (Trevor/Chris). Research B Corp requirements, board independence from LabreNew [added::2026-03-21]

## Next

- [x] ~~**BLOCKED: Get original protocol text** for triazolo-peptidomimetics synthesis that produced the DOZN spreadsheet — @Chris Carter to secure~~ RESOLVED: Protocol secured [added::2026-03-16] [done::2026-03-21]
- [x] ~~Add `isAccepted` boolean support to Supabase `gpc_analyses` save/load flow~~ (persisted in analysis_result JSONB via PATCH /api/analyses/[id]) [added::2026-03-12] [done::2026-03-21]

## In Progress

- [ ] Create Environmental Impact Cover Sheet for Print layout [added::2026-03-12]
- [x] ~~Implement Accept/Reject logic for recommendations~~ (UI done, session storage done, Supabase PATCH persistence done, debounced API calls, works on both /analyze and /analyze/[id] routes) [added::2026-03-12] [done::2026-03-21]

## In Review

## Done

- [x] **Recommendation Evidence (HIGH): Ground substitution recommendations in citable sources** — Reintroduce source-backed recommendation evidence without letting the LLM hallucinate citations. PubChem should support why a chemical is flagged (CID, GHS H-codes, properties); substitution claims should come from curated sources such as CHEM21, ACS GCI solvent tool, and vetted literature. Add structured source IDs/URLs/DOIs, attach evidence to `greenAlternatives`, pass only vetted evidence into prompts, and show separate "why flagged" vs "why replacement" citations in the UI. [added::2026-05-04] [done::2026-05-04]
- [x] **Bug (HIGH): Solvent substitution compatibility** — DMF→DMSO recommendation is chemically wrong: polarity and pH are incompatible for many reactions (confirmed by DOZN creator Sami Ponnusamy). Need a solvent compatibility matrix in the chemistry service that checks: polarity range overlap, pH compatibility, miscibility with reaction components, and boiling point suitability before recommending a swap. Affects EVERY solvent recommendation in P5. Without this we look like we don't understand chemistry. [added::2026-04-03] [done::2026-04-13]
- [x] **DOZN Export: Auto-fill DOZN spreadsheet from analysis** [done::2026-04-16] — DOZN's xlsx export is static (zero formulas, just a report). Our pipeline already produces all the input data DOZN needs (steps, chemicals with masses, conditions, roles). Build a Google Sheets template matching DOZN's format + an API endpoint or Apps Script that populates it from a GreenProtoCol analysis ID. Value prop for Merck: hours of manual DOZN data entry → seconds. Requires: Merck catalog number lookup for chemicals, product mass extraction, B-score calculation. [added::2026-04-03]
- [x] **DOZN Score Calibration** [done::2026-05-04] — Our 0-10 scores diverge significantly from DOZN's 0-100 scores on the same protocol. Need to understand DOZN's formulas (Sami may share), calibrate our scoring to produce comparable results, or at minimum document the mapping between the two systems. Critical for Merck credibility. [added::2026-04-03]
- [x] **Infra: Migrate to dedicated Supabase project** [done::2026-05-06] — Audit complete: `gpc_analyses`, `gpc_profiles` identified. Migration plan documented in `docs/infra/supabase-migration-audit.md`. Next step: Trevor to provide new project credentials or approve automated project creation via CLI. [added::2026-03-21]
- [x] ~~**Auth: Per-account run quota system**~~ — Count-based limit in /api/analyze (default 10, env var override). Hard lock with 429 + client error message. Per-user overrides deferred to Supabase migration [added::2026-03-21] [done::2026-03-21]
- [ ] Review for enhancement opportunities [added::2026-02-26]

## Cancelled

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[null]}
```
%%
