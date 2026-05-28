# GreenChemistry Evidence Atlas: Per-Analysis Deep-Dive Page

> **Status:** Accepted — ready for implementation.

**Goal:** Create a dedicated, citable, eventually shareable evidence page that consolidates all scoring rationale, literature references, hazard data, and process metrics for a single analysis. Each scored principle gets its own section — waste analysis data lives under P1 (Prevention), not in a separate section. Recommendation cards on the main results page link directly into the relevant principle section.

**User-facing name:** "GreenChemistry Evidence Atlas for [Procedure Title]"

**Key design constraint:** This is not a single-purpose "waste details" page. It is a pattern that scales across all 12 principles as we add richer evidence behind each one. The P1 section happens to be the richest today (waste scoring, hazard bucketing, liquid burden, process burden). As we build up P5 (solvent masses, CHEM21 data), P3 (GHS hazard profiles), etc., those sections will naturally reach the same depth using the same template.

---

## Route structure

```
/analyze/[id]/evidence          → full Evidence Atlas page
/analyze/[id]/evidence#p1       → anchor to P1: Prevention (includes waste data)
/analyze/[id]/evidence#p5       → anchor to P5: Safer Solvents
/analyze/[id]/evidence#process  → anchor to Process Complexity
/analyze/[id]/evidence#sources  → anchor to Data Sources & Methodology
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
┌──────────┬──────────────────────────────────┐
│ Sidebar  │  GreenChemistry Evidence Atlas    │
│ (TOC)    │  for [Procedure Title]            │
│          │  GC.ai v0.6.0 · Generated [date]  │
│ P1 ●     │  [Cite] [Share (future)]          │
│ P2       │                                    │
│ P3 ●     ├──────────────────────────────────┤
│ P5 ●     │                                    │
│ P6 ●     │  ## P1: Prevention         #p1    │
│ P7       │  Score + waste impact grade        │
│ P8       │  Direct waste breakdown            │
│ P9       │  Hazard-segmented waste            │
│ P10      │  Liquid burden                     │
│ P11      │  Process burden                    │
│ P12      │  Flagged chemicals                 │
│ Process  │  Recommendations for P1            │
│ Sources  │  Evidence / literature             │
│          │                                    │
│          │  ## P2: Atom Economy        #p2    │
│          │  Score + atom economy %             │
│          │  Recommendations for P2            │
│          │  ...                               │
│          │                                    │
│          │  ## P3: Less Hazardous      #p3    │
│          │  Score + GHS hazard profile         │
│          │  ...                               │
│          │                                    │
│          │  (P4 skipped — not scored)         │
│          │                                    │
│          │  ## P5: Safer Solvents      #p5    │
│          │  Score + CHEM21 data                │
│          │  Solvent masses                    │
│          │  ...                               │
│          │                                    │
│          │  ## Process Complexity   #process  │
│          │  Transfers, vessels, purifications  │
│          │                                    │
│          │  ## Data Sources         #sources  │
│          │  Evidence sources, methodology     │
│          │  version, confidence summary       │
│          │                                    │
└──────────┴──────────────────────────────────┘
```

### Sidebar behavior

- Collapsible like the Notion sidebar — can be toggled closed for more reading space.
- Shows all principle sections present on the page.
- Dots (●) or indicators next to principles that have recommendations.
- Highlights the current section as you scroll (scroll-spy).
- On mobile: collapses to a hamburger/dropdown at the top.
- **Print:** Sidebar is hidden via print stylesheet.

---

## Principle section anatomy

Each principle section follows the same template. P1 happens to be the richest today because waste data lives there, but the template is identical for all principles:

```
### P[N]: [Name]                    #p[n]

Score: [X]/10 ([confidence])
Data sources: [list]

**Principle-specific data:**
- For P1: waste score grade, direct waste kg, hazard buckets,
  liquid burden, process burden
- For P2: atom economy percentage, reaction SMILES
- For P3: GHS hazard codes, flagged chemicals with H-codes
- For P5: CHEM21 classifications, solvent masses, alternatives
- For P6: temperature deviations from ambient
- etc.

**Flagged chemicals:**
- [Chemical] — [reason]

**Recommendations linked to this principle:**
- [Rec summary] — [primaryBenefit]

**Evidence:**
- [Citations, literature, SDS notes if available]
```

### Which principles to show

Show a section only if at least one of these is true:
- We have a deterministic score for it
- We have recommendations tagged with its number
- We have enriched chemical data relevant to it

Skip P4 (Designing Safer Chemicals) unless we eventually add product-design scoring. Other principles that have neither scores nor recommendations are also omitted.

### Conflicting recommendations

The page does not hide or resolve conflicts. If P5 recommends replacing a solvent and a future mechanochemistry recommendation makes the solvent moot, both sections show their recommendations. A note at the top of the recommendations area says:

> "Recommendations across principles may suggest alternative paths. Each is independently evidence-backed — choose based on your experimental constraints."

---

## Data flow

The evidence page reads from `analysis_result` (already persisted in Supabase as JSONB). All the data it needs is already there or will be added as we enrich scoring:

```
analysis_result.deterministicScores.scores[]         → per-principle scores
analysis_result.recommendations[]                    → grouped by principleNumbers
analysis_result.enrichedChemicals[]                   → chemical-level evidence
analysis_result.wasteAnalysis                         → P1 section detail data
analysis_result.overallAssessment.processComplexity   → process section
analysis_result.analysisMetadata                      → version, date, citation
```

No new database tables or queries needed. The page is purely a presentation layer over existing data.

---

## Changes to existing UI

### Main results page (`AnalysisResults.tsx`)

1. **WasteScoreCard:** Remove the inline toggle/details panel. Keep the card as a summary, but clicking it navigates to `/analyze/[id]/evidence#p1`.
2. **Recommendation cards:** Each principle tag becomes an anchor link to `/analyze/[id]/evidence#p[n]`. The `primaryBenefit` pill stays on the card.
3. **Overall assessment:** Keep the "Cite" button. Add a "View full evidence" link to the evidence page.

### New files

```
app/analyze/[id]/evidence/page.tsx    → Evidence Atlas route (server component, data fetch)
components/EvidenceAtlas.tsx           → Main layout: sidebar + content area
components/EvidenceSidebar.tsx         → Collapsible TOC with scroll-spy
components/PrincipleSection.tsx        → Reusable per-principle section template
```

### Removed/refactored

- `components/WasteDetailsPanel.tsx` → content moves into P1 section of EvidenceAtlas
- The inline `wasteDetailsOpen` state in AnalysisResults goes away
- `components/WasteScoreCard.tsx` → simplified to a link card, or inlined

---

## Print stylesheet

Include a `@media print` stylesheet from day one:

- Hide sidebar navigation
- Hide interactive controls (Cite button, Share button, collapse toggles)
- Expand all collapsible sections
- Single-column layout
- Page breaks between principle sections
- Include citation string in a footer on every printed page
- Use system fonts for print legibility

---

## Implementation order

1. Create the evidence route and page shell with header, citation, and scroll-spy sidebar
2. Build PrincipleSection component template
3. Wire P1 section with waste analysis data (moving WasteDetailsPanel content)
4. Wire remaining scored principles (P2, P3, P5, P6) with their deterministic score data
5. Wire recommendations into their principle sections
6. Add process complexity section
7. Add data sources / methodology footer
8. Update main results page: WasteScoreCard → link, principle tags → anchor links
9. Add print stylesheet
10. Remove WasteDetailsPanel and inline waste toggle

---

## What this does NOT cover

- Public sharing implementation (future — route design supports it)
- SDS crawler or full-text literature retrieval
- Methodology paper or explanatory content within sections
- Export to PDF (future — print stylesheet is the first step)
- Mechanochemistry alternatives (0.61 scope)
