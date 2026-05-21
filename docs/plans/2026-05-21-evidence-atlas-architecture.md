# Evidence Atlas: Per-Analysis Deep-Dive Page

> **Status:** Draft — awaiting review before implementation.

**Goal:** Replace the inline waste toggle with a dedicated, citable, eventually shareable evidence page that consolidates all scoring rationale, literature references, hazard data, and process metrics for a single analysis. Each scored principle gets its own section. Recommendation cards on the main results page link directly into the relevant section.

**Key design constraint:** This is not a single-purpose "waste details" page. It is a pattern that scales across all 12 principles as we add richer evidence behind each one. Build for 12 sections even though we populate ~5-6 today.

---

## Route structure

```
/analyze/[id]/evidence          → full Evidence Atlas page
/analyze/[id]/evidence#p1       → anchor to Principle 1 section
/analyze/[id]/evidence#p5       → anchor to Principle 5 section
/analyze/[id]/evidence#waste    → anchor to waste summary section
```

### Why a separate route, not a tab

- **Citability:** Scientists need a URL they can paste into a paper or report.
- **Shareability (future):** A public-link mode can be scoped to this route without exposing the editable analysis view.
- **Deep-linking:** Anchor links from recommendation cards need stable targets.
- **Page weight:** The evidence page will grow heavy with data tables, charts, and literature references. Keeping it separate avoids bloating the main results view.

### Future: public sharing

When we add public sharing, the flow will be:

1. User clicks "Share" on the evidence page.
2. A `shared_token` column is added to `gpc_analyses` (or a separate `shared_links` table).
3. A public route `/evidence/[token]` serves a read-only view without auth.
4. The citation string includes the public URL when available.

Design the data flow so the evidence page reads from a single `analysis_result` JSON blob — no joins or secondary queries. This makes the public route trivial: just fetch the blob by token instead of by user+id.

---

## Page layout

```
┌─────────────────────────────────────────────┐
│  Evidence Atlas                              │
│  Protocol: [title]                           │
│  GC.ai v0.6.0 · Generated [date]            │
│  [Cite] [Share (future)]                     │
├─────────────────────────────────────────────┤
│                                              │
│  ## Waste Impact Summary         #waste      │
│  [Grade badge] [Score] [Driver sentence]     │
│  Direct waste breakdown                      │
│  Hazard-segmented waste                      │
│  Liquid burden                               │
│  Process burden                              │
│                                              │
│  ## P1: Prevention                #p1        │
│  Deterministic score + confidence            │
│  Flagged chemicals                           │
│  Recommendations anchored here               │
│  Literature / evidence                       │
│                                              │
│  ## P2: Atom Economy              #p2        │
│  ...                                         │
│                                              │
│  ## P3: Less Hazardous            #p3        │
│  ...                                         │
│                                              │
│  (P4 skipped — not scored)                   │
│                                              │
│  ## P5: Safer Solvents            #p5        │
│  ...                                         │
│                                              │
│  ...etc for each scored principle...         │
│                                              │
│  ## Process Complexity            #process   │
│  Transfer count, vessel count, etc.          │
│                                              │
│  ## Data Sources & Methodology    #sources   │
│  Evidence source list                        │
│  Methodology version                         │
│  Confidence summary                          │
│                                              │
└─────────────────────────────────────────────┘
```

---

## Principle section anatomy

Each principle section follows the same template:

```
### P[N]: [Name]                    #p[n]

Score: [X]/10 ([confidence])
Data sources: [list]

**Flagged chemicals:**
- [Chemical] — [H-codes or reason]

**Recommendations linked to this principle:**
- [Rec summary] — [primaryBenefit]
  (These may conflict with recommendations from other principles.
   Choose the path that fits your experimental constraints.)

**Evidence:**
- [Citations, literature, SDS notes if available]

**Details:**
- [Principle-specific data: solvent masses for P5, temperature
  deviations for P6, atom economy % for P2, etc.]
```

### Which principles to show

Show a section only if at least one of these is true:
- We have a deterministic score for it
- We have recommendations tagged with its number
- We have enriched chemical data relevant to it

Skip P4 (Designing Safer Chemicals) unless we eventually add product-design scoring.

### Conflicting recommendations

The page should not hide or resolve conflicts. If P5 recommends replacing a solvent and P1 recommends a process change that makes the solvent moot, both sections show their recommendations. A brief note on the page (or per-section) should say:

> "Recommendations across principles may suggest alternative paths. Choose based on your experimental constraints — each recommendation is independently evidence-backed."

---

## Data flow

The evidence page reads from `analysis_result` (already persisted in Supabase as JSONB). All the data it needs is already there or will be added as we enrich scoring:

```
analysis_result.deterministicScores.scores[]   → per-principle scores
analysis_result.recommendations[]              → grouped by principleNumbers
analysis_result.enrichedChemicals[]             → chemical-level evidence
analysis_result.wasteAnalysis                   → waste section
analysis_result.overallAssessment.processComplexity → process section
analysis_result.analysisMetadata               → version, date
```

No new database tables or queries needed. The page is purely a presentation layer over existing data.

---

## Changes to existing UI

### Main results page (`AnalysisResults.tsx`)

1. **WasteScoreCard:** Remove the inline toggle/details panel. Keep the card but make it a link to `/analyze/[id]/evidence#waste`.
2. **Recommendation cards:** Add an anchor link from each principle tag to `/analyze/[id]/evidence#p[n]`. The `primaryBenefit` pill stays.
3. **Overall assessment:** The "Cite" button stays (it's useful in-place), but add a "View full evidence" link to the evidence page.

### New files

```
app/analyze/[id]/evidence/page.tsx    → Evidence Atlas page component
components/EvidenceAtlas.tsx           → Main layout component
components/PrincipleSection.tsx        → Reusable per-principle section
```

### Removed/refactored

- `components/WasteDetailsPanel.tsx` → content moves into the waste section of EvidenceAtlas
- The inline `wasteDetailsOpen` state in AnalysisResults goes away

---

## Implementation order

1. Create the evidence route and page shell with header, citation, and anchor nav
2. Build PrincipleSection component
3. Move waste details into the waste section of the evidence page
4. Wire recommendation cards to anchor-link to evidence page
5. Populate principle sections from deterministicScores and enrichedChemicals
6. Add process complexity section
7. Add data sources / methodology footer
8. Remove inline waste toggle from main results page

---

## What this does NOT cover

- Public sharing implementation (future — just the route design is here)
- SDS crawler or full-text literature retrieval
- Methodology paper or explanatory content within sections
- Export to PDF (future evidence page export)
- Mechanochemistry alternatives (0.61 scope)

---

## Open questions

1. **Navigation within the evidence page:** Sticky sidebar TOC, or just anchor links from the top? Sidebar is better for long pages but adds UI complexity.
2. **Print/export:** Should the evidence page be print-friendly from day one? Scientists may want to print or PDF it.
3. **Naming:** "Evidence Atlas" is an internal working title. User-facing name could be "Analysis Evidence", "Detailed Evidence", "Evidence Report", etc.
