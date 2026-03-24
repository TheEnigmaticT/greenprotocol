# Pipeline v2 Architecture

## Overview

Replaces the v1 pipeline (14 LLM calls) with a hybrid deterministic + LLM
pipeline (~6 LLM calls) that produces reproducible scores and more coherent
recommendations.

## Design Principles

1. **Score deterministically, recommend with LLM.** Numbers come from math,
   suggestions come from AI. The scientist gets both.
2. **Sequential recommendation groups.** Materials → Process → Operations.
   Each group sees what the previous group changed.
3. **Stream scores to UI.** Real numbers appearing is better UX than spinners.
4. **Before/after with accepted swaps.** Re-score after user accepts
   recommendations for a concrete improvement metric.
5. **Graceful degradation.** V1 pipeline is always one env flag away.

## Pipeline Phases

### Phase 1: Parse Protocol (1 LLM call, unchanged)
- Input: raw protocol text
- Output: protocolTitle, chemistrySubdomain, steps[]
- Each step: description, chemicals[] (name, role, quantity), conditions
- SSE: `{type: "phase", phase: 1, message: "Parsing protocol..."}`
- **No changes from v1**

### Phase 2: Rationalize Quantities (deterministic)
- Input: all chemicals from Phase 1
- Call: `POST /batch` to chemistry microservice
- Output: each chemical enriched with g, kg, mol, MW, density, SMILES
- SSE: `{type: "phase", phase: 2, message: "Converting quantities..."}`
- Duration: ~2-5s (PubChem lookups, cached after first run)

### Phase 3: Deterministic Scoring (deterministic + 0-3 surgical LLM)
- Input: enriched chemicals, steps, protocol_text
- Call: `POST /score` to chemistry microservice
- Output: 12 PrincipleScore objects with breakdowns
- Internal surgical LLM calls (handled by microservice):
  - Reaction SMILES extraction for P2 atom economy
  - Yield + reaction type classification for P1 PMI
  - Step classification for P8 Baran ideality
  - Monitoring assessment for P11 real-time analysis
- SSE: stream individual scores as they complete
  - `{type: "score", principle: 5, name: "Safer Solvents", score: 7.0,
     confidence: "calculated"}`
  - One event per principle as each score resolves

### Phase 4a: Recommend — Materials (1 LLM call)
- Principles: P3 (Less Hazardous), P4 (Safer Products), P5 (Safer Solvents), P10 (Degradation)
- Question: "What chemicals and solvents should be swapped?"
- Input: deterministic scores for P3/P4/P5/P10 with flagged chemicals + full protocol
- Output: recommendations[] with chemical swaps, rationale, yield impact, caveats
- SSE: `{type: "phase", phase: 4, message: "Generating material recommendations..."}`

### Phase 4b: Recommend — Process (1 LLM call, sequential after 4a)
- Principles: P1 (Waste/PMI), P2 (Atom Economy), P6 (Energy), P7 (Renewables),
  P8 (Derivatives), P9 (Catalysis)
- Question: "How should the reaction be redesigned?"
- Input: P1/P2/P6/P7/P8/P9 scores + Phase 4a material recommendations
  (so process changes account for the new materials)
- Output: process-level recommendations (route changes, catalyst additions,
  temperature optimization, step elimination)
- SSE: `{type: "phase", phase: 4, message: "Generating process recommendations..."}`

### Phase 4c: Recommend — Operations (1 LLM call, sequential after 4b)
- Principles: P11 (Real-Time Analysis), P12 (Accident Prevention)
- Question: "What monitoring and safety measures are needed?"
- Input: P11/P12 scores + Phase 4a material recs + Phase 4b process recs
  (monitoring needs depend on what chemicals and processes are used)
- Output: monitoring and safety recommendations
- SSE: `{type: "phase", phase: 4, message: "Generating safety recommendations..."}`

### Phase 5: Rewrite Protocol (1 LLM call)
- Input: original protocol + ALL recommendations + ALL deterministic scores
- Output: revised protocol text + overall assessment
- The LLM now has quantitative backing: "Replace DMF (P5: 7/10 hazardous,
  P3: 10/10 health risk) with Cyrene (P5: 1/10, P3: 2/10)"
- SSE: `{type: "phase", phase: 5, message: "Writing revised protocol..."}`

### Phase 6: Re-Score (deterministic, triggered by user action)
- Triggered when: user accepts/rejects recommendations in the UI
- Input: original chemicals with accepted swaps applied
  - For each accepted recommendation: replace original chemical with alternative
  - For rejected recommendations: keep original
- Call: `POST /score` with the modified chemical list
- Output: new set of 12 PrincipleScore objects
- UI shows: before/after comparison
  - "Grade C (36/90) → Grade A (12/90)"
  - Per-principle delta bars
  - "Accepting 5 of 12 recommendations improved your score by 67%"
- This is FREE — purely deterministic, no LLM calls

## LLM Call Summary

| Phase | LLM Calls | Purpose |
|-------|-----------|---------|
| 1. Parse | 1 | Extract protocol structure |
| 2. Rationalize | 0 | Unit conversions (deterministic) |
| 3. Score | 0-3* | Deterministic scoring (* surgical calls for P1,P2,P8,P11) |
| 4a. Materials | 1 | Chemical swap recommendations |
| 4b. Process | 1 | Reaction redesign recommendations |
| 4c. Operations | 1 | Monitoring + safety recommendations |
| 5. Rewrite | 1 | Revised protocol assembly |
| 6. Re-Score | 0 | Before/after comparison (deterministic) |
| **Total** | **~6** | **(down from 14 in v1)** |

* Phase 3 surgical calls are internal to the scoring service.
  They use the same LLM but are single-purpose/fast (~5s each).
  If cached (same protocol re-scored), they're instant.

## SSE Event Contract (backward compatible + new events)

```typescript
// Existing events (unchanged)
{type: "phase", phase: 1|2|3|4|5, message: string}
{type: "error", error: string, code?: string}
{type: "result", data: {...}}

// New events
{type: "score", principle: number, name: string, score: number,
 confidence: "calculated"|"benchmark"|"estimated"|"unavailable"}
{type: "recommendation_group", group: "materials"|"process"|"operations",
 status: "started"|"complete", count?: number}
{type: "rescore", scores: PrincipleScore[], grade: string,
 improvement_pct: number}
```

## Revised TypeScript Types

```typescript
interface AnalysisResultV2 extends AnalysisResult {
  // New fields added to existing type
  deterministicScores: PrincipleScore[]      // 12 scores from /score
  enrichedChemicals: EnrichedChemical[]      // with g/kg/mol/MW
  reactionSmiles?: string                    // extracted for P2
  yieldData?: YieldExtractionResult          // for P1
  scoreGrade: string                         // A-F
  scoreSummary: {
    total: number
    maxPossible: number
    availableCount: number
    unavailableCount: number
  }
  // Phase 6 (added after user accepts/rejects)
  rescoreResult?: {
    scores: PrincipleScore[]
    grade: string
    improvementPct: number
    acceptedCount: number
    rejectedCount: number
  }
}
```

## Failure Strategy

### Tier 1: Happy Path
Scoring service up, all principles scored, pipeline runs normally.

### Tier 2: Degraded Mode
Scoring service returns partial results (some principles fail/timeout).
- Available scores are used as-is
- Missing principles fall back to LLM-only evaluation (v1 behavior for
  those specific principles)
- UI shows which scores are deterministic vs LLM-estimated

### Tier 3: Offline Mode
Scoring service unreachable. Set `USE_V1_PIPELINE=true`.
- Entire v1 pipeline runs unchanged
- No deterministic scores in the output
- Zero risk to the April 2 demo

### Circuit Breaker
- If /score takes >15s, abort and fall back to Tier 2
- If /batch takes >10s, skip rationalization, let LLM handle quantities
- Track failure rate; if >50% of recent calls fail, auto-switch to Tier 3

## Implementation Plan

### Week 1 (MVP for demo)
1. Wire Phase 2 (/batch) into pipeline.ts after Phase 1
2. Wire Phase 3 (/score) into pipeline.ts
3. Add deterministic scores to AnalysisResult type
4. Show scores in UI alongside existing LLM recommendations
5. Add env var for scoring service URL
6. Keep v1 Phase 2 (12 parallel evals) for now — scores are additive
7. Deploy to feature branch preview URL for testing

### Week 2 (full v2)
1. Replace 12 parallel LLM calls with 3 grouped recommendation calls
2. Build sequential Phase 4a → 4b → 4c with feed-forward
3. Enhance Phase 5 (rewrite) with score context
4. Implement Phase 6 (re-score on accept/reject)
5. Before/after comparison UI
6. Circuit breaker + fallback logic
7. Load testing against demo protocol

### Post-demo
1. Streaming individual scores from /score endpoint
2. Score caching (same protocol = instant re-score)
3. Qwen compatibility testing on full v2 pipeline
4. Performance optimization (parallel where possible)

## Open Design Decisions

1. **Score streaming from microservice:** The /score endpoint currently
   returns all scores at once. To stream individual scores, we'd need
   a WebSocket or SSE endpoint on the microservice. For Week 1, we can
   fake it by calling /score and then emitting events one by one from
   the results. Real streaming is a post-demo optimization.

2. **Re-score scope:** When a user accepts "replace DMF with Cyrene,"
   do we re-score with just the name swap (Cyrene's GHS data replaces
   DMF's), or do we also re-run quantity calculations (Cyrene's density
   differs)? Proposal: full re-rationalize + re-score for accuracy.

3. **Prompt engineering for grouped recommendations:** The 3 grouped
   calls need carefully designed prompts that include the score context
   without being so long they hurt quality. Each prompt should include
   the specific scores, flagged chemicals, and confidence levels for
   its group's principles, plus a summary of other groups' findings.
