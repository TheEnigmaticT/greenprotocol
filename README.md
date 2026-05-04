# GreenProtoCol

GreenProtoCol analyzes chemistry lab protocols against the 12 Principles of Green Chemistry, generates concrete substitution recommendations, and estimates the environmental impact of adopting those changes.

This repo is a hybrid system:

- A Next.js app handles auth, the product UI, persistence, and the LLM orchestration pipeline.
- A Python chemistry service handles quantity conversion and deterministic scoring using PubChem, RDKit, GHS data, and embedded scoring logic.

## Current Architecture

1. User submits protocol text.
2. The Next.js pipeline parses the protocol into steps and chemicals.
3. The chemistry service enriches quantities and computes deterministic scores when available.
4. The LLM pipeline evaluates the protocol against the 12 principles and generates recommendation text.
5. The app saves the analysis to Supabase and renders recommendation review, impact, and scorecard views.

Main application areas:

- `app/`: routes, pages, and API handlers
- `components/`: protocol review UI, scorecard, impact views
- `lib/pipeline.ts`: analysis orchestration
- `lib/chemistry-service.ts`: HTTP client for the Python service
- `services/chemistry/`: FastAPI chemistry service and scoring logic
- `supabase/`: schema migrations
- `docs/`: architecture and planning notes

## Deterministic vs LLM-Assisted

The system is not purely deterministic end to end.

Deterministic infrastructure:

- PubChem property lookup
- RDKit-backed chemistry operations
- GHS-based hazard scoring
- CHEM21 solvent scoring
- Quantity conversion and normalization in the chemistry service

LLM-assisted parts:

- Protocol parsing into structured steps
- Recommendation generation and explanation
- Revised protocol assembly
- Some scoring inputs and principles still depend on extraction or judgment calls, including reaction SMILES extraction, yield extraction, and principles such as P8 and P11

That means the numerical substrate is increasingly grounded, but some inputs and final narrative outputs still depend on model behavior.

## Stack

- Next.js 16
- React 19
- TypeScript 5
- Supabase auth and Postgres
- Anthropic SDK
- FastAPI
- RDKit
- PubChem API

## Local Development

### App

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000`.

### Chemistry Service

From `services/chemistry`:

```bash
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

By default the Next.js app expects the chemistry service at `http://localhost:8000`.

The chemistry service is now pinned to a Python 3.14-capable dependency set. In practice that means `rdkit==2025.9.3` and `pydantic==2.12.0` or newer-compatible equivalents.

## Environment Variables

Required for the app:

- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required for admin operations:

- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `CHEMISTRY_SERVICE_URL` default: `http://localhost:8000`
- `CHEMISTRY_SERVICE_TOKEN` shared secret sent to the chemistry service when it is exposed on a VPS
- `ANALYSIS_RUN_LIMIT` default: `10`

For Cloud Run deployment of deterministic scoring, see `docs/infra/cloud-run-chemistry.md`.
For VPS deployment, see `docs/infra/chemistry-vps.md`.

## Important Routes

- `/`: landing page
- `/login`: auth
- `/analyze`: session-backed analysis result page
- `/analyze/[id]`: persisted analysis page
- `/dashboard`: saved analyses

API routes:

- `POST /api/analyze`: run full analysis with SSE progress
- `GET /api/analyses`: list analyses for current user
- `GET/PATCH /api/analyses/[id]`: fetch or update a saved analysis
- `POST /api/rescore`: rerun deterministic scoring after accepted changes
- `GET /api/export/dozn/[id]`: DOZN export path

## Data Model

Persisted analyses are stored in `gpc_analyses` with:

- `protocol_text`
- `analysis_result`
- `impact_delta`
- `user_id`

Recommendation acceptance state currently lives inside `analysis_result`.

## Notes

- `README.md` is intended to describe the actual running system, not the aspirational roadmap.
- For deeper design context, start with `docs/technology-overview.md` and `docs/pipeline-v2-architecture.md`.
