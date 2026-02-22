# GreenProtoCol MVP — Design Document

## Date: 2026-02-22

## Overview

GreenProtoCol is an AI-powered tool for LabreNew.org that analyzes chemistry protocols against the 12 Principles of Green Chemistry, proposes evidence-backed alternatives, and quantifies environmental impact with visceral EPA equivalencies.

This MVP is the "Wizard of Oz" version: real frontend and UX, Claude API + hardcoded chemical data for the backend intelligence. The vector DB and paper ingestion pipeline come later.

## Architecture

Single Next.js 15 repo (App Router), Tailwind CSS, Supabase Auth. No external DB beyond Supabase.

```
greenprotocol/
├── app/
│   ├── page.tsx                  ← Landing (public)
│   ├── login/
│   │   └── page.tsx              ← Login/signup (Google + email/pw)
│   ├── auth/callback/
│   │   └── route.ts              ← OAuth callback handler
│   ├── analyze/
│   │   └── page.tsx              ← Results + Impact Scoreboard (protected)
│   └── api/analyze/
│       └── route.ts              ← Claude API call + enrichment (protected)
├── lib/
│   ├── supabase/
│   │   ├── client.ts             ← Browser Supabase client
│   │   ├── server.ts             ← Server Supabase client
│   │   └── middleware.ts         ← Session refresh logic
│   ├── chemicals.ts              ← 50 chemicals with real impact data
│   ├── equivalencies.ts          ← EPA conversion factors
│   ├── prompts.ts                ← System prompt for Claude
│   └── types.ts                  ← TypeScript interfaces
├── components/
│   ├── AuthForm.tsx              ← Login/signup form
│   ├── UserMenu.tsx              ← User avatar + logout
│   ├── ProtocolInput.tsx         ← Textarea + example protocols
│   ├── AnalysisResults.tsx       ← Original vs revised protocol
│   ├── ImpactScoreboard.tsx      ← Bar chart comparisons
│   ├── ImpactCard.tsx            ← Single metric card
│   ├── PrincipleTag.tsx          ← Color-coded principle badge
│   ├── EquivalencyStory.tsx      ← "= driving X miles" narratives
│   └── ScaleUpProjection.tsx     ← Interactive slider for annual impact
├── middleware.ts                  ← Protect /analyze routes
└── .env.local                     ← API keys
```

## Auth

- **Provider:** Supabase Auth on existing CrowdTamers Supabase Workspace (ref: xwcviwzwedljuuyfduso)
- **Methods:** Google OAuth + email/password
- **Table prefix:** `gpc_` on all custom tables
- **Packages:** `@supabase/supabase-js`, `@supabase/ssr`
- **Flow:** Landing is public. "Analyze Protocol" requires login. After auth, redirect to analysis.
- **DB table:** `gpc_analyses` to store analysis results per user

## Data Flow

1. User pastes protocol text, clicks "Analyze Protocol"
2. If not authenticated, redirect to `/login`
3. POST to `/api/analyze` with protocol text + auth session
4. API route sends protocol to Claude Sonnet with structured system prompt, gets JSON back
5. API enriches Claude's output with hardcoded chemical impact data (CO2e, GHS hazards, CHEM21 class)
6. Calculates impact delta (original vs recommended) and EPA equivalencies
7. Stores analysis in `gpc_analyses`
8. Frontend renders: protocol comparison, Impact Scoreboard, equivalency stories, scale-up slider

## Design Direction

Scientific-meets-editorial. Dark mode default.
- Palette: deep forest green (#1B4332) + warm amber (#F59E0B)
- Typography: IBM Plex Mono for chemicals/code, Libre Baskerville for headings
- Bar charts: CSS-only, animated on load
- Color coding: green for savings, amber for warnings, red for hazards

## Chemical Data Layer

50 hardcoded chemicals covering ~80% of common lab use. Each includes:
- CAS number, molecular weight, density
- CO2e per kg (from published LCA literature)
- Water and energy consumption per kg
- GHS hazard codes
- CHEM21 solvent classification
- Known green alternatives with context and yield impact

## EPA Equivalency Engine

Translates raw CO2e/waste/water numbers into visceral comparisons using EPA published conversion factors. Smart scale matching: driving distances for small numbers, homes powered for large numbers.

## Example Protocols (3 pre-loaded)

1. Organic extraction with DCM (high impact substitution)
2. Suzuki cross-coupling with Pd catalyst + DMF (multiple recommendations)
3. Simple acid-base titration (should come back "mostly green")

## Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS v4
- Supabase Auth + PostgreSQL
- Claude Sonnet API (via @anthropic-ai/sdk)
- npm
- TypeScript

## What MVP Does NOT Include

- PDF upload (text paste only)
- Vector DB / paper ingestion pipeline
- Full 12-skill parallel analysis (one Claude prompt for now)
- Specific paper citations (evidence categories only)
- The 2,000-chemical database (50 is enough)
