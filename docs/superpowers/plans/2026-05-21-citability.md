# Citability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface evidence tiers (literature-backed vs model-inferred) on every recommendation, activate post-generation vector search to populate citations, and expose BibTeX + per-recommendation citation in the Evidence Atlas.

**Architecture:** A new `lib/vector-search.ts` wraps OpenAI embeddings + the existing `match_literature_precedents` Supabase RPC. The Phase 2.5 block in `lib/pipeline.ts` is already written and commented out — we uncomment it, refactor it to batch embeddings, then derive `evidenceTier` and rerank after the existing enriched-chemical evidence attachment step. The Evidence Atlas (already the canonical reference page) gets tier badges on recommendation cards, a BibTeX option on the Cite button, and per-recommendation cite affordances.

**Tech Stack:** Next.js 15, TypeScript, Tailwind v4, Supabase (pgvector RPC), OpenAI SDK (`text-embedding-3-small`), Python FastAPI (chemistry scoring service), vitest (new, for unit tests of pure logic)

**Spec:** `docs/superpowers/specs/2026-05-21-citability-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `vitest.config.ts` | Create | Unit test runner config |
| `lib/types.ts` | Modify | Add `evidenceTier` to `Recommendation` |
| `lib/citation.ts` | Modify | Add `buildRecommendationCitationString()` |
| `lib/vector-search.ts` | Create | `searchLiterature()` — embeddings + RPC |
| `lib/pipeline.ts` | Modify | Uncomment Phase 2.5, batch embeddings, add tier derivation + rerank |
| `services/chemistry/scoring/p1_waste_prevention.py` | Modify | Add `_summary` key to `details` |
| `services/chemistry/scoring/p3_less_hazardous.py` | Modify | Add `_summary` key to `details` |
| `services/chemistry/scoring/p5_safer_solvents.py` | Modify | Add `_summary` key to `details` |
| `components/PrincipleSection.tsx` | Modify | Tier badge + "Model reasoning" label |
| `components/EvidenceAtlas.tsx` | Modify | BibTeX dropdown + per-rec cite affordance |
| `components/AnalysisResults.tsx` | Modify | Frame Evidence Atlas link as citable record |
| `tests/lib/vector-search.test.ts` | Create | Unit tests for `searchLiterature` shape |
| `tests/lib/pipeline-ranking.test.ts` | Create | Unit tests for tier derivation + reranking |
| `tests/lib/citation.test.ts` | Create | Unit tests for new citation helper |

---

## Task 1: Test infrastructure + type changes + citation helper

**Files:**
- Create: `vitest.config.ts`
- Modify: `lib/types.ts`
- Modify: `lib/citation.ts`
- Create: `tests/lib/citation.test.ts`

- [ ] **Step 1: Install vitest**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai
npm install --save-dev vitest
```

Expected: vitest appears in `package.json` devDependencies.

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

Add test script to `package.json` — find the `"scripts"` block and add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Add `evidenceTier` to `Recommendation` type**

In `lib/types.ts`, find the `Recommendation` interface (around line 68). After the `citationMetadata` field, add:

```typescript
  citationMetadata?: RecommendationCitationMetadata
  evidenceTier?: 'sourced' | 'inferred'
```

- [ ] **Step 4: Write failing test for `buildRecommendationCitationString`**

Create `tests/lib/citation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildRecommendationCitationString } from '@/lib/citation'
import type { Recommendation } from '@/lib/types'

const baseRec: Recommendation = {
  stepNumber: 3,
  principleNumbers: [5],
  principleNames: ['Safer Solvents'],
  severity: 'high',
  original: { chemical: 'DMF', issue: 'toxic solvent' },
  alternative: { chemical: 'DMSO', rationale: 'lower toxicity', yieldImpact: 'none', caveats: '', evidenceBasis: '' },
  confidenceLevel: 'high',
  citationMetadata: { gcaiVersion: '0.6.0', generatedAt: '2026-05-21T10:00:00Z' },
}

describe('buildRecommendationCitationString', () => {
  it('includes chemical names and step number', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).toContain('DMF')
    expect(result).toContain('DMSO')
    expect(result).toContain('Step 3')
  })

  it('includes version from citationMetadata', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).toContain('v0.6.0')
  })

  it('includes analysisId when provided', () => {
    const result = buildRecommendationCitationString(baseRec, 'abc-123')
    expect(result).toContain('abc-123')
  })

  it('omits analysis ID section when not provided', () => {
    const result = buildRecommendationCitationString(baseRec)
    expect(result).not.toContain('Analysis ID')
  })
})
```

- [ ] **Step 5: Run test to confirm it fails**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: FAIL — `buildRecommendationCitationString` is not exported from `@/lib/citation`.

- [ ] **Step 6: Add `buildRecommendationCitationString` to `lib/citation.ts`**

Add to `lib/citation.ts` after the existing imports, add `Recommendation` to the import:

```typescript
import type { AnalysisMetadata, Recommendation } from '@/lib/types'
```

Then add this function after `buildBibtexCitation`:

```typescript
export function buildRecommendationCitationString(
  rec: Recommendation,
  analysisId?: string
): string {
  const version = rec.citationMetadata?.gcaiVersion ?? 'unknown'
  const date = rec.citationMetadata?.generatedAt
    ? new Date(rec.citationMetadata.generatedAt).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0]
  const id = analysisId ?? rec.citationMetadata?.analysisId
  const idPart = id ? ` Analysis ID: ${id}.` : ''
  return `GreenChemistry.ai v${version}. Recommendation: replace ${rec.original.chemical} with ${rec.alternative.chemical} (Step ${rec.stepNumber}).${idPart} Generated ${date}.`
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: 4 tests pass.

- [ ] **Step 8: Typecheck**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add vitest.config.ts lib/types.ts lib/citation.ts tests/lib/citation.test.ts package.json package-lock.json
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: add evidenceTier type, buildRecommendationCitationString, vitest"
```

---

## Task 2: Create `lib/vector-search.ts`

**Files:**
- Create: `lib/vector-search.ts`
- Create: `tests/lib/vector-search.test.ts`

- [ ] **Step 1: Install openai package**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm install openai
```

Expected: `openai` appears in `package.json` dependencies.

- [ ] **Step 2: Write failing test**

Create `tests/lib/vector-search.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock before importing the module under test
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }],
      }),
    },
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn().mockReturnValue({
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'test-id',
          title: 'Green solvents review',
          authors: 'Smith et al.',
          journal: 'Green Chemistry',
          year: 2023,
          doi: '10.1039/test',
          url: 'https://doi.org/10.1039/test',
          content_snippet: 'DMSO shows lower toxicity than DMF in...',
          similarity: 0.85,
        },
      ],
      error: null,
    }),
  }),
}))

describe('searchLiterature', () => {
  it('returns shaped SearchResult array', async () => {
    const { searchLiterature } = await import('@/lib/vector-search')
    const results = await searchLiterature({
      query: 'replace DMF with safer solvent',
      limit: 3,
      threshold: 0.35,
      principles: [5],
      chemicals: ['dmf', 'dmso'],
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'test-id',
      title: 'Green solvents review',
      similarity: 0.85,
    })
  })

  it('returns empty array when RPC returns no data', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(createAdminClient).mockReturnValueOnce({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never)
    const { searchLiterature } = await import('@/lib/vector-search')
    const results = await searchLiterature({
      query: 'obscure query with no hits',
      limit: 3,
      threshold: 0.35,
    })
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: FAIL — cannot find module `@/lib/vector-search`.

- [ ] **Step 4: Create `lib/vector-search.ts`**

```typescript
import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
}): Promise<SearchResult[]> {
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: params.query,
  })
  const embedding = embeddingResponse.data[0].embedding

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('match_literature_precedents', {
    query_embedding: embedding,
    match_threshold: params.threshold,
    match_count: params.limit,
    filter_principles: params.principles ?? [],
    filter_chemicals: params.chemicals ?? [],
  })

  if (error) throw error
  return (data ?? []) as SearchResult[]
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: all tests pass including the 2 new vector-search tests.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add lib/vector-search.ts tests/lib/vector-search.test.ts package.json package-lock.json
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: add vector-search module with OpenAI embeddings + Supabase RPC"
```

---

## Task 3: Activate Phase 2.5 in pipeline — batch embeddings, tier derivation, reranking

**Files:**
- Modify: `lib/pipeline.ts`
- Create: `tests/lib/pipeline-ranking.test.ts`

- [ ] **Step 1: Write failing tests for tier derivation and reranking**

Create `tests/lib/pipeline-ranking.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { deriveEvidenceTier, rankRecommendations } from '@/lib/pipeline'
import type { Recommendation } from '@/lib/types'

function makeRec(overrides: Partial<Recommendation>): Recommendation {
  return {
    stepNumber: 1,
    principleNumbers: [5],
    principleNames: ['Safer Solvents'],
    severity: 'medium',
    original: { chemical: 'DMF', issue: 'toxic' },
    alternative: { chemical: 'DMSO', rationale: 'safer', yieldImpact: '', caveats: '', evidenceBasis: '' },
    confidenceLevel: 'medium',
    ...overrides,
  }
}

describe('deriveEvidenceTier', () => {
  it('returns sourced when citations present', () => {
    const rec = makeRec({
      evidence: {
        why_flagged: [],
        why_replacement: [],
        citations: [{ source_id: 'x', source_name: 'J. GC', citation: 'Smith 2023', url: undefined }],
      },
    })
    expect(deriveEvidenceTier(rec)).toBe('sourced')
  })

  it('returns inferred when no evidence', () => {
    expect(deriveEvidenceTier(makeRec({}))).toBe('inferred')
  })

  it('returns inferred when citations array is empty', () => {
    const rec = makeRec({
      evidence: { why_flagged: [], why_replacement: [], citations: [] },
    })
    expect(deriveEvidenceTier(rec)).toBe('inferred')
  })
})

describe('rankRecommendations', () => {
  it('sorts sourced above inferred at equal severity', () => {
    const inferred = makeRec({ severity: 'high', evidenceTier: 'inferred' })
    const sourced = makeRec({ severity: 'high', evidenceTier: 'sourced' })
    const [first] = rankRecommendations([inferred, sourced])
    expect(first).toBe(sourced)
  })

  it('keeps high-severity inferred above low-severity sourced', () => {
    const highInferred = makeRec({ severity: 'high', evidenceTier: 'inferred' })
    const lowSourced = makeRec({ severity: 'low', evidenceTier: 'sourced' })
    const [first] = rankRecommendations([lowSourced, highInferred])
    expect(first).toBe(highInferred)
  })

  it('sourced-medium ties inferred-high — sourced wins tiebreak', () => {
    const infHigh = makeRec({ severity: 'high', evidenceTier: 'inferred' })  // 3 × 1.0 = 3.0
    const srcMed = makeRec({ severity: 'medium', evidenceTier: 'sourced' })  // 2 × 1.5 = 3.0
    const [first] = rankRecommendations([infHigh, srcMed])
    expect(first).toBe(srcMed)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: FAIL — `deriveEvidenceTier` and `rankRecommendations` are not exported from `@/lib/pipeline`.

- [ ] **Step 3: Export `deriveEvidenceTier` and `rankRecommendations` from `lib/pipeline.ts`**

At the bottom of `lib/pipeline.ts`, add these two exported pure functions. The constants must be at module scope so both the exports and the inline sort in Step 6 can use them:

```typescript
export const SEVERITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }
export const TIER_MULTIPLIER: Record<string, number> = { sourced: 1.5, inferred: 1.0 }

export function deriveEvidenceTier(rec: Recommendation): 'sourced' | 'inferred' {
  return (rec.evidence?.citations?.length ?? 0) > 0 ? 'sourced' : 'inferred'
}

export function rankRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => {
    const scoreA = (SEVERITY_WEIGHT[a.severity] ?? 1) * (TIER_MULTIPLIER[a.evidenceTier ?? 'inferred'] ?? 1)
    const scoreB = (SEVERITY_WEIGHT[b.severity] ?? 1) * (TIER_MULTIPLIER[b.evidenceTier ?? 'inferred'] ?? 1)
    if (scoreB !== scoreA) return scoreB - scoreA
    // Tiebreak: sourced wins
    if (a.evidenceTier === 'sourced' && b.evidenceTier !== 'sourced') return -1
    if (b.evidenceTier === 'sourced' && a.evidenceTier !== 'sourced') return 1
    return 0
  })
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Activate Phase 2.5 in `lib/pipeline.ts`**

Find line 8: `// import { searchLiterature, SearchResult } from '@/lib/vector-search'`  
Replace with:
```typescript
import { searchLiterature } from '@/lib/vector-search'
```

Find the Phase 2.5 section (starts with `// Phase 2.5: Ground recommendations in literature via Vector Search`). Replace the entire block — from the `onProgress` call through the closing `*/` — with this active version that batches embedding calls:

```typescript
  // Phase 2.5: Ground recommendations in literature via Vector Search
  onProgress?.({ type: 'phase', phase: 2, message: 'Grounding recommendations in literature...' })
  try {
    // Build all query strings first, then batch-retrieve
    const queries = rawRecommendations.map(rec =>
      `Green chemistry alternative for ${rec.original.chemical}: ${rec.alternative.chemical}. ${rec.alternative.rationale}`
    )

    const results = await Promise.allSettled(
      rawRecommendations.map((rec, i) =>
        searchLiterature({
          query: queries[i],
          limit: 3,
          threshold: 0.35,
          principles: rec.principleNumbers,
          chemicals: [rec.original.chemical.toLowerCase(), rec.alternative.chemical.toLowerCase()],
        })
      )
    )

    for (let i = 0; i < rawRecommendations.length; i++) {
      const result = results[i]
      if (result.status === 'rejected') {
        console.warn(`[pipeline] Phase 2.5 retrieval failed for ${rawRecommendations[i].original.chemical}:`, result.reason)
        continue
      }
      const matches = result.value
      if (matches.length === 0) continue

      const rec = rawRecommendations[i]
      if (!rec.evidence) {
        rec.evidence = { why_flagged: [], why_replacement: [], citations: [] }
      }
      for (const match of matches) {
        const alreadyExists = rec.evidence.citations.some(c => c.doi === match.doi)
        if (!alreadyExists) {
          rec.evidence.citations.push({
            source_id: match.id,
            source_name: match.journal || match.title,
            citation: `${match.authors || 'Unknown'} (${match.year || 'n.d.'}). ${match.title}.`,
            url: match.url ?? undefined,
            doi: match.doi ?? undefined,
          })
          if (match.content_snippet) {
            rec.evidence.why_replacement.push({
              chemical: rec.alternative.chemical,
              source: match.journal || 'Literature',
              content: match.content_snippet,
            })
          }
        }
      }
    }
  } catch (err) {
    console.warn('[pipeline] Phase 2.5 skipped due to error:', err)
  }
```

- [ ] **Step 6: Add tier derivation and reranking after enriched-chemical evidence attachment**

In `lib/pipeline.ts`, find this comment (currently near line 643):
```typescript
  // v0.6: Derive primaryBenefit if the LLM didn't provide one
```

Insert BEFORE that comment:

```typescript
  // v0.6: Derive evidence tier and rerank
  for (const rec of recommendations) {
    rec.evidenceTier = deriveEvidenceTier(rec)
  }
  recommendations.sort((a, b) => {
    const scoreA = (SEVERITY_WEIGHT[a.severity] ?? 1) * (TIER_MULTIPLIER[a.evidenceTier ?? 'inferred'] ?? 1)
    const scoreB = (SEVERITY_WEIGHT[b.severity] ?? 1) * (TIER_MULTIPLIER[b.evidenceTier ?? 'inferred'] ?? 1)
    if (scoreB !== scoreA) return scoreB - scoreA
    if (a.evidenceTier === 'sourced' && b.evidenceTier !== 'sourced') return -1
    if (b.evidenceTier === 'sourced' && a.evidenceTier !== 'sourced') return 1
    return 0
  })
```

Note: `recommendations` is `const` but it's an array — `.sort()` mutates in place, no reassignment needed.

- [ ] **Step 7: Add `OPENAI_API_KEY` env var**

Create `.env.local.example` in the project root:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=

# Chemistry microservice
CHEMISTRY_SERVICE_URL=http://localhost:8000
CHEMISTRY_SERVICE_TOKEN=

# OpenAI (used for literature search embeddings only)
OPENAI_API_KEY=
```

- [ ] **Step 8: Typecheck**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Run all tests**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add lib/pipeline.ts tests/lib/pipeline-ranking.test.ts .env.local.example
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: activate Phase 2.5 vector retrieval, add evidence tier derivation and reranking"
```

---

## Task 4: Python scoring modules — add `_summary` to details

**Files:**
- Modify: `services/chemistry/scoring/p1_waste_prevention.py`
- Modify: `services/chemistry/scoring/p3_less_hazardous.py`
- Modify: `services/chemistry/scoring/p5_safer_solvents.py`

- [ ] **Step 1: Add `_summary` to P1 details**

In `services/chemistry/scoring/p1_waste_prevention.py`, find the `return PrincipleScore(` block that contains `"pmi": round(pmi, 2)`. Add `_summary` as the first key in the `details` dict:

```python
details={
    "_summary": (
        f"PMI = {round(pmi, 2):.1f} "
        f"({round(total_input_g, 1):.0f} g input → {round(product_mass_g, 1):.0f} g product, "
        f"{yield_used}% yield). "
        + (f"vs. {reaction_type} benchmark PMI {benchmark_pmi}: {vs_benchmark.replace('_', ' ')}." if vs_benchmark else "No benchmark available.")
    ),
    "pmi": round(pmi, 2),
    # ... rest unchanged
```

Also add `_summary` to the error-path `details` (where `pmi is None`):

```python
details={
    "_summary": "PMI unavailable — no yield data and no reaction type benchmark.",
    "error": "Cannot calculate PMI — no yield data and no reaction type benchmark available",
    "total_input_g": round(total_input_g, 2),
},
```

- [ ] **Step 2: Add `_summary` to P3 details**

In `services/chemistry/scoring/p3_less_hazardous.py`, find the `return PrincipleScore(` block. Add `_summary` as the first key:

```python
details={
    "_summary": (
        f"{len(chem_details)} chemical(s) evaluated totalling {round(total_mass_g, 1):.0f} g; "
        f"{sum(1 for d in chem_details if d['is_cmr'])} CMR substance(s) flagged."
    ),
    "total_mass_g": round(total_mass_g, 2),
    # ... rest unchanged
```

Also add `_summary` to the no-chemicals early-return path:

```python
details={"_summary": "No chemicals to evaluate.", "note": "No chemicals to evaluate"},
```

- [ ] **Step 3: Add `_summary` to P5 details**

In `services/chemistry/scoring/p5_safer_solvents.py`, find the `return PrincipleScore(` block. Add `_summary` as the first key:

```python
details={
    "_summary": (
        f"{round(total_mass_g, 1):.0f} g total solvent; "
        f"{len(flagged)} solvent(s) of concern per CHEM21 guide."
    ),
    "total_solvent_mass_g": round(total_mass_g, 2),
    # ... rest unchanged
```

Also add `_summary` to the no-solvents early-return:

```python
details={"_summary": "No solvents identified in protocol.", "note": "No solvents identified in protocol"},
```

- [ ] **Step 4: Verify Python service starts without errors**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai/services/chemistry && python -c "from scoring.p1_waste_prevention import score_p1; from scoring.p3_less_hazardous import score_p3; from scoring.p5_safer_solvents import score_p5; print('OK')"
```

Expected: prints `OK` with no import errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add services/chemistry/scoring/p1_waste_prevention.py services/chemistry/scoring/p3_less_hazardous.py services/chemistry/scoring/p5_safer_solvents.py
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: add calculation summary strings to P1/P3/P5 scoring details"
```

---

## Task 5: UI — PrincipleSection tier badge + Model reasoning label

**Files:**
- Modify: `components/PrincipleSection.tsx`

The `PrincipleSection` component receives `recommendations: Recommendation[]`. Each rec now has `evidenceTier?: 'sourced' | 'inferred'`. Old analyses missing the field should render as `'inferred'`.

- [ ] **Step 1: Add tier badge to each recommendation card**

In `components/PrincipleSection.tsx`, find the recommendation card render block. It contains the severity badge and the original→alternative chemical swap. Add a tier badge at the top-right of each card.

Find the section that maps over recommendations — it will look something like:
```tsx
{recommendations.map((rec, i) => (
  <div key={i} className="...">
```

Inside that div, near the severity badge, add a tier badge alongside it:

```tsx
{/* Evidence tier badge */}
{(rec.evidenceTier ?? 'inferred') === 'sourced' ? (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">
    Literature-backed
  </span>
) : (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/50">
    Model-inferred
  </span>
)}
```

- [ ] **Step 2: Add "Model reasoning" label for inferred recommendations**

In the same recommendation card render block, find where `rec.evidence.citations` is rendered (the "Critical Evidence" section). After that block, add the model reasoning section that shows for inferred recs:

```tsx
{/* Model reasoning — shown when no literature citations */}
{(rec.evidenceTier ?? 'inferred') === 'inferred' && rec.alternative.rationale && (
  <div className="mt-3 rounded-md bg-amber-950/30 border border-amber-800/30 p-3">
    <p className="text-xs font-medium text-amber-400/80 uppercase tracking-wide mb-1">
      Model reasoning
    </p>
    <p className="text-sm text-zinc-300">{rec.alternative.rationale}</p>
  </div>
)}
```

- [ ] **Step 3: Add `_summary` rendering to score details section**

Find the "Scoring Details" render block that maps over `Object.entries(score.details)`. Before that map, add a prominent summary line if `_summary` is present:

```tsx
{score.details._summary && (
  <p className="text-sm text-zinc-300 mb-3 italic">
    {String(score.details._summary)}
  </p>
)}
{Object.entries(score.details)
  .filter(([key]) => key !== '_summary')
  .map(([key, val]) => (
    <div key={key} className="flex justify-between text-sm py-0.5">
      <span className="text-zinc-400">{key.replace(/_/g, ' ')}</span>
      <span className="text-zinc-200 font-mono">{String(val ?? '—')}</span>
    </div>
  ))}
```

- [ ] **Step 4: Build check**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add components/PrincipleSection.tsx
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: add evidence tier badges and model reasoning label to recommendation cards"
```

---

## Task 6: UI — EvidenceAtlas BibTeX dropdown + per-recommendation cite

**Files:**
- Modify: `components/EvidenceAtlas.tsx`
- Modify: `lib/citation.ts` (add import — already done in Task 1)

The existing Cite button calls `buildCitationString(metadata)` and copies to clipboard. We extend it to a two-option dropdown and add a per-recommendation cite icon.

- [ ] **Step 1: Add BibTeX dropdown to Cite button**

In `components/EvidenceAtlas.tsx`, find the Cite button section (around the `buildCitationString` call). Replace the single button with a dropdown group:

```tsx
{/* Citation dropdown */}
<div className="relative inline-block" ref={citeDropdownRef}>
  <button
    onClick={() => setCiteOpen(v => !v)}
    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
  >
    Cite
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  </button>
  {citeOpen && (
    <div className="absolute right-0 mt-1 w-48 rounded-md bg-zinc-800 border border-zinc-700 shadow-lg z-10">
      <button
        className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 rounded-t-md"
        onClick={() => {
          navigator.clipboard.writeText(buildCitationString(metadata))
          setCiteOpen(false)
        }}
      >
        Copy citation (plain text)
      </button>
      <button
        className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700 rounded-b-md"
        onClick={() => {
          navigator.clipboard.writeText(buildBibtexCitation(metadata, analysisId))
          setCiteOpen(false)
        }}
      >
        Copy BibTeX
      </button>
    </div>
  )}
</div>
```

Add state and ref at the top of the component:

```tsx
const [citeOpen, setCiteOpen] = React.useState(false)
const citeDropdownRef = React.useRef<HTMLDivElement>(null)

// Close on outside click
React.useEffect(() => {
  function handleClick(e: MouseEvent) {
    if (citeDropdownRef.current && !citeDropdownRef.current.contains(e.target as Node)) {
      setCiteOpen(false)
    }
  }
  document.addEventListener('mousedown', handleClick)
  return () => document.removeEventListener('mousedown', handleClick)
}, [])
```

Add `buildBibtexCitation` to the import from `@/lib/citation`.

- [ ] **Step 2: Add per-recommendation cite icon**

`EvidenceAtlas` renders `<PrincipleSection>` components that render the actual recommendation cards. The per-rec cite affordance needs the `analysisId`. Pass it down as a prop to `PrincipleSection` and then use `buildRecommendationCitationString` inside.

In `components/EvidenceAtlas.tsx`, find where `PrincipleSection` is rendered and add `analysisId`:

```tsx
<PrincipleSection
  ...existingProps
  analysisId={analysisId}
/>
```

In `components/PrincipleSection.tsx`, add `analysisId?: string` to the component props interface, then add `buildRecommendationCitationString` import from `@/lib/citation`.

In the recommendation card, after the tier badge, add a cite icon button:

```tsx
<button
  title="Copy citation for this recommendation"
  className="text-zinc-500 hover:text-zinc-300 transition-colors"
  onClick={() => {
    navigator.clipboard.writeText(buildRecommendationCitationString(rec, analysisId))
  }}
>
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
</button>
```

- [ ] **Step 3: Build check**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add components/EvidenceAtlas.tsx components/PrincipleSection.tsx
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: add BibTeX dropdown and per-recommendation cite to Evidence Atlas"
```

---

## Task 7: UI — Frame Evidence Atlas as citable record in AnalysisResults

**Files:**
- Modify: `components/AnalysisResults.tsx`

The Evidence Atlas is currently linked via a "View Full Evidence" button. Add a short framing note that identifies it as the shareable citable record.

- [ ] **Step 1: Find the Evidence Atlas link in AnalysisResults**

In `components/AnalysisResults.tsx`, grep for `evidence` to find the "View Full Evidence" button:

```bash
grep -n "evidence\|Evidence\|Full Evidence" /Users/ct-mac-mini/dev/greenchemistry-ai/components/AnalysisResults.tsx
```

- [ ] **Step 2: Add framing callout near the Evidence Atlas link**

Wrap the existing "View Full Evidence" link in a callout card. Replace or wrap the existing button/link with:

```tsx
<div className="mt-4 rounded-lg border border-zinc-700/60 bg-zinc-900/50 p-4 flex items-start gap-3">
  <div className="flex-1">
    <p className="text-sm font-medium text-zinc-200">Evidence Atlas</p>
    <p className="text-xs text-zinc-400 mt-0.5">
      Full citations, calculation trails, and confidence tiers for every recommendation.
      Share this URL to reference this analysis.
    </p>
  </div>
  <a
    href={`/analyze/${analysisId}/evidence`}
    className="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
  >
    View →
  </a>
</div>
```

Note: use the same `analysisId` prop already available in the component. If the component doesn't receive `analysisId` directly, check how the existing Evidence Atlas link is constructed and use the same variable.

- [ ] **Step 3: Build check**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm run build 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 4: Run all tests**

```bash
cd /Users/ct-mac-mini/dev/greenchemistry-ai && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/ct-mac-mini/dev/greenchemistry-ai add components/AnalysisResults.tsx
git -C /Users/ct-mac-mini/dev/greenchemistry-ai commit -m "feat: frame Evidence Atlas as citable record in analysis results view"
```

---

## Acceptance Criteria Checklist

After all tasks are complete, verify against the spec:

- [ ] Every recommendation card in the Evidence Atlas shows "Literature-backed" or "Model-inferred" badge
- [ ] Sourced recommendations rank above same-severity inferred recommendations (run an analysis and inspect order)
- [ ] Inferred recommendations show `rec.alternative.rationale` under "Model reasoning" label
- [ ] Cite button in Evidence Atlas offers both plain-text and BibTeX copy options
- [ ] Each recommendation card has a per-recommendation cite icon that copies a citation string
- [ ] `score.details` shows `_summary` line for P1/P3/P5 principles
- [ ] Evidence Atlas callout on main results view says "Share this URL to reference this analysis"
- [ ] Retrieval failure degrades gracefully (disconnect from DB, all recs stay `inferred`, no crash)
- [ ] `OPENAI_API_KEY` documented in `.env.local.example`
- [ ] `npm test` passes
- [ ] `npm run build` passes
