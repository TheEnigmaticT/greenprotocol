# GreenProtoCol Technology Overview

## What It Does

GreenProtoCol analyzes chemistry lab protocols against the 12 Principles of Green Chemistry, scores them quantitatively, recommends specific chemical substitutions, and shows the projected environmental impact of adopting those changes.

## Architecture

```
User submits protocol text
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  Next.js 16 App (Vercel)                            │
│                                                     │
│  Phase 1: Parse protocol ──── Claude API ───────┐   │
│  Phase 1.5: Enrich chemicals ── Chemistry ──┐   │   │
│  Phase 1.5: Score 12 principles ── Service ──┤   │   │
│  Phase 2: Evaluate principles ── Claude API ──┤   │   │
│  Phase 3: Assemble revised protocol ── Claude │   │   │
│                                               │   │   │
│  Client-side: Projected rescoring after       │   │   │
│  user accepts/declines recommendations        │   │   │
└───────────────────────────────┬───────────────┘   │
                                │                   │
                    ┌───────────▼──────────┐        │
                    │  Chemistry Service   │        │
                    │  (FastAPI + RDKit)    │        │
                    │                      │        │
                    │  PubChem lookups      │        │
                    │  GHS hazard codes     │        │
                    │  CHEM21 solvent data  │        │
                    │  Atom economy calc    │        │
                    │  PMI scoring          │        │
                    │  12-principle scoring  │        │
                    └──────────────────────┘        │
                                                    │
                    ┌──────────────────────┐        │
                    │  Supabase            │◄───────┘
                    │  Auth + Database     │
                    │  (analysis storage)  │
                    └──────────────────────┘
```

## Technology Stack

### Frontend & Orchestration

| Technology | Version | What It Does | Why This One |
|-----------|---------|-------------|-------------|
| **Next.js** | 16 (App Router) | Server-side rendering, API routes, SSE streaming | Industry standard React framework. App Router gives us server components and streaming responses out of the box. |
| **React** | 19 | UI components | Required by Next.js. v19 gives us server components and improved Suspense. |
| **TypeScript** | 5 | Type safety across frontend and API | Catches schema mismatches between pipeline phases at compile time. |
| **Tailwind CSS** | v4 | Styling | Utility-first CSS. No design system overhead for a small team. |

### AI / LLM

| Technology | What It Does | Why This One |
|-----------|-------------|-------------|
| **Claude Sonnet 4.5** (Anthropic) | Protocol parsing, principle evaluation, protocol assembly | Best-in-class structured output via Tool Use API. Reliable JSON schema adherence. Production default. |
| **Anthropic SDK** (`@anthropic-ai/sdk`) | TypeScript client for Claude API | Official SDK with streaming support. |
| **OpenRouter** (eval/future) | Multi-model gateway | Testing OSS models (Qwen 3.5/3.6) for on-prem deployment. Same OpenAI-compatible API across 350+ models. |
| **Qwen 3.5/3.6** (eval/future) | On-prem LLM candidate | Best open-source model for structured extraction tasks. Runs on Mac Studio (M5, 256GB) for data-sovereign clients. |

### Chemistry Informatics (Python Microservice)

| Technology | What It Does | Why This One |
|-----------|-------------|-------------|
| **FastAPI** | HTTP API framework | Async, fast, auto-generates OpenAPI docs. Python ecosystem required for RDKit. |
| **RDKit** (`rdkit`) | Cheminformatics toolkit | Industry-standard open-source library for molecular calculations — SMILES validation, atom economy, molecular weight. No commercial alternative comes close. |
| **PubChem API** | Chemical property lookups | Free, authoritative source for molecular weights, densities, CAS numbers. 110M+ compounds. |
| **PubChem PUG-View** | GHS hazard code lookups | Structured hazard classification data (H-codes) for every compound with a CID. |
| **CHEM21 Solvent Guide** | Solvent safety classification | Published classification (recommended / problematic / hazardous / highly hazardous) from Prat et al., Green Chem., 2016. Hard-coded in `chem21.py`. |
| **httpx** | Async HTTP client | For PubChem API calls from the chemistry service. |
| **uvicorn** | ASGI server | Production server for FastAPI. |

### Data Sources (Embedded)

| Source | What We Use It For | Reference |
|--------|-------------------|-----------|
| **CHEM21 Solvent Selection Guide** | Solvent safety scoring (P5) | Prat et al., *Green Chem.*, 2016, 18, 288-296 |
| **ACS GCI Reaction Type Benchmarks** | PMI benchmarks for waste scoring (P1) | ACS Green Chemistry Institute Pharmaceutical Roundtable |
| **EPA GHG Equivalencies Calculator** | Converting CO2e to human-readable equivalencies (car miles, tree seedlings) | EPA.gov conversion factors |
| **GHS Classification** | Health (P3), environmental (P10), physical (P12) hazard scoring | Globally Harmonized System, sourced via PubChem |

### Auth & Storage

| Technology | What It Does | Why This One |
|-----------|-------------|-------------|
| **Supabase** | Auth (Google OAuth + email/password) + PostgreSQL database | Hosted Postgres with built-in auth, RLS policies, and a generous free tier. Analyses stored as JSONB. |
| **Supabase SSR** (`@supabase/ssr`) | Server-side auth for Next.js middleware | Handles cookie-based auth in App Router without client-side token exposure. |

### Infrastructure

| Technology | What It Does | Why This One |
|-----------|-------------|-------------|
| **Vercel** | Next.js hosting, auto-deploy from GitHub | Zero-config deployment for Next.js. Serverless functions for API routes. |
| **Cloud Run** | Chemistry service hosting | Runs FastAPI/RDKit outside the Mac mini with HTTPS, autoscaling, and low ops overhead. See `docs/infra/cloud-run-chemistry.md`. |
| **VPS + Caddy** | Alternate chemistry service hosting | Lower-level fallback if always-on VPS economics become preferable. |
| **Docker Compose** | VPS service packaging | Runs the chemistry service and Caddy together on a VPS. |
| **localhost.run** | SSH tunnel for chemistry service (legacy demo path) | No longer the desired production path. Use only for quick local demos. |

### Scoring Methodology

Each of the 12 Green Chemistry Principles is scored 0-10 (lower = greener):

| Principle | Method | Data Source | Confidence |
|-----------|--------|-------------|------------|
| P1 Waste Prevention (PMI) | `total_input_mass / product_mass` vs ACS GCI benchmark | Unit converter + yield extraction (LLM) | benchmark |
| P2 Atom Economy | `product_MW / total_reactant_MW × 100` | RDKit from reaction SMILES (LLM-extracted) | partial/calculated |
| P3 Less Hazardous | Max GHS health H-code score × mass weighting | PubChem GHS lookup | calculated |
| P4 Safer Products | GHS health scores for identified products | PubChem GHS lookup | partial |
| P5 Safer Solvents | CHEM21 classification × mass weighting | CHEM21 guide (hard-coded) | calculated |
| P6 Energy Efficiency | Temperature deviation from ambient | Protocol parse (LLM) | calculated |
| P7 Renewable Feedstocks | Petroleum-derived mass fraction | Renewable flag database | calculated |
| P8 Reduce Derivatives | Baran Ideality metric (ideal/concession steps) | Step classification (LLM) | estimated |
| P9 Catalysis | Stoichiometric vs catalytic reagent ratio | Role classification from parse | calculated |
| P10 Degradation | Max GHS environmental H-code score × mass | PubChem GHS lookup | calculated |
| P11 Real-Time Analysis | Monitoring adequacy assessment | LLM assessment | estimated |
| P12 Accident Prevention | Max GHS physical H-code score × mass | PubChem GHS lookup | calculated |

**Confidence tiers:**
- `calculated` — deterministic formula with verified data
- `benchmark` — compared against published benchmarks (e.g., ACS GCI PMI ranges)
- `estimated` — includes an LLM judgment call
- `partial` — some data unavailable, score is incomplete

## Key Design Decisions

1. **Hybrid deterministic + LLM pipeline.** Numbers come from math (RDKit, PubChem, CHEM21). Recommendations come from AI. This separation means scoring is reproducible and model-independent, while recommendations benefit from LLM reasoning.

2. **TypeScript orchestrator + Python chemistry service.** Next.js handles the web app and LLM orchestration. Python handles chemistry (RDKit has no JS equivalent). Clean separation of concerns.

3. **Tool Use for structured output.** All LLM calls use Anthropic's Tool Use API (or OpenAI function calling for OSS models) to force responses into validated JSON schemas. No regex parsing, no prompt-and-pray.

4. **Client-side projected rescoring.** After users accept/decline recommendations, P3/P5/P10/P12 are re-estimated instantly in the browser using the same GHS/CHEM21 formulas. No API round-trip for the interactive accept/reject flow.

5. **Graceful degradation.** If the chemistry service is down, the pipeline falls back to LLM-only analysis (no deterministic scores, no enriched chemicals). The UI conditionally renders the ScoreCard only when scores exist.
