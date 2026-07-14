# Scoring Provenance Taxonomy

**Version:** 1.0  
**Effective Date:** 2026-07-13  
**Status:** Canonical Standard

## Overview

This document defines the authoritative provenance taxonomy for all scores, metrics, and evidence throughout the GreenChemistry.ai product. Every score must map to exactly one of these five provenance states.

## The Five Provenance States

### 1. **Declared**
**Definition:** Values explicitly provided in the input protocol text.

**Examples:**
- Temperature stated as "75-80°C" in the protocol
- Duration stated as "2 hours" 
- Yield stated as "87%"
- Product mass stated as "5.2 g"

**Scientific Meaning:** Primary source data from the protocol author. These are facts-as-stated, not independently verified.

**Confidence Level:** High for what was stated; does not guarantee accuracy.

**Data Sources:** `protocol_parse`

---

### 2. **Calculated**
**Definition:** Derived from molecular/chemical data using deterministic formulas with no missing inputs.

**Examples:**
- P2 Atom Economy from RDKit molecular weight calculations
- P3 Health hazard score from PubChem GHS codes
- P5 Solvent classification from CHEM21 guide
- P10 Environmental hazard from GHS aquatic toxicity codes
- P12 Physical hazard from GHS reactivity codes
- PMI (Process Mass Intensity) from mass balance
- Molecular weight lookups

**Scientific Meaning:** Reproducible calculations from authoritative chemical databases. Anyone with the same inputs and formulas will get identical results.

**Confidence Level:** High (deterministic, formula-based).

**Data Sources:** `rdkit`, `pubchem`, `pubchem_ghs`, `chem21`, `ghs`, `unit_converter`

---

### 3. **Benchmark-derived**
**Definition:** Estimated from industry benchmark data when direct calculation is impossible.

**Examples:**
- P1 Waste score using ACS GCI reaction-class PMI benchmarks
- P6 Energy efficiency when temperature data is partial or ambiguous
- Yield estimation using typical efficiency for reaction class

**Scientific Meaning:** Industry-average proxy. Real-world outcomes will vary. Benchmarks come from published ACS Green Chemistry Institute data for specific reaction types.

**Confidence Level:** Medium (class-level average, not protocol-specific).

**Data Sources:** `ACS_GCI_benchmarks`, `literature`

---

### 4. **Model-inferred**
**Definition:** AI-assessed when no deterministic formula or benchmark is applicable.

**Examples:**
- P8 Derivative burden (AI evaluates protecting groups)
- P11 Real-time analysis capability (AI assesses monitoring tools)
- P9 Catalysis use assessment
- P4 Product toxicity (molecular design scope)

**Scientific Meaning:** Algorithmic judgment based on pattern recognition, not calculation. Subject to model limitations. Should be reviewed by domain experts.

**Confidence Level:** Variable (requires expert review).

**Data Sources:** `ai_assessment`, `rxn_insight`, `baran_ideality`

**UI Treatment:** Must display "AI-estimated" badge and reasoning.

---

### 5. **Unavailable**
**Definition:** Score could not be computed due to missing or unresolvable data.

**Examples:**
- Chemical not found in PubChem
- SMILES parse failure
- Reaction products not specified
- Ambiguous chemical names without CAS numbers

**Scientific Meaning:** Data gap. Cannot score without additional information.

**Confidence Level:** N/A (no score).

**Data Sources:** `cache`, `not_found`, `error`, `unknown`, `none`, (empty string)

**UI Treatment:** Display as "N/A" with explanation in details.

---

## Mapping: Principles to Provenance

| Principle | Primary Provenance | Fallback Provenance | Notes |
|-----------|-------------------|---------------------|-------|
| **P1** Waste Prevention | Calculated | Benchmark-derived | Calculated when yield stated; benchmark when yield inferred |
| **P2** Atom Economy | Calculated | Unavailable | Requires valid reaction SMILES |
| **P3** Less Hazardous | Calculated | Unavailable | Requires GHS codes from PubChem |
| **P4** Product Toxicity | Model-inferred | Unavailable | Molecular design scope; out of range for protocol analysis |
| **P5** Safer Solvents | Calculated | Unavailable | Requires CHEM21 classification |
| **P6** Energy Efficiency | Declared+Calculated | Benchmark-derived | Temperature from protocol, deviation calculated |
| **P7** Renewable Feedstocks | Model-inferred | Unavailable | Requires feedstock lifecycle data |
| **P8** Reduce Derivatives | Model-inferred | Unavailable | Protecting group analysis |
| **P9** Catalysis | Model-inferred | Unavailable | Catalyst identification and assessment |
| **P10** Degradation | Calculated | Unavailable | Requires GHS aquatic toxicity codes |
| **P11** Real-time Analysis | Model-inferred | Unavailable | Process analytical technology assessment |
| **P12** Accident Prevention | Calculated | Unavailable | Requires GHS physical hazard codes |

## Implementation Requirements

### 1. TypeScript Type System

**File:** `lib/types.ts`

```typescript
export type ScoreProvenance = 
  | 'declared'
  | 'calculated'
  | 'benchmark'
  | 'model-inferred'
  | 'unavailable'

export interface PrincipleScore {
  // ... existing fields
  confidence: ScoreProvenance  // Rename from string to ScoreProvenance
  provenance: ScoreProvenance  // Alias for UI clarity (same value)
}
```

### 2. Backend (Python)

**File:** `services/chemistry/scoring/models.py`

```python
from enum import Enum

class ScoreProvenance(str, Enum):
    DECLARED = "declared"
    CALCULATED = "calculated"
    BENCHMARK = "benchmark"
    MODEL_INFERRED = "model-inferred"
    UNAVAILABLE = "unavailable"

class PrincipleScore(BaseModel):
    confidence: ScoreProvenance = ScoreProvenance.CALCULATED
```

### 3. UI Components

All components that display scores must use the canonical labels:

**Display Mapping:**
```typescript
const PROVENANCE_LABELS: Record<ScoreProvenance, string> = {
  'declared': 'declared',
  'calculated': 'calculated',
  'benchmark': 'benchmark-derived',
  'model-inferred': 'AI-estimated',
  'unavailable': 'unavailable',
}
```

**Components to Update:**
- `components/ScoreCard.tsx` 
- `components/PrincipleSection.tsx`
- `components/EvidenceAtlas.tsx`
- `components/WasteScoreCard.tsx`

### 4. Evidence Atlas

**File:** `components/EvidenceAtlas.tsx`

Must display provenance badge for every score with tooltip explaining the meaning.

### 5. Export Formats

**File:** `app/api/export/dozn/[id]/route.ts`

DOZN exports must include provenance for every score in a dedicated column:

```
| Principle | Score | Provenance | Data Sources |
```

### 6. Documentation

**User-facing help text** (to be added to UI):

> **Score Provenance Guide**
> 
> - **Declared:** From your protocol text
> - **Calculated:** From chemical databases (PubChem, RDKit, CHEM21)
> - **Benchmark-derived:** Industry-average estimate (ACS GCI data)
> - **AI-estimated:** Model assessment—review reasoning
> - **Unavailable:** Missing data—cannot score

## Validation Rules

1. Every `PrincipleScore` must have a `confidence` value matching one of the five states
2. `confidence: 'unavailable'` must pair with `score: -1` and `normalized: -1`
3. `confidence: 'model-inferred'` must include reasoning in `details.reasoning`
4. `data_sources` array must never be empty except for `unavailable`
5. Internal pipeline values (`cache`, `not_found`, `error`) must not appear in `data_sources` for user-facing scores

## Migration Path

**Phase 1:** Update type definitions and Python enums
**Phase 2:** Update scoring modules to emit new provenance values
**Phase 3:** Update UI components to consume and display new taxonomy
**Phase 4:** Update exports to include provenance column
**Phase 5:** Add validation tests to ensure all scores have valid provenance

## References

- [ACS Green Chemistry Institute Pharmaceutical Roundtable](https://www.acsgcipr.org/)
- [CHEM21 Solvent Selection Guide](http://www.chem21.eu/home/)
- [PubChem GHS Classification](https://pubchem.ncbi.nlm.nih.gov/)
- [RDKit Cheminformatics Toolkit](https://www.rdkit.org/)
