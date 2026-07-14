# Provenance Implementation Map

This document maps every existing score/metric path in the codebase to one of the five canonical provenance states.

## Current State Mapping

### Backend: Python Scoring Modules

| Module | Principle | Current `confidence` Value | Correct Provenance | Data Sources |
|--------|-----------|---------------------------|-------------------|--------------|
| `p1_waste_prevention.py` | P1 | `"calculated"` | **Calculated** (when yield stated) or **Benchmark-derived** (when yield inferred) | `unit_converter`, `ACS_GCI_benchmarks` |
| `p2_atom_economy.py` | P2 | `"calculated"` | **Calculated** | `rdkit` |
| `p3_less_hazardous.py` | P3 | `"calculated"` | **Calculated** | `pubchem_ghs` |
| `p4_product_toxicity.py` | P4 | `"estimated"` | **Model-inferred** | `ai_assessment` |
| `p5_safer_solvents.py` | P5 | `"calculated"` | **Calculated** | `chem21` |
| `p6_energy_efficiency.py` | P6 | `"calculated"` | **Declared+Calculated** (temp from protocol, deviation calculated) | `protocol_parse` |
| `p7_renewable_feedstocks.py` | P7 | `"estimated"` | **Model-inferred** | `ai_assessment` |
| `p8_reduce_derivatives.py` | P8 | `"estimated"` | **Model-inferred** | `ai_assessment`, `rxn_insight` |
| `p9_catalysis.py` | P9 | `"estimated"` | **Model-inferred** | `ai_assessment` |
| `p10_degradation.py` | P10 | `"calculated"` | **Calculated** | `pubchem_ghs` |
| `p11_realtime_analysis.py` | P11 | `"estimated"` | **Model-inferred** | `ai_assessment` |
| `p12_accident_prevention.py` | P12 | `"calculated"` | **Calculated** | `pubchem_ghs` |
| `waste_analysis.py` | Waste Summary | `"calculated"` / `"partial"` / `"estimated"` | **Calculated** (when all data present) or **Benchmark-derived** (partial) | `pubchem_ghs`, `chem21`, `ACS_GCI_benchmarks` |
| `process_complexity.py` | Process Complexity | (none - dict) | **Calculated** | `protocol_parse` |

### Frontend: Client-Side Score Projection

| Module | Function | Current Label | Correct Provenance | Notes |
|--------|----------|--------------|-------------------|-------|
| `lib/projected-scores.ts` | `projectScores()` | `confidence: 'estimated'` | **Model-inferred** | Client-side re-calculation after user accepts recommendations |
| `lib/projected-scores.ts` | `scoreP3()`, `scoreP5()`, `scoreP10()`, `scoreP12()` | `'estimated'` | **Calculated** (using same formulas as backend) | These are recalculations, not estimates |

**Issue identified:** `projected-scores.ts` labels recalculated scores as `'estimated'` when they should be `'calculated'` (they use the exact same deterministic formulas as the backend).

### UI Components: Display Logic

| Component | Current Labels | Issues | Fix Required |
|-----------|---------------|--------|--------------|
| `ScoreCard.tsx` | `'calculated'`, `'benchmark'`, `'estimated'`, `'partial'`, `'unavailable'` | Inconsistent naming (`'benchmark'` should be `'benchmark-derived'`) | Update to canonical taxonomy |
| `PrincipleSection.tsx` | `CONFIDENCE_INFO` dict | Same as ScoreCard | Update to canonical taxonomy |
| `EvidenceAtlas.tsx` | Uses `data_sources` for display | No provenance badges | Add provenance display |
| `WasteScoreCard.tsx` | Displays `summary.confidence` as-is | No standardization | Update to canonical taxonomy |

### Data Type Definitions

| File | Type/Interface | Current State | Fix Required |
|------|---------------|--------------|--------------|
| `lib/types.ts` | `PrincipleScore.confidence` | `string` | Change to union type: `'declared' \| 'calculated' \| 'benchmark' \| 'model-inferred' \| 'unavailable'` |
| `lib/types.ts` | `WasteSummary.confidence` | `'calculated' \| 'partial' \| 'estimated'` | Update to canonical taxonomy |
| `services/chemistry/scoring/models.py` | `PrincipleScore.confidence` | `str = "calculated"` | Change to `ScoreProvenance` enum |

## Migration Checklist

### Phase 1: Type System Updates ✅

- [x] Create `ScoreProvenance` enum in Python (`services/chemistry/scoring/models.py`)
- [x] Create `ScoreProvenance` type in TypeScript (`lib/types.ts`)
- [x] Update `PrincipleScore.confidence` to use new type (both Python and TypeScript)
- [x] Update `WasteSummary.confidence` to use new type

### Phase 2: Backend Scoring Module Updates

**P1 - Waste Prevention** (`p1_waste_prevention.py`)
- [ ] When yield is stated: `confidence = ScoreProvenance.CALCULATED`
- [ ] When yield is from benchmark: `confidence = ScoreProvenance.BENCHMARK`
- [ ] Add `data_sources = ["unit_converter"]` for calculated
- [ ] Add `data_sources = ["ACS_GCI_benchmarks"]` for benchmark

**P4 - Product Toxicity** (`p4_product_toxicity.py`)
- [ ] Change `confidence = "estimated"` → `ScoreProvenance.MODEL_INFERRED`
- [ ] Ensure `details.reasoning` is always populated

**P6 - Energy Efficiency** (`p6_energy_efficiency.py`)
- [ ] Add logic to distinguish:
  - `ScoreProvenance.CALCULATED` when temp is explicit
  - `ScoreProvenance.BENCHMARK` when temp is ambiguous/partial
- [ ] Current all marked `"calculated"` - needs refinement

**P7 - Renewable Feedstocks** (`p7_renewable_feedstocks.py`)
- [ ] Change `confidence = "estimated"` → `ScoreProvenance.MODEL_INFERRED`
- [ ] Ensure `details.reasoning` is always populated

**P8 - Reduce Derivatives** (`p8_reduce_derivatives.py`)
- [ ] Change `confidence = "estimated"` → `ScoreProvenance.MODEL_INFERRED`
- [ ] Ensure `details.reasoning` is always populated

**P9 - Catalysis** (`p9_catalysis.py`)
- [ ] Change `confidence = "estimated"` → `ScoreProvenance.MODEL_INFERRED`
- [ ] Ensure `details.reasoning` is always populated

**P11 - Real-time Analysis** (`p11_realtime_analysis.py`)
- [ ] Change `confidence = "estimated"` → `ScoreProvenance.MODEL_INFERRED`
- [ ] Ensure `details.reasoning` is always populated

**Waste Analysis** (`waste_analysis.py`)
- [ ] `confidence = ScoreProvenance.CALCULATED` when all chemical data present
- [ ] `confidence = ScoreProvenance.BENCHMARK` when using partial data + industry averages
- [ ] Remove `"partial"` as distinct state (fold into BENCHMARK)

**Process Complexity** (`process_complexity.py`)
- [ ] Add `confidence = ScoreProvenance.CALCULATED` to output dict
- [ ] Add `data_sources = ["protocol_parse"]`

### Phase 3: Frontend Score Projection Updates

**`lib/projected-scores.ts`**
- [ ] Change line 141: `confidence: 'estimated'` → `confidence: 'calculated'`
- [ ] Change line 148: `confidence: 'estimated'` → `confidence: 'calculated'`
- [ ] Change line 155: `confidence: 'estimated'` → `confidence: 'calculated'`
- [ ] Change line 162: `confidence: 'estimated'` → `confidence: 'calculated'`
- [ ] Add comment explaining these are deterministic recalculations

### Phase 4: UI Component Updates

**`components/ScoreCard.tsx`**
- [ ] Update `confidenceLabel` logic to use canonical taxonomy
- [ ] Change `'benchmark'` → `'benchmark-derived'` in display
- [ ] Change `'estimated'` → `'AI-estimated'` in display
- [ ] Update tooltip text to match taxonomy definitions
- [ ] Remove `'partial'` handling (no longer a distinct state)

**`components/PrincipleSection.tsx`**
- [ ] Update `CONFIDENCE_INFO` dict to match canonical taxonomy
- [ ] Add `'declared'` entry
- [ ] Update descriptions to match taxonomy document
- [ ] Change `'estimated'` → `'model-inferred'` key

**`components/EvidenceAtlas.tsx`**
- [ ] Add provenance badge to each principle section header
- [ ] Add tooltip explaining provenance state
- [ ] Use `PROVENANCE_LABELS` mapping for display

**`components/WasteScoreCard.tsx`**
- [ ] Update confidence display to use canonical labels
- [ ] Add tooltip with taxonomy explanation

### Phase 5: Export Format Updates

**`app/api/export/dozn/[id]/route.ts`**
- [ ] Add `provenance` column to export data structure
- [ ] Map `score.confidence` to user-friendly label
- [ ] Include provenance in metadata section

### Phase 6: Validation & Testing

- [ ] Add TypeScript lint rule to catch invalid provenance values
- [ ] Add Python validator in `models.py` to reject invalid confidence values
- [ ] Add unit test: every score must have valid provenance
- [ ] Add unit test: `unavailable` must have `score === -1`
- [ ] Add unit test: `model-inferred` must have reasoning
- [ ] Add integration test: UI displays correct provenance labels

### Phase 7: Documentation

- [ ] Update API documentation with provenance field
- [ ] Add provenance guide to help/FAQ
- [ ] Update README with provenance taxonomy link
- [ ] Add inline code comments referencing taxonomy doc

## Known Issues to Fix

1. **Inconsistent "partial" state:** Currently used for missing data, but should be folded into either `benchmark` (if we can estimate) or `unavailable` (if we cannot).

2. **Client-side projections mislabeled:** `projected-scores.ts` marks recalculations as `'estimated'` when they are fully deterministic.

3. **No provenance display in Evidence Atlas:** Current UI shows data sources but not provenance state.

4. **Export doesn't include provenance:** DOZN export missing provenance metadata.

5. **P6 conflates declared and calculated:** Temperature is declared (from protocol), but deviation scoring is calculated. Should clarify or split.

## Validation Rules (for automated tests)

```typescript
// Type guard
function isValidProvenance(value: string): value is ScoreProvenance {
  return ['declared', 'calculated', 'benchmark', 'model-inferred', 'unavailable'].includes(value)
}

// Validation rules
function validateScore(score: PrincipleScore): string[] {
  const errors: string[] = []
  
  if (!isValidProvenance(score.confidence)) {
    errors.push(`Invalid confidence: ${score.confidence}`)
  }
  
  if (score.confidence === 'unavailable' && score.score !== -1) {
    errors.push('Unavailable scores must have score === -1')
  }
  
  if (score.confidence === 'model-inferred' && !score.details.reasoning) {
    errors.push('Model-inferred scores must include reasoning')
  }
  
  if (score.confidence !== 'unavailable' && score.data_sources.length === 0) {
    errors.push('Available scores must have at least one data source')
  }
  
  return errors
}
```

## Timeline Estimate

- **Phase 1 (Type System):** 1 hour
- **Phase 2 (Backend):** 4 hours
- **Phase 3 (Frontend Projection):** 1 hour  
- **Phase 4 (UI Components):** 3 hours
- **Phase 5 (Exports):** 2 hours
- **Phase 6 (Testing):** 3 hours
- **Phase 7 (Documentation):** 2 hours

**Total: ~16 hours** (2 development days)
