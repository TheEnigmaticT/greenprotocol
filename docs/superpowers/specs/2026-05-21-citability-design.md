# Citability — Design Spec
**Version:** 0.6  
**Date:** 2026-05-21  
**Status:** Approved

---

## Problem

Scientists using GC.ai need to cite their work in two distinct ways:

1. **Software citation** — reference which version of GC.ai produced the analysis (reproducibility, methods sections)
2. **Claims citation** — trace each recommendation back to its evidence, whether that's a primary literature reference or the calculation/reasoning behind an AI inference

The version stamping scaffolding (lib/version.ts, lib/citation.ts, analysisMetadata, per-recommendation citationMetadata) is already in place from earlier 0.6 work. This spec covers completing the evidence surface: activating post-generation literature retrieval, tagging recommendations with an evidence tier, and making all evidence — citations and inference trails — visible in the Evidence Atlas.

---

## Scope (0.6)

**In scope:**
- Create `lib/vector-search.ts` and activate the Phase 2.5 retrieval step in `lib/pipeline.ts`
- Add `evidenceTier: 'sourced' | 'inferred'` to `Recommendation`
- Rerank recommendations by severity × evidence tier before deduplication
- Evidence tier badges on recommendation cards in PrincipleSection
- "Model reasoning" label on inferred recommendations (makes the inference trail explicit)
- BibTeX option added to the existing Cite button in Evidence Atlas
- Per-recommendation cite affordance using existing `rec.citationMetadata`
- Consistent calculation trail keys in scoring module `details` objects
- Evidence Atlas surfaced more prominently as the canonical citable record from the main results view

**Out of scope (0.7):**
- Two-pass re-evaluation: a second LLM call that can change or suppress a recommendation based on retrieved evidence (backlogged as 0.7)
- RAG-in-prompt: feeding retrieved literature into the generation prompt

---

## Architecture

The Evidence Atlas is the canonical citable artifact. It already has the version header, cite button, per-recommendation citation rendering, and print footer. The 0.6 work makes its content trustworthy and complete — every claim shows either a literature source or the reasoning behind it.

### Three evidence types in the Atlas

| Type | Source | Already in data? | Work needed |
|------|--------|-----------------|-------------|
| Literature citations | Vector DB (PubMed via `literature_precedents`) | Partially — citations field exists, rarely populated | Activate Phase 2.5 retrieval |
| Calculation trail | Scoring modules writing to `score.details` | Yes, but inconsistently keyed | Standardize detail keys in scoring modules |
| LLM rationale | `rec.alternative.rationale` | Yes | Label it as "Model reasoning" in UI |

---

## Pipeline

### New file: `lib/vector-search.ts`

```typescript
export interface SearchResult {
  id: string
  title: string
  authors?: string
  journal?: string
  year?: number
  doi?: string
  url?: string
  content_snippet?: string
  similarity: number
}

export async function searchLiterature(params: {
  query: string
  limit: number
  threshold: number
  principles?: number[]
  chemicals?: string[]
}): Promise<SearchResult[]>
```

**Flow:**
1. Generate embedding for `params.query` using OpenAI `text-embedding-3-small` (1536 dimensions — matches the `literature_precedents` migration)
2. Call `match_literature_precedents` Supabase RPC with embedding + principle/chemical filters
3. Return shaped `SearchResult[]`

**Embedding provider:** OpenAI `text-embedding-3-small`. The Anthropic SDK does not offer embeddings. Add `OPENAI_API_KEY` to env vars (server-side only).

### Activating Phase 2.5

The Phase 2.5 block in `lib/pipeline.ts` is already written and commented out. Work:
1. Uncomment the import: `import { searchLiterature, SearchResult } from '@/lib/vector-search'`
2. Uncomment the Phase 2.5 block
3. **Refactor for parallel embedding:** the current block calls the DB per-recommendation sequentially. Instead: collect all query strings, call OpenAI embeddings API in a single batched request, then fan out to `match_literature_precedents` in parallel.

### Evidence tier derivation (add after Phase 2.5, before deduplication)

```typescript
for (const rec of rawRecommendations) {
  rec.evidenceTier = (rec.evidence?.citations?.length ?? 0) > 0 ? 'sourced' : 'inferred'
}
```

### Reranking (add after tier derivation, before deduplication)

Sort `rawRecommendations` by composite score descending:

```
score = severityWeight × tierMultiplier
severityWeight: high=3, medium=2, low=1
tierMultiplier: sourced=1.5, inferred=1.0
```

A sourced-medium (score 3.0) ranks above an inferred-medium (score 2.0). A sourced-low (score 1.5) ranks above an inferred-low (score 1.0) but below an inferred-medium (score 2.0). A sourced-medium ties with an inferred-high (both 3.0) — `'sourced'` wins all tiebreaks at equal composite score.

---

## Data Model

**`Recommendation` — add one field:**

```typescript
evidenceTier?: 'sourced' | 'inferred'  // set by pipeline Phase 2.5
```

No DB schema changes. All data persists in the existing `analysis_result` JSONB column. Old analyses without `evidenceTier` default to `'inferred'` in the UI.

**`PrincipleScore.details` — standardize keys:**

Scoring modules should write human-readable calculation entries, not opaque keys. Format: `"[input description] → [output value]"`. Example:

```
"H302 × 0.8 kg" → "2.4 hazard units"
"CHEM21 solvent score" → "3/10 (moderate concern)"
"Ambient temperature deviation" → "+40°C above baseline"
```

The `details` type stays as `Record<string, string | number>` — this is a convention change, not a type change.

---

## UI Surface

### PrincipleSection — recommendation card badges

Each card gets a small badge top-right derived from `rec.evidenceTier`:
- `'sourced'` → "Literature-backed" (green)
- `'inferred'` or missing → "Model-inferred" (amber)

### PrincipleSection — inference trail

When `evidenceTier === 'inferred'` and no citations are present, render `rec.alternative.rationale` under a "Model reasoning" label. Currently the rationale is shown unlabeled — this makes the AI inference explicit and honest rather than presenting it as a fact. No content change, just labeling.

When citations are present (sourced), they already render via `rec.evidence.citations[]`. No change needed.

### Evidence Atlas — Cite button

Extend the existing Cite button to a two-option dropdown:
- "Copy citation (plain text)" — existing behavior, uses `buildCitationString()`
- "Copy BibTeX" — new, uses `buildBibtexCitation()` which already exists in `lib/citation.ts`

### Evidence Atlas — per-recommendation cite

Add a small cite icon (clipboard or `"` symbol) to each recommendation card in PrincipleSection. On click, copies a per-recommendation citation string built from `rec.citationMetadata` (gcaiVersion + analysisId + generatedAt). Format:

```
GreenChemistry.ai v0.6.0. Recommendation: replace [original] with [alternative] (Step [N]). Analysis ID: [id]. Generated [date].
```

### Main AnalysisResults view — Atlas as citable record

The "View Full Evidence" button already exists. Add a short contextual note near it: e.g., "The Evidence Atlas is the full citable record for this analysis — share its URL to reference this work." This frames the Atlas as the artifact to share, not the transient analyze page.

---

## Export

No new export formats in 0.6. The Evidence Atlas print-to-PDF path already works and includes the footer citation. BibTeX is added to the Cite button dropdown (above). A structured CSV/JSON export is deferred to a future release.

---

## Error handling and degradation

- If `lib/vector-search.ts` fails for any recommendation (network error, empty DB, RPC error): log a warning, leave `evidenceTier` as `'inferred'`, continue. Phase 2.5 already has this try/catch per-recommendation.
- If the OpenAI embedding call fails: log warning, skip Phase 2.5 entirely for that analysis run. All recommendations remain `'inferred'`. No user-facing error.
- If `literature_precedents` table is empty (no ingested data): all recs return no hits → all `'inferred'`. Functionally correct — the Atlas will show "Model reasoning" for all recommendations.
- Old analyses without `evidenceTier`: UI treats missing field as `'inferred'`. No migration needed.

---

## Acceptance criteria

- [ ] Every recommendation card in the Evidence Atlas shows a "Literature-backed" or "Model-inferred" badge
- [ ] Sourced recommendations rank above same-severity inferred recommendations
- [ ] Inferred recommendations show `rec.alternative.rationale` under a "Model reasoning" label
- [ ] Cite button in Evidence Atlas offers both plain-text and BibTeX copy options
- [ ] Each recommendation card has a per-recommendation cite affordance
- [ ] `score.details` renders as a readable calculation trail (at least for P1, P3, P5 scoring modules)
- [ ] Evidence Atlas link on main results view is framed as the citable record
- [ ] Retrieval failure degrades gracefully — no broken analyses, all recs fall back to `'inferred'`
- [ ] `OPENAI_API_KEY` documented in env var list and `.env.local.example`

---

## Open questions

None — all decisions made during brainstorming session 2026-05-21.
