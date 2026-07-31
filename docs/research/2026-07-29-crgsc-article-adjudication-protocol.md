# CRGSC Article Adjudication Protocol

#claudeai

## Purpose

Decide which downloaded articles are appropriate for GreenChemistry.ai evidence retrieval before creating recommendation-facing embeddings.

The unit of adjudication is the **article**, not the individual chunk. Chunk-level evidence extraction happens only after the article has passed this gate.

## Inputs

The adjudicator receives:

- article title
- DOI and citation metadata
- volume/year
- abstract and keywords when available
- first-page text
- full extracted text when needed
- source PDF path and checksum
- document type signal

Current queue:

`data/literature/crgsc/extracted-v4/adjudication-queue.jsonl`

## Decision states

Use exactly one final relevance state:

- `direct`: likely to support a GreenChemistry.ai recommendation or measurable process comparison
- `supporting`: useful for hazard, solvent, methodology, framework, materials, or sustainability context, but not sufficient alone for a specific recommendation
- `background`: relevant to broad green/sustainable chemistry context but not suitable as recommendation evidence
- `irrelevant`: outside the product's evidence and decision surface
- `uncertain`: insufficient information or ambiguous applicability; requires human review
- `excluded`: editorial, contents, retraction/correction notice, duplicate, or otherwise not an evidence article

`uncertain` is not a failure. It is the correct state when the system cannot responsibly determine applicability.

## Product relevance boundary

An article is in scope when it informs one or more of these decision areas:

1. solvent or reagent substitution
2. waste prevention, PMI, material efficiency, or solvent burden
3. atom economy or reaction efficiency
4. energy efficiency, temperature, pressure, or runtime
5. catalysis or reduced equivalents
6. renewable feedstocks or biomass valorization
7. reducing derivatives, auxiliary chemicals, or protecting groups
8. process simplification, one-pot/telescoped operations, or fewer transfers
9. purification, separation, extraction, washing, or isolation burden
10. degradation, persistence, end-of-life, recycling, or circularity
11. accident prevention and safer operating conditions
12. analytical monitoring or real-time process control
13. yield, purity, throughput, runtime, or step-count precedent
14. formulation/material fabrication procedures when the product is analyzing those procedure types

Articles about pollution remediation, adsorption, nanomaterial synthesis, biomass valorization, and materials recycling may be relevant, but they should not automatically be treated as evidence for synthetic-route recommendations. Their domain must be tagged explicitly.

## Evidence-type tags

Apply one or more:

- `experimental_comparison`
- `process_method`
- `solvent_or_reagent_assessment`
- `life_cycle_assessment`
- `hazard_assessment`
- `review_or_framework`
- `materials_or_circularity`
- `remediation_or_wastewater`
- `analytical_method`
- `simulation_or_modeling`
- `retraction_or_correction`

## Scoring rubric

Score each dimension 0–2:

### A. Decision-surface relevance

- `0`: does not map to a current GC.ai decision area
- `1`: adjacent/contextual connection
- `2`: directly maps to a scored or recommended decision area

### B. Citable outcome

- `0`: no concrete claim, measurement, comparison, or method useful to cite
- `1`: useful conceptual/framework or contextual claim
- `2`: reports a concrete condition, comparison, measurement, or validated method

### C. Applicability

- `0`: no plausible transfer to GC.ai use cases
- `1`: potentially useful by analogy or for a bounded domain
- `2`: clearly applicable to reaction, formulation/material, separation, hazard, or process decision support

### D. Evidence directness

- `0`: opinion, editorial, or unsupported general claim
- `1`: review, simulation, framework, or indirect evidence
- `2`: experimental or authoritative direct evidence

### Suggested interpretation

- Direct: total normally 6–8, with no zero in A or C
- Supporting: total normally 4–6, or strong contextual evidence with limited direct applicability
- Background: total 2–4 without a concrete recommendation-supporting outcome
- Irrelevant: A = 0 or no plausible domain tag
- Uncertain: conflicting signals, missing text, unclear procedure type, or score cannot be assigned confidently

The score is an audit aid, not a replacement for the final state.

## Structured adjudication record

```json
{
  "document_id": "10.1016_j.crgsc.2024.100407",
  "doi": "10.1016/j.crgsc.2024.100407",
  "relevance": "supporting",
  "domain_tags": ["materials_or_circularity", "process_simplification"],
  "evidence_types": ["review_or_framework", "materials_or_circularity"],
  "scores": {
    "decision_surface": 2,
    "citable_outcome": 2,
    "applicability": 1,
    "directness": 1
  },
  "scope_note": "Relevant to recycling/upcycling and material-process decisions; not direct evidence for solvent substitution.",
  "human_review_status": "reviewed",
  "reviewer": "",
  "reviewed_at": "",
  "adjudication_version": "crgsc-v1"
}
```

## Operating procedure

### Pass 1 — Deterministic exclusion

Automatically exclude from research-article adjudication:

- contents PDFs
- editorial-board PDFs
- duplicate DOI records
- retraction/correction notices, while retaining them as source warnings linked to the affected article where possible
- files with failed or empty text extraction

This has already been done for the current extraction output.

### Pass 2 — Cheap model triage

Use title, abstract/first page, keywords, and article type to assign a provisional state and tags. The model must return structured JSON and a short rationale. It must not invent article claims or citations.

For this run, the local Ollama model was installed but did not return a usable API response, so Pass 2 used the transparent fallback script `scripts/literature/provisional_crgsc_triage.py`. Its labels are explicitly `provisional_deterministic`, not final adjudications and not model judgments.

Gemma 4 (`gemma4:12b`) was then run on the complete 30-article calibration set. It returned 17 direct, 10 supporting, 2 background, and 1 uncertain label; agreement with the deterministic baseline was 20/30. One malformed JSON response was retained as uncertain. These are calibration outputs only; no Gemma label is treated as final before human review.

Use a low-cost/local model for this pass when the runtime is healthy. Do not send client-private documents to a shared model.

Output states should be conservative:

- clear out-of-scope → `irrelevant`
- clear decision-surface + concrete method/result → provisional `direct` or `supporting`
- ambiguous → `uncertain`

### Pass 3 — Human calibration

Human-review at least 30 articles before trusting batch labels:

- 10 provisional direct
- 10 provisional supporting/background
- 10 provisional irrelevant/uncertain

The sample must span years, volumes, article types, and domains. Compare human decisions against model decisions and revise the prompt/rubric before full queue adjudication.

### Pass 4 — Full queue review

Human-review:

- every `uncertain` article
- every provisional `direct` article
- every article selected for the first Evidence Atlas pilot
- a random sample of provisional `supporting`, `background`, and `irrelevant` articles

The first pass should prefer precision over recall. It is better to leave some potentially useful papers for later than to flood the recommendation index with weak evidence.

### Pass 5 — Evidence extraction

Only after article-level approval:

- extract claims and evidence units
- preserve page/section/table/figure location
- tag measurements and conditions
- record applicability and limitations
- create embeddings for approved evidence units

## What Trevor needs to decide

Only four product decisions are needed before I can run the first calibration pass:

1. **Scope breadth:** Should remediation/wastewater, nanomaterials, and materials recycling remain in the shared corpus, or should they be separate domain collections?
2. **Evidence policy:** Should review/framework articles be searchable as supporting evidence but excluded from direct recommendation support? Recommended default: yes.
3. **First pilot domain:** Which should calibrate first: solvent/process chemistry, general process redesign, or the full GreenChemistry.ai surface?
4. **Human calibration:** Who should review the first 30 labels, and should the reviewer use the rubric in a spreadsheet/CSV or a lightweight local review file?

Recommended defaults:

- Keep all domains in one source collection with explicit domain tags.
- Let reviews support context and query expansion, but not alone justify a direct experimental claim.
- Calibrate first on solvent/process chemistry because it maps most directly to the current Evidence Atlas.
- Use a CSV or JSONL review file first; build a UI only after the rubric stabilizes.

## Done-when for adjudication v1

- Every current research article has a relevance state, domain tag, evidence type, and rationale.
- At least 30 articles have human calibration decisions.
- Model/human disagreement is measured and used to revise the triage prompt.
- Direct evidence is separated from supporting/background material.
- The approved subset can produce page-located evidence units for retrieval.
- The adjudication schema can accept a future client PDF without changing the workflow.
