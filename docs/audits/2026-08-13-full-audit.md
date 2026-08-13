# GreenChemistry.ai — Full Code Quality & Security Audit

**Date:** 2026-08-13 · **Scope:** entire repo at `main` (73 commits ahead of origin, pre-0.7.0 bump) · **Method:** four parallel deep audits (security, code quality, architecture, functional correctness); critical claims spot-verified in source.

---

## Verdict

**The architecture is thoughtful and the newest code is genuinely good, but the product does not currently do what it claims.** The LLM recommendation pipeline (parse → 12-principle eval → literature re-evaluation → assemble) is well-engineered. The "deterministic scoring" half of the pitch is broken at three levels:

1. A fatal `NameError` in `services/chemistry/converter.py` has made all unit conversion / GHS enrichment dead since June (every `/batch` chemical returns `data_source: "error"`).
2. The chemistry service itself was decommissioned 2026-07-27 (Mac-mini launchd + tunnel killed) with no redeploy — its log shows only scanner noise, no real traffic.
3. When deterministic scoring fails, the UI **claims success**: "All requested chemical reference data was available" — the user cannot tell a degraded run from a clean one.

On top of that, the headline impact numbers (CO2e/water saved) assume 100% adoption of every recommendation, treat unknown alternatives as zero-footprint (systematically overstating savings), and are summed onto **public** profile pages.

Overall code quality: **C+ — "a prototype that grew a real product inside it."** The newest code (talk-about-this chat, solvent-evidence subsystem) is the best in the repo; the oldest, most business-critical code (scoring, impact math) is untested on both TS and Python sides.

---

## Critical — fix before promoting any RC to production

### 1. `converter.py` NameError — deterministic pipeline dead since June
`services/chemistry/converter.py:43` calls `resolve_synonym(...)`, which is never imported in that module (it lives in `synonyms.py`; only `main.py` imports it). Every `convert()` call raises `NameError`; `/batch` catches per-chemical and returns `data_source:"error"` for **every** chemical. Committed at HEAD (last touched in `cedc3e3`, 2026-06-08).
**Fix:** add `from synonyms import resolve_synonym` to converter.py; add a converter test so this class of break can't recur.

### 2. Literature/evidence tables have NO RLS — public write access to the RAG index
`supabase/migrations/20260510000000_create_vector_search.sql` and `20260731000000_create_literature_evidence_units.sql` contain no `ENABLE ROW LEVEL SECURITY`, no policies, no revokes. Under Supabase defaults, `literature_precedents`, `literature_source_documents`, and `literature_evidence_units` are readable **and writable** by the `anon` role — and the anon key ships in the browser bundle. Anyone can insert forged evidence units that get embedded, retrieved by `match_literature_evidence_units`, fed into every user's scoped chat, and persisted as citations — a durable stored prompt-injection channel into a chemistry-safety product. Or they can just delete the index.
**Fix:** new migration enabling RLS on all three tables + public-read-only policy + `REVOKE INSERT/UPDATE/DELETE FROM anon, authenticated`. Run ingestion with service-role key only (drop the anon fallback in e.g. `scripts/literature-ingestion/ingest-pmc.ts:15`). Inspect current table contents for injected rows.

### 3. Verify/drop `exec_sql` RPC in the live project
`apply_migration.js:14` (tracked, root-level) calls `supabase.rpc('exec_sql', { sql })` with a hardcoded anon key. If an `exec_sql(sql text)` function exists in the live project and is executable by anon/authenticated, that's arbitrary SQL with a public key. It's not in any migration — it either never existed or was created manually. Note the script targets project `jjxvlofcnyiqrtvwccsq` while CLAUDE.md says `xwcviwzwedljuuyfduso` — confirm which is production.
**Fix:** in SQL editor: `DROP FUNCTION IF EXISTS public.exec_sql(text);`. Delete `apply_migration.js` and `check_lit.js`.

### 4. Live accept/reject bug on the session page
`app/api/analyses/[id]/route.ts:58` requires `expected_revision_number` on PATCH, but `app/analyze/page.tsx` (the page users land on right after analysis) never sends it → every accept/reject 400s ("Failed to save") and decisions are lost unless the user later visits `/analyze/[id]`. The 409 revision-conflict handling was fixed only in the `[id]` copy of the page.

### 5. Impact math overstates savings and publishes them
- `app/api/analyze/route.ts:236` — `calculateImpactDelta` iterates **all** recommendations, not accepted ones; `impact_delta` assumes 100% adoption and is summed into public "CO2e saved" totals on `/u/[username]`.
- `route.ts:269` / `components/ImpactScoreboard.tsx:95` — alternatives not in the 50-chemical hardcoded `lib/chemicals.ts` get footprint **zero**, so "savings" equal the original's entire footprint. Most LLM-suggested alternatives (Cyrene, CPME, DES…) aren't in that table.
- Invented fallback masses (0.5 kg solvent / 0.1 kg other on TS side; 100 g / 10 g on Python side) silently dominate mass-weighted results while confidence stays "calculated."
- `lib/equivalencies.ts:8` — tree-seedling equivalency (45.5/tonne) overstated ~2.7× vs EPA's ~16.7 seedlings grown 10 years per tonne CO2e ([EPA equivalencies calc](https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator)).
- Hazardous-waste "eliminated" (`route.ts:280`) counts the original's full mass without checking whether the alternative is also hazardous.

---

## High

### Security
- **DOZN export route: no auth, no ownership check** — `app/api/export/dozn/[id]/route.ts:19-31` is the only API route that never calls `auth.getUser()` and has no `user_id` filter. It only fails today because it queries nonexistent table `analyses` (line 24) instead of `gpc_analyses`. The moment someone fixes the table name it becomes a full unauthenticated IDOR over customers' protocols (trade secrets). Fix auth + table + ownership together.
- **Chemistry service auth fails open** — `services/chemistry/main.py:41-46` only enforces the token `if configured_token`. Deploy without `CHEMISTRY_SERVICE_TOKEN` and `/score`, `/batch`, `/assistant-tools` are public; `/score` can trigger Anthropic calls. This is exactly the shape of the July incident (the old tunnel log shows active scanner probes). Fix: fail closed at startup unless an explicit local-dev escape hatch is set; update both infra docs (chemistry-vps.md currently documents the token as *optional*).
- **July key rotation still open** — the Anthropic key from the killed launchd plist was never rotated; rotate it (plus spend cap), and rotate `CHEMISTRY_SERVICE_TOKEN` in `services/chemistry/cache-sync.env` (live bearer token on disk; correctly gitignored and never committed, but stale since the incident).

### Correctness
- **`p1_waste_prevention.py:141`** — on the `benchmark_pmi_only` path `product_mass_g` is None → `round(None, 1)` → `TypeError` → entire `/score` 500s → no scores at all. Hit whenever there's no stated yield but a reaction-type benchmark exists — common, because:
- **P2 atom economy is permanently unavailable** — `pipeline.ts` never passes `reaction_smiles` to `/score`, and `smiles_extractor.py` is never invoked by anything.
- **Only 7 of 12 principles are scored** — `main.py` imports p1,2,3,5,6,11,12 only. `p4/p7/p8/p9/p10` (~700 lines) exist on disk, marked Done in BACKLOG (May), but were dropped during the 0.6 waste refactor and never rewired. The UI says "scoring against 12 principles"; the grade denominator quietly shrinks. Also `pipeline.ts:997` looks for a principle 13 that's never returned (dead code). The DOZN per-principle roadmap sits on top of scores that don't exist for 5 principles.
- **Projected "after" scores use different formulas than the "before" scores** — `lib/projected-scores.ts` claims "same deterministic formulas as the Python service, NOT estimates" but: P5 weights differ (TS {1,5,8,10} vs Python×10 {0,4,7,10}); TS P3 omits Python's 1.5× CMR multiplier; TS "recalculates" P10 which Python never scores; fallback masses differ (0.5/0.1 kg vs 100/10 g). Part of every before/after delta is an artifact of two different calculators. Also duplicated GHS H-code tables in `projected-scores.ts:13-25` vs `ghs.py` will drift.
- **Regrade destroys history** — `app/analyze/page.tsx:132` overwrites `deterministicScores` with the rescore result; the original baseline is gone for future before/after comparisons.
- **Dishonest degraded state** — `pipeline.ts:744-835`: service down → enrichment silently skipped → `chemistryDataStatus` reports "All requested chemical reference data was available" (`:1030`) and claims items were "queued" when nothing was. Only `data_source === 'not_found'` flags a chemical as unresolved (`:761`); `"error"` (the current universal state) is never flagged. `lib/validate-provenance.ts` — the taxonomy enforcer — is imported only by its own test.
- **No retry logic in the LLM core** — `pipeline.ts:144-227`: one transient 429/529 on parse aborts the whole analysis. Phase 2 tolerates per-principle failure; parse and assemble have no second chance, no backoff anywhere.
- **Cost tracing misses ~90% of spend** — `evaluatePrinciple` (`pipeline.ts:267`) and `reevaluateRecommendation` (`:447-452`) never forward `context` to `callClaude`, so the 12 principle calls + N re-evaluation calls (the expensive phases) never reach `gpc_analysis_traces`; `getAnalysisCostReport` is systematically wrong (and `trace.ts:121` prices at 2024 Claude 3.5 rates).

---

## Medium

- **Rescore swap matching is exact-string** — `app/api/rescore/route.ts:34,41` matches `rec.original.chemical` to step chemicals by exact lowercase equality (rest of codebase uses fuzzy containment). "DCM" vs "Dichloromethane" → swap silently doesn't apply → "rescored" grade equals original, making the recommendation look worthless. Step description text also retains the old chemical names. (Note: today the rescore path 503s anyway — service is down.)
- **Public profile leaks `user_id`** — `app/api/profile/[username]/route.ts` does `select('*')` with the service-role client and returns the raw row; separately, `gpc_profiles` has a `USING (true)` SELECT policy allowing full-table enumeration via the anon key. Return only username/display_name/created_at.
- **`/api/analyze` abuse surface** — no max protocol length (min is 20 chars); `ANALYSIS_RUN_LIMIT` counts `gpc_analyses` rows which are only inserted on **success** (failed/aborted runs = unlimited Anthropic spend) and is check-then-act racy. Count `gpc_analysis_runs` (inserted pre-pipeline) instead and cap input length.
- **No rate limiting on chat or rescore** — every chat message = up to 5 OpenRouter rounds + OpenAI embeddings; no per-user throttle anywhere except analyze.
- **Workup-solvent undercounting** — parse prompt tags wash/extraction solvents `workup`, which every solvent filter then excludes (`p5_safer_solvents.py:43`, `waste_helpers.py:39` — which also disagree on the exclusion string). The biggest waste mass in most protocols is undercounted in P5 and waste analysis.
- **`waste_helpers.py:62-75`** — the "liquid" test is true for nearly every converted chemical (solids counted as liquid burden); undocumented 0.6 "discarded" factor.
- **Grade honesty** — `main.py:173` averages only *available* principles: 2 data points can produce an "A" with no caveat.
- **PMI theoretical-yield math** (`p1:70-77`) misapplies atom economy to the limiting reagent's MW (currently unreachable, but wrong when P2 gets wired).
- **Sequential re-evaluation vs 300s ceiling** — `reevaluateAllRecommendations` (`pipeline.ts:497`) runs one Sonnet call per recommendation sequentially; BACKLOG records 38–67-rec runs → ~55–85 LLM round-trips against Vercel's `maxDuration=300`. Big protocols (the ones enterprise users care about) will time out first. Pipeline-v2's grouped design (~6 calls) was documented but never built.
- **Talk-about-this telemetry is structural whack-a-mole** — 26 commits on Aug 12 alone; same tool-run datum computed in two places with clobber-merge (`agent.ts:406-416` vs `messages/route.ts:60-103`); `awaitDiagnosticPersistence` races a hardcoded 250 ms timer (`messages/route.ts:23-42`). Telemetry is also smuggled into the `citations` jsonb as a union type (`repository.ts:86`, pushed at `:330`) — separate columns would delete the whole bug class. The core agent loop is fine; this is the layer that will regress again.
- **`stop_reason` unchecked** on forced-tool calls (`pipeline.ts`) — a `max_tokens`-truncated tool block could yield partial input silently. `toolBlock.input as T` is an unchecked cast.
- **Model pinning** — `claude-sonnet-4-5-20250929` pinned independently in `pipeline.ts:15` and `llm_client.py:25`; a Sep-2025 model in Aug 2026, worth a freshness pass, and it should be one shared config value.
- **Hardcoded privileged email** `trevor.longino+gc1@gmail.com` in `app/api/analyze/route.ts:12`; `*@greenchemistry.ai` domain grants unlimited runs (fine while you control all mailboxes).

---

## Architecture / dead-end risks (ranked by future pain)

1. **`analysis_result` JSONB blob as system of record with three competing writers** — whole-blob client PATCH with optimistic revision; a SECURITY DEFINER RPC that `jsonb_set`s `isAccepted` **by array index** (fragile vs the pipeline's rank-sorting; business logic in PL/pgSQL — `20260812000000_secure_talk_actions.sql:127-151`); rescore reading acceptance back out of the blob. This already shipped the session-page bug and directly blocks 0.8 roadmap items (mode-specific scorecards, export-accepted-protocol, enterprise weighting) because per-recommendation state is unqueryable. **Remediation:** extract a `gpc_recommendation_decisions` table keyed by the `rec.id` UUID the pipeline already stamps; blob becomes immutable pipeline output; the RPC inserts a row; whole-blob PATCH dies. *Do this before building 0.8 features into the blob.*
2. **7/12 scoring + dead scorers** (above) — cheap, high-leverage: one PR to import/wire p4/p7/p9/p10, route p8 through the existing yield/reaction-type call, pass parse-phase SMILES into `/score`.
3. **Scoring logic duplicated across the TS/Python boundary** — GHS tables, CHEM21 weights, 53 hardcoded `LOCAL_INDEXED_SOLVENTS` names (`tools.ts:22-32`), rescore route re-implementing pipeline enrichment plumbing, chat tools bypassing `chemistry-service.ts` with a third raw-fetch client. Declare Python the only scoring authority; projected scores should call `/score` in projection mode.
4. **Two-and-a-half copies of the results page** — `/analyze` (session) vs `/analyze/[id]` ~85% identical with divergence bugs already shipped ×3 (PATCH bug, Evidence Atlas only on `[id]`, chat approval receipts only on `[id]`), plus **unmounted** `AnalysisResults.tsx` (544 lines) that people have repeatedly "fixed." **Remediation:** `/api/analyze` already returns the persisted id — redirect to `/analyze/[id]` on completion, shrink `/analyze` to input+progress, delete `AnalysisResults.tsx`.
5. **No blessed chemistry-service deployment** — Cloud Run runbook, Hetzner VPS runbook, and the killed Mac-mini tunnel coexist; nothing in-repo says which is canonical, and production currently degrades silently to LLM-only scoring (see "dishonest degraded state"). Pick one (Cloud Run doc is the most complete), delete the other, and make degradation loud.

**Vestigial code to delete** (~1,700+ lines): `components/AnalysisResults.tsx` + exclusive children (`QuickWins`, `WasteScoreCard`, `WasteDetailsPanel`, `ImpactCard`, `ScrollBackground`, `AnalysisSkeleton`); the entire `literature_precedents` stack (`lib/vector-search.ts`, `scripts/literature-ingestion/` TS pipeline — superseded by `literature_evidence_units`); `lib/scoring/waste.ts` + `purification.ts` (stubs returning hardcoded 0.75/0.5 — landmines); `smiles_extractor.py` (until wired); root `apply_migration.js`, `check_lit.js` (hardcoded JWTs), `TASK_t_4621bfb1_COMPLETE.md`, `scripts/add_tracing.py` + codemod artifacts; empty `launchagents/`.

---

## Quality notes

- **Toolchain:** `tsc --noEmit` clean. `npm run lint`: 10 errors / 9 warnings — mostly in cruft files; 2 real (empty interfaces in `TalkAboutThis.tsx:10,20`). Vitest/pytest could not be executed in the audit session (sandbox denied test runners); coverage mapped statically.
- **Test coverage is inverted:** 19 vitest files (~4,300 lines) but concentrated on the newest feature (talk-about-this: 11 files). Zero tests for: Python scoring core (`scoring/`, `converter.py`, `ghs.py`, `parser.py`, `/score`), `lib/chemicals.ts` (1,310 lines of impact data), `calculateImpactDelta`, `projected-scores.ts`. The product's headline numbers are unverified; `parser.py:14` has a duplicate `"ml"` dict key nobody caught. E2E = 2 Playwright smoke tests.
- **God-component:** `TalkAboutThis.tsx` (791 lines, 14 useState + 4 refs, ~140-line send handler); hand-rolled SSE parser duplicated with a *different* wire format in `ProtocolInput.tsx:158-208`. Needs `useReducer` + shared `lib/sse.ts`.
- **Copy-paste tokens:** `GRADE_COLORS` byte-identical in 4 files; `SeverityBadge` ×3; provenance labels already drifted between `ScoreCard.tsx` and `PrincipleSection.tsx`.
- **Inconsistent degradation by design:** chemistry-service downtime → pipeline silently proceeds scoreless; rescore 503s; chat tools throw per-call. Three behaviors for one dependency.
- **Chat approval UX traps:** triggers on exact English phrases (`actions.ts:19-29`); `UNIQUE(conversation_id, action_type)` permits one approval per conversation *forever*.

## Low / hygiene

- Raw `error.message` returned to clients (`app/api/talk-about-this/route.ts:75-76`).
- Unguarded `enqueue` in messages SSE `finally` (`messages/route.ts:374-381`) — unhandled rejection on client disconnect (analyze route guards this; this one doesn't).
- No DELETE policies/routes on `gpc_` tables — users can't delete their data (privacy/retention).
- Hardcoded anon JWTs in tracked files (`apply_migration.js`, `check_lit.js`, `scripts/literature-ingestion/quick-test.mjs`, one docs plan) — anon keys are public by design, but delete the cruft.
- `services/dozn-export-script.gs` consumes fields the API never returns (`data.chemicals`); placeholder URLs — scaffolding, not a feature.

---

## What's genuinely solid — don't touch

- **Per-route authn/authz** is consistent (`auth.getUser()` on every route except DOZN) and no cross-user IDOR was found. *Correction from second audit (see Reconciliation): `rescore` authenticates but re-scores caller-supplied `analysis` JSON rather than loading the owned row — a compute-abuse/provenance gap, not IDOR.* Optimistic concurrency (revision + DB trigger backstop) is the right instinct — it just needs one writer protocol.
- **RLS is present on all `gpc_` tables and owner-scoped for the sensitive ones**; `gpc_talk_actions`/`gpc_talk_tool_runs` go further (client writes revoked; SECURITY DEFINER RPCs with ownership re-verification, row locks, scope-hash checks, idempotency, pinned `search_path`). *Correction from second audit: `gpc_analysis_traces` and `gpc_dedup_log` grant client `INSERT`/`UPDATE` (self-scoped) — the audit/cost ledger is user-fabricable; not a cross-user leak but it undercuts trace trustworthiness.*
- **The talk-about-this agent loop is a model of bounded tool design:** frozen hashed context snapshot, enum-constrained schemas, server-side re-validation of every argument against the scoped chemical list, bounded rounds/calls/deadlines, no LLM write tools (approval is an exact-phrase, server-side action), sha256-digested diagnostics. Prompt-injected literature cannot cause writes. The "filter unsafe persisted chat evidence" fix is complete for its purpose.
- **XSS/exfil-safe LLM rendering:** ReactMarkdown with `skipHtml`, links inert, images stripped; no `dangerouslySetInnerHTML` anywhere. No open redirect in auth callback.
- **Python service shape:** clean per-principle modules with uniform `PrincipleScore`, `secrets.compare_digest` token check, no eval/exec/subprocess/pickle, fixed-host PubChem/PubMed clients (no SSRF), pydantic bounded fields. The solvent-evidence subsystem (frozen dataclasses, thread-safety tests) is the best code in the repo.
- **SSE analyze route:** heartbeats, correct stream lifecycle, audit-run bookkeeping, differentiated errors. Phase 2.7 re-evaluation design (candidate-evidence guardrails, `enforceCandidateOnlyReevaluation`) is exactly the anti-hallucination posture the product sells.
- **Secrets hygiene:** `.env*`, `cache-sync.env`, logs never committed anywhere in history; CI uses GitHub secrets.
- **ScoreCard's provenance legend** (`*`/`~`/`≈`) is an honest UI pattern — it just isn't fed honest inputs everywhere yet.

---

## P0 remediation status (2026-08-13)

Code fixes landed on `main` (verified: `tsc` clean, 190 vitest pass, 55 Python pass + 2 pre-existing env failures unrelated to these changes, lint errors 10→6 all pre-existing):

- ✅ **Converter `NameError`** — added `from synonyms import resolve_synonym` to `converter.py`; regression test `test_converter.py` (offline) guards it.
- ✅ **Literature-table RLS** — migration `20260814000000_secure_literature_tables.sql` enables RLS + public-read + revokes anon/authenticated writes on all three tables; anon-key fallback dropped from all 5 ingestion scripts. *Ops: apply the migration to the live DB and inspect for already-injected rows (P0.5).*
- ✅ **DOZN removed entirely** (partnership didn't happen) — deleted the unauthenticated export route, the Apps Script, the `dozn_equivalent_score` field, README/task cruft.
- ✅ **Chemistry service fails closed** — `main.py` refuses to boot without `CHEMISTRY_SERVICE_TOKEN` unless `CHEMISTRY_SERVICE_ALLOW_ANONYMOUS=1`; per-request check hardened; `test_service_auth.py` covers it; infra doc corrected. *Ops: redeploy the service, rotate the July Anthropic key + service token, verify/drop `exec_sql` (P0.5).*
- ✅ **Session accept/reject** — `app/analyze/page.tsx` now sends `expected_revision_number` and reconciles from the response (fixes the silent 400 / lost decisions).
- ✅ **Honest degraded state** — `data_source:"error"` now counts as unresolved; `chemistryDataStatus` carries `deterministicScoringAvailable` and stops claiming "all reference data available"/"queued" when scoring didn't run; `ChemistryDataNotice` shows a distinct "scoring unavailable" state.
- ✅ **Local cruft** — deleted `apply_migration.js` / `check_lit.js` (hardcoded JWTs + `exec_sql` call site).

**Still open before promoting to production:** the P0.5 live-verification/ops items above (migration apply, service redeploy, key rotation, `exec_sql` check, confirm production project ref). Then P1 (impact-math honesty, wire 5 missing scorers, retry/backoff, rescore-loads-owned-row).

## Reconciliation — second adversarial audit (2026-08-13, Opus 4.8)

An independent adversarial audit reviewed both the codebase and this report. **The central diagnosis was confirmed** — it independently *reproduced* the converter `NameError` (`converter.convert('DMF','1 mL')` → `NameError: name 'resolve_synonym' is not defined`), confirmed the configured chemistry service was unreachable, and confirmed the dishonest "all reference data was available" status path (`pipeline.ts:761` classifies only `not_found`, never `"error"`, as unresolved → `:1025-1030` reports success). All Critical/High correctness findings above (7/12 principles, P2 unavailable, P1 `round(None)` crash, impact overstatement, projected-vs-server formula divergence, regrade-destroys-baseline, no retry, timeout risk, JSONB system-of-record, profile `user_id` leak, dead provenance validator, chat raw errors, 250 ms diagnostic race) were independently confirmed.

**Corrections it made to this report (verified in source, folded in above):**
1. **`rescore` authorization was overstated.** It authenticates but re-scores a caller-supplied `AnalysisResult` (`app/api/rescore/route.ts:19-28`) instead of loading the owned `gpc_analyses` row. Not IDOR, but it permits unbounded client-chosen scoring compute and makes "regraded" provenance unreliable. **New P1 item.**
2. **"RLS on all gpc_ tables correct" was overstated.** `gpc_analysis_traces` and `gpc_dedup_log` grant client `INSERT`/`UPDATE` (self-scoped, `20260801000000_...:45-61`) — a user can fabricate their own trace/cost rows. Undercuts audit-ledger trust; low severity (no cross-user exposure). **New Low item.**
3. Seedling factor corrected to ~2.7× vs EPA ~16.7 (was ~2.8×/16.5).

**Claims it (correctly) downgraded from asserted-fact to needs-live-verification** — the repo evidence is strong but these can't be proven from source alone; treat as external verification items, not settled facts:
- Literature-table **"public write access"** — migrations prove RLS is *absent*; live role grants / any manual remediation must be checked in the Supabase dashboard before assuming exploitable.
- **`exec_sql` as live RCE** — `apply_migration.js` proves the call site and anon-key fallback exist; whether the function exists and is anon-executable in the live project is unverified.
- **July decommission / "no real traffic" / keys never rotated** — depend on deployment + secret-manager evidence, not repo state. (Second audit did independently confirm the configured endpoint is currently unreachable.)
- **"~90% of LLM spend untraced"** — mechanism confirmed (`context` not forwarded at `pipeline.ts:258-268,441-452`); the exact magnitude is plausible but not quantified.
- Lint counts, the "26 commits on Aug 12," and vitest results were not independently re-run.

**Net:** two reviews, one conclusion — the scoped-chat work is materially stronger than the scoring/impact core, and the immediate problem is not the chat feature but that the core numerical claims are currently *neither available nor honestly represented*. No finding from either audit was refuted by the other.

## Prioritized fix list

**P0 — before promoting 0.7 to production**
1. `from synonyms import resolve_synonym` in converter.py + a converter test (unblocks everything deterministic).
2. RLS migration for the three literature tables; drop anon-key fallback in ingestion scripts; inspect for injected rows.
3. Fix DOZN export route (auth + ownership + `gpc_analyses`) or delete it until real.
4. Fail-closed token check in `main.py`; redeploy the chemistry service somewhere canonical (Cloud Run); rotate the July Anthropic key + `CHEMISTRY_SERVICE_TOKEN`; verify/drop `exec_sql`.
5. Send `expected_revision_number` from `app/analyze/page.tsx` (or ship the redirect-to-`/analyze/[id]` consolidation, which fixes it structurally).
6. Honest degraded state: flag `data_source:"error"`, stop claiming "all reference data available"/"queued" when the service is down or erroring.

**P1 — correctness of the numbers**
7. `calculateImpactDelta`: accepted recs only; unknown alternatives = "unknown savings," not zero-footprint; fix `p1:141` None-crash; fix seedling constant; preserve pre-rescore baseline.
8. Wire p4/p7/p9/p10 + p8 + reaction SMILES → real 12-principle scoring.
9. Kill formula duplication: projected scores call `/score` in projection mode; single source for GHS/CHEM21 tables.
10. Retry/backoff in `callClaude`; forward `context` in `evaluatePrinciple`/`reevaluateRecommendation` (two-line fix); batch re-evaluation (grouped calls) to fit the 300s ceiling.
10b. **`rescore` should load the owned `gpc_analyses` row by id** (auth + `.eq('user_id', user.id)`) and re-score *that*, not trust a client-supplied `AnalysisResult` — restores provenance and closes the compute-abuse gap.

**P0.5 — live verification (do before trusting the P0 severities; dashboard/CLI, not repo)**
- Inspect live Supabase role grants on the three literature tables + confirm whether `public.exec_sql(text)` exists and is anon/authenticated-executable; check literature tables for already-injected rows.
- Confirm the current `CHEMISTRY_SERVICE_URL` target and whether it's reachable/authenticated; confirm the July Anthropic key + `CHEMISTRY_SERVICE_TOKEN` were rotated.
- Confirm which Supabase project is production (`jjxvlofcnyiqrtvwccsq` per `apply_migration.js` vs `xwcviwzwedljuuyfduso` per CLAUDE.md).

**P2 — structure for 0.8**
11. `gpc_recommendation_decisions` table; blob becomes immutable; retire whole-blob PATCH + array-index jsonb_set.
12. Single results page (redirect to `/analyze/[id]`); delete `AnalysisResults.tsx` + dead components.
13. Delete the `literature_precedents` stack and root cruft; one blessed deployment doc.
14. Tests around scoring math (both sides) before the DOZN per-principle work; run-limit on `gpc_analysis_runs` + max input length; rate limits on chat/rescore.
