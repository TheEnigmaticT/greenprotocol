# Analysis Reproducibility Staging Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Correct observed extraction/grounding/missing-data defects, preserve auditable scoring inputs, and qualify the candidate in existing staging without changing production.

**Architecture:** Preserve raw source and distinguish it from interpreted material identity. Deterministic quantity parsing must never collapse formulation variants or invent amounts. An immutable versioned scoring-input manifest supports explicit replay; refreshed analysis remains an explicit new run rather than hidden cached scoring. Missing data blocks affected quantitative claims and contributes coverage metadata, never a zero or assumed mass.

**Tech Stack:** Next.js/TypeScript/Vitest, Python/Pydantic/pytest, existing Supabase staging and Cloud Run staging, GitHub CI and Vercel preview/main.

## Frozen ownership and interfaces

- Packet A owns Python services/chemistry/scoring/**, services/chemistry/main.py, and new targeted Python honesty tests. No parser.py, converter.py or TypeScript edits. Recover targeted semantics from 0aad62e, not wholesale unrelated infrastructure. Existing PrincipleScore -1 unavailable convention retained; validate cross-fields after construction. Add optional explicit coverage/status metadata compatibly where necessary.
- Packet B owns lib/declared-products.ts, lib/material-names.ts if needed, lib/prompts/parse.ts, a new lib/analysis-input-validation.ts, and targeted tests for these modules. No lib/pipeline.ts or lib/types.ts edits. Export validateParsedAnalysisInputs(steps, source): { steps: AnalysisStep[]; warnings: string[] } from analysis-input-validation.ts. The helper conservatively flags ambiguous multi-formulation quantities, preserves all source amounts, never chooses first amount or sums separate variants, and never silently deletes known source products. Narrow alpha typography equivalence is allowed for source grounding; no broad chemistry-string folding.
- Packet C owns services/chemistry/parser.py and quantity parser tests only. Support supplementary mass/mol/equivalent annotation, annotated single amounts, repeated wash volumes; reject multi-formulation aggregates, incompatible multiple quantities, pore sizes as material amounts, qualitative quantities. No representative masses.
- Parent owns pipeline/types/chemical-inputs/model adapter/version/manifest wiring, UI coverage, plan/runbook, integration and staging deployment. Parent coordinates review before merging main. No production writes, branch promotion, credential/config changes, or raw customer fixtures in Git.

## Task 1: establish regressions and safety semantics
For each packet, write behavioral failing tests before source edits, record RED command/output outside Git in scratch, implement minimum fix, run GREEN plus affected existing suite. Synthetic fixtures reproduce the observed shapes without copying customer protocols or identifiers. Unknown hazard evidence is not proof of safety. Missing mass disables affected mass-weighted calculations; an explicit partial summary must not imply a complete overall grade.

## Task 2: extraction boundaries
Ground Greek alpha against the explicitly present Latin-alpha source span with narrowly audited equivalence and retain source identity. Invalid quantity annotations remain visible with warnings. Function and process-use distinctions must not cause workup solvents to disappear; conservatively represent ambiguous role classification rather than treating every workup chemical as solvent. Parent integrates helper calls and provenance.

## Task 3: immutable input/replay contract
Persist a versioned canonical input manifest inside existing analysis_result JSON (no migration unless demonstrably needed). Include raw source digest, extracted step/occurrence context, source labels, quantity provenance/status, validated reference identities/status, model/config/prompt/schema/method versions and a content digest. Add explicit replay validation: only same manifest and method/reference versions qualify; do not restore hidden canonical-score caching. Existing fresh analyze stays fresh. Avoid exposing source/customer data in deployment receipts.

## Task 4: parent verification and two-stage review
Run focused regressions, Python affected/full suites, web tests, TypeScript, lint, Next build, and security/spec then code-quality review. Preserve unrelated BACKLOG.md dirty work in original checkout. Never weaken CI expectations to get green. Exercise exact freeze/replay behavior with malformed/cross-version negative controls.

## Task 5: staging activation and acceptance
Use existing staging.greenchemistry.ai / Supabase qqyzyezwlzvckjtggoes / Cloud Run gcai-chemistry, not root Supabase CLI default (production). Discover live targets and save baseline before writes. Push reviewed branch and open PR to main; merge only green scoped candidate. Dispatch existing main-only staging deployment after exact-SHA CI success. Verify exact web SHA and chemistry digest/revision, authenticated analysis/save/reload, no fabricated quantities, product grounding, incomplete coverage, and deterministic frozen-input replay. Fresh extraction correctness is assessed separately from exact replay stability. Read back production refs/config identifiers unchanged. Report blockers explicitly; staging-ready is not production approval.
