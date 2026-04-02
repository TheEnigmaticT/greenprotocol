---

kanban-plugin: board

---

## Backlog

- [ ] **Infra: Migrate to dedicated Supabase project** — Audit all `gpc_` tables, auth config, RLS policies; plan migration from shared CrowdTamers workspace (xwcviwzwedljuuyfduso) to standalone project; execute with zero-downtime cutover; update all env vars in Vercel [added::2026-03-21]
- [x] ~~**Auth: Per-account run quota system**~~ — Count-based limit in /api/analyze (default 10, env var override). Hard lock with 429 + client error message. Per-user overrides deferred to Supabase migration [added::2026-03-21] [done::2026-03-21]
- [ ] **Auth: E2E test new account signup** — Test email confirmation flow, Google OAuth flow, redirect to dashboard; verify middleware blocks unauthenticated access to /analyze [added::2026-03-21]
- [ ] **Infra: Staging + Production environments** — Separate Vercel deployments for staging vs prod; staging auto-deploys from main, prod deploys from release tags or manual promote; separate Supabase projects per environment [added::2026-03-21]
- [ ] **Infra: CI/CD pipeline** — GitHub Actions for: lint + typecheck on PR, build verification, automated tests (when we have them), deploy to staging on merge to main, manual promote to prod [added::2026-03-21]
- [ ] **UI: Mobile viewport improvements** — Better responsive layout for demo scenario (GC.ai running on mobile-sized viewport alongside slideshow). Ensure analysis progress, results, and accept/reject all work well at small screen sizes [added::2026-03-21]
- [ ] **UI: "Quick Wins" summary view for Millipore Sigma** — Stripped-down output showing only the top chemical swaps (1-3) with direct drop-in replacement instructions. Purchasing accelerator framing: original chemical → recommended swap → Millipore Sigma catalog link. Separate from full 12-principle analysis [added::2026-03-21]
- [ ] **Demo: April 2 pitch deck** — Slides for Millipore Sigma presentation. Narrative: DOZN is the best pre-AI scorecard, GC.ai turns it into a coach. Frame as Web 2.0 → AI era (iterative, transparent, human as discriminator). Include roadmap for next 6 months. Demo flow: paste protocol, talk through background processing while results generate live on mobile viewport [added::2026-03-21]
- [ ] **Website: Make greenchemistry.ai production-ready** — Current site is a stub. Needs to be serious enough for enterprise prospects. Target: by end of April, potentially show logos from Millipore Sigma, CST, MIT, Apple if LOIs secured [added::2026-03-21]
- [ ] **UI: Citations per principle** — Show data source citations for each of the 12 principle evaluations. Currently not surfaced. Pick one principle to fully cite for the Millipore Sigma demo [added::2026-03-21]
- [ ] **Biz: LOI/NDA templates** — Prepare letter of intent and NDA templates for greenchemistry.ai LLC (not Longino Consulting). Needed for CST engagement starting next week [added::2026-03-21]
- [ ] **Biz: Corporate entity setup** — LLC this weekend, then C Corp → B Corp certification path. 51/49 ownership (Trevor/Chris). Research B Corp requirements, board independence from LabreNew [added::2026-03-21]
- [ ] **Bug: Investigate triazolo result inconsistency** — 3 runs of same protocol: 2 produced ~38 recs, 1 produced 67 recs. All completed fully (no timeouts). Outlier used more granular per-step decomposition with lower confidence. Root cause: LLM non-determinism. **Note:** The deterministic scoring formulas backlog (11 principles) will largely resolve this — once recommendations are grounded in quantitative scoring, LLM variance only affects wording, not substance. Short-term mitigations if needed: lower temperature, tighter output constraints, or deduplication [added::2026-03-21]
- [ ] **Qwen: Abstract AI provider interface** — Refactor lib/pipeline.ts to support swappable LLM backends (Anthropic SDK vs OpenAI-compatible endpoint); create provider config [added::2026-03-21]
- [ ] **Qwen: Local endpoint configuration** — Add config for Qwen 3.5 127B on M5 Mac Studio (256GB RAM); OpenAI-compatible API endpoint; model selection via env var [added::2026-03-21]
- [ ] **Qwen: Validate structured output schemas** — Re-test all 3 pipeline phases (parse, evaluate, assemble) against Qwen tool-use/JSON format; document schema compatibility gaps [added::2026-03-21]
- [ ] **Qwen: Benchmark vs Claude Sonnet 4.5** — Run triazolo-peptidomimetics protocol 5+ times on both models; compare output quality, latency, consistency, recommendation count variance [added::2026-03-21]
- [ ] **Qwen: Test streaming SSE** — Verify SSE heartbeat and progress events work with local model endpoint; test Phase 2 parallel principle evaluation [added::2026-03-21]
- [ ] Create full vector database search.
- [ ] Do backlogged data retrieval from PubMed.
- [ ] Due backlogged data retrieval from Sci-Hub.
- [ ] Find moderately complex chemical reaction for Home Page demo (Blocked: Pending @Chris Carter) [added::2026-03-12]
- [ ] Fix home page to show complete start-to-finish results for the demo reaction.
- [ ] **Scoring: Unit conversion engine** — Build robust quantity parsing in the Python microservice: extract raw values + units from LLM, then convert between mol/g/mL/M/equiv using verified MW and density from PubChem/RDKit (NOT LLM math). Store both `quantityKg` and `quantityMol` for every chemical. Foundation for all scoring. [added::2026-03-15]
- [ ] **Scoring: Python microservice** — Set up FastAPI + RDKit on Google Cloud Run with Docker, PubChem API integration, chemical name → SMILES resolution pipeline [added::2026-03-15]
- [ ] **Scoring: P3 Less Hazardous** — GHS hazard scoring formula (H-codes × quantity), PubChem PUG-View fallback for chemicals not in DB [added::2026-03-15]
- [ ] **Scoring: P5 Safer Solvents** — Import CHEM21 full CSV from AI4Green, weighted score by mass [added::2026-03-15]
- [ ] **Scoring: P6 Energy Efficiency** — Parse numeric temperatures from strings, score by deviation from ambient [added::2026-03-15]
- [ ] **Scoring: P7 Renewable Feedstocks** — Add `isRenewable` boolean to chemical database, scoring formula [added::2026-03-15]
- [ ] **Scoring: P9 Catalysis** — Score catalytic vs. stoichiometric reagent ratio from parsed roles [added::2026-03-15]
- [ ] **Scoring: P10 Degradation** — Environmental persistence scoring from GHS environmental hazard codes [added::2026-03-15]
- [ ] **Scoring: P11 Real-time Analysis** — AI-assessed score for monitoring opportunities [added::2026-03-15]
- [ ] **Article: Green Analytical Chemistry (GAC) Review** — Integrate principles from "Green Analytical Chemistry: A critical review" (ScienceDirect 2025) into P11 scoring and real-time analysis framework. <https://www.sciencedirect.com/science/article/abs/pii/S0003267025004465> [added::2026-03-17]
- [ ] **Scoring: P12 Accident Prevention** — Physical hazard scoring from GHS codes (flammability, explosivity) × quantity [added::2026-03-15]
- [ ] **Scoring: P1 Waste/PMI** — Reaction-type classifier → yield lookup from ACS GCI data → PMI range calculation [added::2026-03-15]
- [ ] **Scoring: P2 Atom Economy** — PubChem name→SMILES → rxnSMILES4AtomEco calculation, LLM reactant/product role extraction [added::2026-03-15]
- [ ] **Scoring: P4 Product Toxicity** — PubChem GHS lookup for known compounds, ProTox 3.0 prediction for unknowns [added::2026-03-15]
- [ ] **Scoring: P8 Reduce Derivatives** — Rxn-INSIGHT reaction classification, Baran ideality metric, synthesis-type context adjustment [added::2026-03-15]
- [ ] **Scoring: Before/After Prediction** — Re-run scoring formulas with alternative chemicals substituted, AI prediction for estimated principles [added::2026-03-15]
- [ ] **Scoring: UI** — Per-principle score bars, summary scorecard/radar chart, confidence indicators (calculated vs. AI-estimated), before/after visualization [added::2026-03-15]
- [ ] **Scoring: Validation** — Run against known protocols, compare with DOZN scores for sanity checking [added::2026-03-15]
- [ ] **Audit: Pipeline process trace** — Store per-LLM-call traces (model, tokens in/out, latency, raw request/response) in `gpc_analysis_traces` table. Store pre-dedup recommendations + merge map in `gpc_dedup_log`. Enables: cost accounting, "why did it recommend X" forensics, dedup transparency, model version tracking. ~15 JSONB rows per analysis, negligible storage. Wire into `callClaude` helper and dedup step in pipeline.ts [added::2026-04-02]


## Next

- [x] ~~**BLOCKED: Get original protocol text** for triazolo-peptidomimetics synthesis that produced the DOZN spreadsheet — @Chris Carter to secure~~ RESOLVED: Protocol secured [added::2026-03-16] [done::2026-03-21]
- [x] ~~Add `isAccepted` boolean support to Supabase `gpc_analyses` save/load flow~~ (persisted in analysis_result JSONB via PATCH /api/analyses/[id]) [added::2026-03-12] [done::2026-03-21]


## In Progress

- [ ] Create Environmental Impact Cover Sheet for Print layout [added::2026-03-12]
- [x] ~~Implement Accept/Reject logic for recommendations~~ (UI done, session storage done, Supabase PATCH persistence done, debounced API calls, works on both /analyze and /analyze/[id] routes) [added::2026-03-12] [done::2026-03-21]


## In Review



## Done

- [ ] Review for enhancement opportunities [added::2026-02-26]


## Cancelled





%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[null]}
```
%%