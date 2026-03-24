# Scaling Architecture: 20+ Clients

## Client Archetypes

### Type A: SaaS (Millipore Sigma, Lab Central, academia)
Cloud-hosted, multi-tenant. Shared infrastructure, per-account quotas.
Login, paste protocol, get results. Standard subscription model.

### Type B: On-Prem / Data-Sovereign (CST, pharma companies)
Protocols are trade secrets. Full stack on their metal or VPC.
No data leaves their network. Local LLM (Qwen on Mac Studio).
Docker-compose deployment.

### Type C: White-Label / Embedded (Millipore Sigma DOZN integration)
No UI. Chemistry scoring service as an API they call from their
own product. The microservice IS the product.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Client Layer (per-client or shared)                    │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │   Next.js    │  │   Next.js    │  │   API-only    │ │
│  │   SaaS UI    │  │   On-prem    │  │   (Type C)    │ │
│  │  (Vercel)    │  │  (Docker)    │  │   (Docker)    │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │                 │                  │
┌─────────▼─────────────────▼──────────────────▼──────────┐
│  Orchestration Layer                                     │
│  Pipeline service (Phase 1 → 5 flow)                     │
│                                                          │
│  - Manages the parse → rationalize → score → recommend   │
│    → rewrite pipeline                                    │
│  - Calls LLM provider (configurable per deployment)      │
│  - Calls chemistry service                               │
│  - Manages SSE streaming to client                       │
│  - Per-tenant config: LLM choice, run limits, features   │
│                                                          │
│  Currently: embedded in Next.js API routes               │
│  Future: standalone service for Type C deployments        │
└─────────┬────────────────────────────────────┬──────────┘
          │                                    │
┌─────────▼────────────┐  ┌───────────────────▼───────────┐
│  LLM Provider        │  │  Chemistry Service             │
│  (swappable)         │  │  (deterministic, stateless)    │
│                      │  │                                │
│  Configured per      │  │  - POST /batch (conversions)   │
│  deployment via      │  │  - POST /score (12 principles) │
│  env vars:           │  │  - PubChem + CHEM21 + RDKit    │
│                      │  │  - File-backed PubChem cache   │
│  ┌────────────────┐  │  │                                │
│  │ Claude API     │  │  │  Singleton: same chemistry     │
│  │ (SaaS default) │  │  │  regardless of client.         │
│  ├────────────────┤  │  │  One instance serves all       │
│  │ Claude Enterpr.│  │  │  SaaS clients. On-prem gets    │
│  │ (data-sov.)    │  │  │  its own instance.             │
│  ├────────────────┤  │  │                                │
│  │ Qwen 3.5 127B │  │  │  Cheapest service to scale —   │
│  │ (local metal)  │  │  │  deterministic, cacheable,     │
│  ├────────────────┤  │  │  no LLM costs.                 │
│  │ OpenAI / other │  │  │                                │
│  └────────────────┘  │  └────────────────────────────────┘
└──────────────────────┘
          │
┌─────────▼───────────────────────────────────────────────┐
│  Data Layer (per-client isolation)                        │
│                                                          │
│  SaaS:     Supabase (shared or per-client projects)      │
│  On-prem:  Local PostgreSQL (Docker container)           │
│  Type C:   Client manages their own persistence          │
│                                                          │
│  Contains:                                               │
│  - Auth (Supabase Auth or local)                         │
│  - Analysis history (gpc_analyses)                       │
│  - User profiles + run quotas (gpc_profiles)             │
│  - PubChem cache (shared, not per-client)                │
│                                                          │
│  At 20 clients: RLS multi-tenant is fine                 │
│  At 100+: per-client Supabase projects                   │
└──────────────────────────────────────────────────────────┘
```

## Scaling Properties of Each Layer

### Chemistry Service (easiest to scale)
- **Stateless** — no database, no sessions
- **Deterministic** — same input = same output, every time
- **Cacheable** — PubChem results cached on disk, warm cache serves instantly
- **Cheap** — no LLM costs for 7 of 12 principles
- One instance behind a load balancer serves all SaaS clients
- On-prem clients get their own container (same Docker image)
- At 20 clients: single instance is fine (handles hundreds of req/s)
- At 100 clients: add a Redis cache layer, horizontal scale to 2-3 instances

### LLM Provider (most expensive to scale)
- SaaS clients share one Anthropic API account, costs passed through
- On-prem clients bring their own key or local model
- The pipeline is model-agnostic: env vars control which provider
- At 20 clients: Anthropic API rate limits may matter — request queueing
- Cost control: the deterministic scoring reduces LLM calls from 14 → 6,
  cutting API costs by ~57% per analysis

### Orchestration / Pipeline (most complex to scale)
- Currently embedded in Next.js serverless functions (Vercel)
- Vercel has a 300s max execution time — tight for the full pipeline
- At 20 SaaS clients: Vercel Pro handles concurrent analyses fine
- At 100+: extract pipeline to a dedicated service (Cloud Run, ECS, etc.)
  that isn't constrained by serverless timeouts
- On-prem: runs as a Docker container alongside everything else

### Database (standard scaling)
- Supabase free tier: fine for demos and early clients
- Supabase Pro: good to ~50 concurrent clients
- On-prem: standard PostgreSQL in Docker
- Migration path: the app uses Supabase client SDK, which is just
  a Postgres wrapper. Switching to raw Postgres is minimal work.

## Deployment Configurations

### SaaS (current + immediate future)
```yaml
# Vercel environment
CHEMISTRY_SERVICE_URL=https://chemistry-svc.run.app
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANALYSIS_RUN_LIMIT=10
```

### On-Prem (CST scenario)
```yaml
# docker-compose.yml
services:
  web:
    image: greenchemistry-ai:latest
    environment:
      CHEMISTRY_SERVICE_URL: http://chemistry:8000
      LOCAL_LLM_URL: http://qwen:8080
      LLM_MODEL: qwen-3.5-127b
      DATABASE_URL: postgres://gc:password@db:5432/greenchemistry
      ANALYSIS_RUN_LIMIT: -1  # unlimited for on-prem
  chemistry:
    image: gc-chemistry:latest
  qwen:
    image: qwen-3.5-127b:latest
    deploy:
      resources:
        reservations:
          memory: 256G
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
```

### White-Label API (Millipore Sigma DOZN integration)
```yaml
# Just the chemistry service + pipeline as API
services:
  api:
    image: gc-pipeline-api:latest
    environment:
      CHEMISTRY_SERVICE_URL: http://chemistry:8000
      ANTHROPIC_API_KEY: ${CLIENT_API_KEY}  # client's own key
  chemistry:
    image: gc-chemistry:latest
```

## What's Ready Today vs What's Needed

| Component | Status | Needed for 20 clients |
|-----------|--------|----------------------|
| Chemistry microservice | ✅ Built + tested | Containerize, deploy to Cloud Run |
| LLM provider abstraction | ✅ Env var based | Add request queueing |
| Pipeline (Phase 1-5) | ✅ Working on feature branch | Extract from Next.js API routes |
| Database isolation | ⏳ Supabase migration pending | Per-client projects or RLS |
| Auth | ✅ Supabase Auth working | Add org/team model |
| Run quotas | ✅ Count-based, global default | Per-client configurable limits |
| Docker compose for on-prem | ❌ Not started | Write docker-compose + Dockerfiles |
| CI/CD | ❌ Not started | GitHub Actions → staging → prod |
| API-only mode (Type C) | ❌ Not started | Extract pipeline to standalone API |
| Multi-tenant config | ❌ Not started | Tenant config file/table |

## Key Architecture Decision: When to Extract the Pipeline

The pipeline currently lives in `lib/pipeline.ts` as Next.js server code.
This works for SaaS on Vercel but limits on-prem and Type C deployments.

**Extract when:**
- First on-prem client signs (CST)
- First white-label client signs (Millipore Sigma DOZN integration)
- Vercel 300s timeout becomes a bottleneck

**Don't extract yet because:**
- It adds deployment complexity before we have revenue
- The feature branch integration work would be duplicated
- April 2 demo doesn't need it

**Proposed extraction path:**
1. Keep pipeline in Next.js for SaaS
2. Create a FastAPI wrapper around the same pipeline logic for on-prem/API
3. Both call the same chemistry service
4. Shared prompt templates and scoring logic via a common package
