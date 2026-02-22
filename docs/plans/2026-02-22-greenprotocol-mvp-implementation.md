# GreenProtoCol MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a working demo of GreenProtoCol — a Next.js app where scientists paste chemistry protocols and get AI-powered green chemistry recommendations with an Impact Scoreboard.

**Architecture:** Next.js 15 App Router + Tailwind v4 + Supabase Auth (Google + email/password) + Claude Sonnet API. Hardcoded chemical data for 50 common chemicals. Single repo, single deploy.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS v4, @supabase/ssr, @supabase/supabase-js, @anthropic-ai/sdk, npm

**Supabase project:** CrowdTamers Supabase Workspace (ref: `xwcviwzwedljuuyfduso`)
- URL: `https://xwcviwzwedljuuyfduso.supabase.co`
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3Y3Zpd3p3ZWRsanV1eWZkdXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM2MTExMDAsImV4cCI6MjA1OTE4NzEwMH0.p7nzS3bQiitHwtN4Sl3mZjO4z7mSWAqKgyyw209eObs`
- ANTHROPIC_API_KEY is in `~/.zshrc` as env var

**Reference project for patterns:** `/Users/ct-mac-mini/dev/ftracker/family-calorie-tracker` uses the same Supabase + Next.js App Router patterns.

**Design palette:**
- Background: dark mode, near-black (#0A0F0D)
- Primary: deep forest green (#1B4332)
- Accent: warm amber (#F59E0B)
- Success: #22C55E
- Danger: #EF4444
- Text: #F5F5F4 (light on dark)
- Fonts: IBM Plex Mono (chemicals/code), Libre Baskerville (headings), system sans for body

---

## Task 1: Project Scaffold + Dependencies

**Files:**
- Create: `package.json` (via create-next-app)
- Create: `.env.local`
- Create: `.gitignore`
- Create: `CLAUDE.md`

**Step 1: Scaffold Next.js project**

```bash
cd /Users/ct-mac-mini/dev/greenprotocol
npx create-next-app@latest . --typescript --tailwind --eslint --app --src=no --import-alias "@/*" --use-npm
```

Accept defaults. If it asks about overwriting, say yes (only docs/ exists).

**Step 2: Install dependencies**

```bash
cd /Users/ct-mac-mini/dev/greenprotocol
npm install @supabase/ssr @supabase/supabase-js @anthropic-ai/sdk
```

**Step 3: Create .env.local**

```bash
# /Users/ct-mac-mini/dev/greenprotocol/.env.local
NEXT_PUBLIC_SUPABASE_URL=https://xwcviwzwedljuuyfduso.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3Y3Zpd3p3ZWRsanV1eWZkdXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM2MTExMDAsImV4cCI6MjA1OTE4NzEwMH0.p7nzS3bQiitHwtN4Sl3mZjO4z7mSWAqKgyyw209eObs
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

Note: ANTHROPIC_API_KEY is inherited from shell env. The `${ANTHROPIC_API_KEY}` in .env.local tells Next.js to use the shell env var. Actually, Next.js doesn't do shell expansion — just set it directly by reading the value from env, or omit it and let the server-side code read from `process.env.ANTHROPIC_API_KEY` which picks it up from the shell.

Simplest approach: Only put the SUPABASE vars in .env.local. The ANTHROPIC_API_KEY is already in ~/.zshrc and will be available to the Next.js server process automatically.

```
NEXT_PUBLIC_SUPABASE_URL=https://xwcviwzwedljuuyfduso.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3Y3Zpd3p3ZWRsanV1eWZkdXNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM2MTExMDAsImV4cCI6MjA1OTE4NzEwMH0.p7nzS3bQiitHwtN4Sl3mZjO4z7mSWAqKgyyw209eObs
```

**Step 4: Create CLAUDE.md**

```markdown
# GreenProtoCol

AI-powered green chemistry protocol optimizer for LabreNew.org.

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — production build
- `npm run lint` — ESLint

## Stack
Next.js 15 (App Router), TypeScript, Tailwind v4, Supabase Auth, Claude Sonnet API

## Architecture
- `app/` — Next.js App Router pages and API routes
- `lib/` — Utilities (Supabase clients, chemical data, prompts, types)
- `components/` — React components

## Auth
- Supabase Auth (Google OAuth + email/password)
- CrowdTamers Supabase Workspace (ref: xwcviwzwedljuuyfduso)
- All custom tables prefixed `gpc_`
- Protected routes: `/analyze`
- Public routes: `/`, `/login`

## Env Vars
- `NEXT_PUBLIC_SUPABASE_URL` — in .env.local
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — in .env.local
- `ANTHROPIC_API_KEY` — from shell env (~/.zshrc)

## Design
- Dark mode default
- Palette: forest green (#1B4332), amber (#F59E0B)
- Fonts: IBM Plex Mono (chemicals), Libre Baskerville (headings)
```

**Step 5: Add Google Fonts to layout**

In `app/layout.tsx`, import IBM Plex Mono and Libre Baskerville from `next/font/google`. Set CSS variables `--font-mono` and `--font-serif`.

**Step 6: Configure Tailwind for dark mode + custom colors**

In `app/globals.css` (Tailwind v4 uses CSS-based config with `@theme`):

```css
@import "tailwindcss";

@theme {
  --color-forest-50: #f0fdf4;
  --color-forest-100: #dcfce7;
  --color-forest-200: #bbf7d0;
  --color-forest-300: #86efac;
  --color-forest-400: #4ade80;
  --color-forest-500: #22c55e;
  --color-forest-600: #16a34a;
  --color-forest-700: #15803d;
  --color-forest-800: #1B4332;
  --color-forest-900: #14532d;
  --color-forest-950: #0A0F0D;
  --color-amber-400: #FBBF24;
  --color-amber-500: #F59E0B;
  --color-amber-600: #D97706;
  --font-family-mono: 'IBM Plex Mono', monospace;
  --font-family-serif: 'Libre Baskerville', serif;
}
```

**Step 7: Verify dev server starts**

```bash
cd /Users/ct-mac-mini/dev/greenprotocol && npm run dev
```

Visit http://localhost:3000, confirm it loads.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with Supabase + Anthropic deps"
```

---

## Task 2: Supabase Auth Setup

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/middleware.ts`
- Create: `middleware.ts`
- Create: `app/login/page.tsx`
- Create: `app/auth/callback/route.ts`

**Step 1: Create browser Supabase client**

Copy pattern from ftracker (`/Users/ct-mac-mini/dev/ftracker/family-calorie-tracker/lib/supabase/client.ts`):

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**Step 2: Create server Supabase client**

Copy pattern from ftracker (`/Users/ct-mac-mini/dev/ftracker/family-calorie-tracker/lib/supabase/server.ts`):

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
```

**Step 3: Create middleware helper**

Copy pattern from ftracker (`/Users/ct-mac-mini/dev/ftracker/family-calorie-tracker/lib/supabase/middleware.ts`) but adapt the redirect logic:
- Public routes: `/`, `/login`, `/auth`
- Protected routes: everything else (especially `/analyze`)

```typescript
// lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Only protect /analyze routes — landing and login are public
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/analyze')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

**Step 4: Create root middleware**

```typescript
// middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

**Step 5: Create OAuth callback route**

```typescript
// app/auth/callback/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/analyze'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
```

**Step 6: Create login page**

```typescript
// app/login/page.tsx
'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
```

Login page with:
- Google OAuth button (calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${origin}/auth/callback` } })`)
- Email + password form with sign-in / sign-up toggle
- Error display
- Styled with forest green / amber palette, dark background
- Redirect to `/analyze` on success

**Step 7: Verify auth flow works**

```bash
npm run dev
```

Visit `/login`, confirm Google button and email form render. Test email signup (will need to confirm Google OAuth is enabled in Supabase dashboard for Google login to work — note this for user).

**Step 8: Commit**

```bash
git add lib/supabase/ middleware.ts app/login/ app/auth/
git commit -m "feat: add Supabase auth with Google OAuth + email/password"
```

---

## Task 3: TypeScript Types + Chemical Data Layer

**Files:**
- Create: `lib/types.ts`
- Create: `lib/chemicals.ts`
- Create: `lib/equivalencies.ts`

**Step 1: Define TypeScript interfaces**

`lib/types.ts` — All shared types for the app:

```typescript
export interface ChemicalData {
  cas: string
  name: string
  synonyms: string[]
  molecularWeight: number
  densityKgPerL: number
  co2ePerKg: number
  waterPerKg: number
  energyPerKg: number
  ghsHazards: string[]
  isSuspectedCarcinogen: boolean
  isHazardousWaste: boolean
  chem21Class: 'recommended' | 'problematic' | 'hazardous' | 'highly_hazardous'
  greenAlternatives: GreenAlternative[]
  dataSource: string
}

export interface GreenAlternative {
  chemical: string
  context: string
  yieldImpact: string
  source: string
}

export interface AnalysisStep {
  stepNumber: number
  description: string
  chemicals: ParsedChemical[]
  conditions: {
    temperature: string | null
    duration: string | null
    atmosphere: string | null
  }
}

export interface ParsedChemical {
  name: string
  role: string
  quantity: string
  quantityMl: number | null
  quantityKg: number | null
}

export interface Recommendation {
  stepNumber: number
  principleNumbers: number[]
  principleNames: string[]
  severity: 'high' | 'medium' | 'low'
  original: {
    chemical: string
    issue: string
  }
  alternative: {
    chemical: string
    rationale: string
    yieldImpact: string
    caveats: string
    evidenceBasis: string
  }
  confidenceLevel: 'high' | 'medium' | 'low'
}

export interface AnalysisResult {
  protocolTitle: string
  chemistrySubdomain: string
  steps: AnalysisStep[]
  recommendations: Recommendation[]
  revisedProtocol: string
  overallAssessment: {
    greenPrinciplesViolated: number[]
    mostImpactfulChange: string
    experimentalValidationNeeded: boolean
    disclaimer: string
  }
}

export interface ImpactDelta {
  co2eSavedKg: number
  hazardousWasteEliminatedKg: number
  carcinogensEliminated: string[]
  waterSavedL: number
  energySavedKwh: number
}

export interface Equivalency {
  icon: string
  value: string
  description: string
}
```

**Step 2: Build chemicals database**

`lib/chemicals.ts` — Hardcode the 50 most common lab chemicals with real data from published LCA literature and CHEM21 solvent guide. Priority solvents per the PRD:

- Dichloromethane, chloroform, hexane, toluene, THF, DMF, ethyl acetate, 2-MeTHF, ethanol, methanol, acetone, water, DMSO, acetonitrile, diethyl ether, CPME, iso-propanol
- Plus common reagents: HCl, H2SO4, NaOH, KOH, NaBH4, etc.
- Plus catalysts: Pd(PPh3)4, Pd/C, CuI, FeCl3

Include a `findChemical(name: string): ChemicalData | undefined` lookup function that matches against name and synonyms (case-insensitive).

**Step 3: Build equivalencies calculator**

`lib/equivalencies.ts` — EPA conversion factors and a function that takes an `ImpactDelta` and returns an array of `Equivalency` objects with smart scale matching:

- Small CO2e (1-10 kg): driving miles, gasoline gallons
- Medium (10-100 kg): tree seedlings, smartphone charges
- Large (100+ kg): flights, homes powered, cars off road

Conversion factors from EPA GHG Equivalencies Calculator:
- 1 metric ton CO2e = 2,480 miles driven
- 1 metric ton = 112 gallons gasoline
- 1 metric ton = 45.5 tree seedlings grown 10 years
- 1 metric ton = 122,000 smartphones charged
- 1 metric ton = 1.4 months of home energy
- 1 metric ton = 1.1 one-way flights NYC-LA

**Step 4: Commit**

```bash
git add lib/types.ts lib/chemicals.ts lib/equivalencies.ts
git commit -m "feat: add TypeScript types, 50-chemical database, and EPA equivalency calculator"
```

---

## Task 4: Claude API Prompt + Analysis Route

**Files:**
- Create: `lib/prompts.ts`
- Create: `app/api/analyze/route.ts`

**Step 1: Write the system prompt**

`lib/prompts.ts` — The structured system prompt from the Afternoon Sprint PRD. Instructs Claude to return structured JSON with parsed chemicals, recommendations, revised protocol, and overall assessment.

Key rules in the prompt:
- Return ONLY valid JSON, no markdown fences
- Be conservative — only recommend confident alternatives
- Always flag experimental validation needed
- Don't hallucinate citations — say "published studies" if unsure
- Focus on highest-impact changes
- If protocol is already green, say so

**Step 2: Build the API route**

`app/api/analyze/route.ts`:

1. Validate auth (get user from Supabase server client)
2. Parse request body for `protocolText`
3. Call Claude Sonnet API with system prompt + user protocol
4. Parse Claude's JSON response
5. Enrich with hardcoded chemical data (look up each chemical, add CO2e, hazards, CHEM21 class)
6. Calculate impact delta (sum original chemicals' impact vs recommended alternatives' impact)
7. Generate equivalencies
8. Return enriched result

Use `@anthropic-ai/sdk` directly (not Vercel AI SDK). Model: `claude-sonnet-4-5-20250929`.

Error handling:
- Non-chemistry text: Claude should return an error indicator; API route returns 400
- Claude API failure: return 500 with message
- Auth failure: return 401

**Step 3: Verify endpoint works**

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"protocolText": "Dissolve 5g crude product in 50mL dichloromethane..."}'
```

(This will fail with 401 since no auth cookie — that's expected. Test with browser after login works.)

**Step 4: Commit**

```bash
git add lib/prompts.ts app/api/analyze/
git commit -m "feat: add Claude-powered protocol analysis API route"
```

---

## Task 5: Landing Page + Protocol Input

**Files:**
- Modify: `app/page.tsx`
- Create: `components/ProtocolInput.tsx`
- Create: `components/UserMenu.tsx`

**Step 1: Build the landing page**

`app/page.tsx` — Public landing page with:
- Hero section: "GreenProtoCol" title (Libre Baskerville), tagline "AI-Powered Green Chemistry Protocol Optimizer", brief description
- The 12 principles listed as a visual grid of cards (compact)
- "Analyze Your Protocol" CTA button
- If user is logged in, show UserMenu in top-right
- Dark mode, forest green palette

**Step 2: Build ProtocolInput component**

`components/ProtocolInput.tsx` — Client component with:
- Large textarea with placeholder text
- 3 example protocol buttons (from PRD: organic extraction, Suzuki coupling, titration)
- Clicking an example fills the textarea
- "Analyze Protocol" submit button (amber accent color)
- Loading state with spinner/skeleton
- On submit: POST to `/api/analyze`, then redirect to `/analyze` with results in state (or URL params / searchParams)

**Strategy for passing analysis results to /analyze page:** Use client-side state. The ProtocolInput component lives on the landing page. On submit, store the result in sessionStorage, then router.push('/analyze'). The analyze page reads from sessionStorage. Simple, no server-side complexity.

**Step 3: Build UserMenu component**

`components/UserMenu.tsx` — Client component:
- If logged in: show user avatar/email + "Sign Out" button
- If not logged in: show "Sign In" link
- Uses `@/lib/supabase/client` to get user and sign out

**Step 4: Verify landing page renders**

```bash
npm run dev
```

Visit http://localhost:3000, confirm landing page looks good, example buttons fill textarea.

**Step 5: Commit**

```bash
git add app/page.tsx components/ProtocolInput.tsx components/UserMenu.tsx
git commit -m "feat: add landing page with protocol input and example protocols"
```

---

## Task 6: Results Page + Impact Scoreboard

**Files:**
- Create: `app/analyze/page.tsx`
- Create: `components/AnalysisResults.tsx`
- Create: `components/ImpactScoreboard.tsx`
- Create: `components/ImpactCard.tsx`
- Create: `components/PrincipleTag.tsx`
- Create: `components/EquivalencyStory.tsx`
- Create: `components/ScaleUpProjection.tsx`

**Step 1: Build the analyze page**

`app/analyze/page.tsx` — Protected page (middleware handles redirect). Reads analysis result from sessionStorage. If no result, redirect to `/`. Renders three sections:

**Section A: Protocol Analysis (AnalysisResults component)**
- Side-by-side: original protocol text vs revised protocol
- Each recommendation shown as a card with PrincipleTag badges
- Severity color coding (red/amber/green)
- Confidence indicators

**Section B: Impact Scoreboard (ImpactScoreboard component)**
- CSS-only horizontal bar charts comparing original vs green for:
  - Carbon footprint (kg CO2e)
  - Hazardous waste (kg)
  - Toxicity risk level
  - Energy use (kWh)
- Bars animate on load (CSS transition on width)
- Below charts: EquivalencyStory cards with large bold numbers

**Section C: Scale It Up (ScaleUpProjection component)**
- "Runs per year" input slider (default 100, range 1-1000)
- "Labs worldwide" input slider (default 100, range 1-10000)
- Live-updating annual and global impact numbers
- EPA equivalencies that update as sliders change

**Step 2: Build ImpactCard component**

Simple card with icon, large number, unit, and description. Color-coded by category.

**Step 3: Build PrincipleTag component**

Small badge showing principle number + short name. Color coded:
- Principles 1-4: shades of green (prevention, efficiency)
- Principles 5-8: shades of blue (materials)
- Principles 9-12: shades of purple (design)

**Step 4: Build EquivalencyStory component**

Large format card: emoji icon + bold equivalency value + description sentence. E.g.: "🚗 3.5 miles — equivalent driving distance saved per run"

**Step 5: Build ScaleUpProjection component**

Client component with two range inputs (sliders). On change, recalculates: `perRunSavings * runsPerYear` and `perRunSavings * runsPerYear * labsWorldwide`. Renders updated equivalencies using the equivalencies calculator.

**Step 6: Verify full flow**

```bash
npm run dev
```

1. Visit `/`, paste example protocol, click Analyze
2. Login if prompted
3. See results page with scoreboard
4. Test sliders
5. Test all 3 example protocols

**Step 7: Commit**

```bash
git add app/analyze/ components/
git commit -m "feat: add results page with Impact Scoreboard and Scale It Up projections"
```

---

## Task 7: Polish, Error States, Mobile

**Files:**
- Modify: `app/page.tsx` — add footer
- Modify: `app/layout.tsx` — add meta tags
- Modify: `components/ProtocolInput.tsx` — error handling
- Modify: `components/AnalysisResults.tsx` — loading skeleton

**Step 1: Add error handling**

- If Claude returns non-chemistry text error: show "This doesn't look like a chemistry protocol. Try one of our examples!" with a link back
- If API call fails: show error message with retry button
- If analysis has no recommendations: show "This protocol is already quite green!" message

**Step 2: Add loading skeleton**

While waiting for Claude API response (~5-15 seconds), show:
- Animated skeleton bars where the scoreboard will be
- Pulsing placeholder text where the protocol comparison will be
- A "Analyzing your protocol against the 12 Principles of Green Chemistry..." message

**Step 3: Add footer**

LabreNew.org credit, disclaimer about experimental validation, link to the 12 Principles.

**Step 4: Add meta tags**

In `app/layout.tsx`:
- Title: "GreenProtoCol — AI-Powered Green Chemistry Protocol Optimizer"
- Description for social sharing
- Open Graph tags

**Step 5: Mobile responsive**

- Stack side-by-side protocol comparison vertically on mobile
- Full-width bar charts
- Readable slider controls
- Stacked impact cards

**Step 6: Test all 3 example protocols end-to-end**

Verify each produces reasonable results, scoreboard renders, sliders work.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add error states, loading skeletons, mobile layout, and meta tags"
```

---

## Task 8: Database Table for Saved Analyses

**Files:**
- Create: SQL migration for `gpc_analyses` table
- Modify: `app/api/analyze/route.ts` — save to DB after analysis

**Step 1: Create the gpc_analyses table**

Run via Supabase CLI or dashboard:

```sql
CREATE TABLE gpc_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  protocol_text TEXT NOT NULL,
  analysis_result JSONB NOT NULL,
  impact_delta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE gpc_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
  ON gpc_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON gpc_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Index
CREATE INDEX idx_gpc_analyses_user_id ON gpc_analyses(user_id);
CREATE INDEX idx_gpc_analyses_created_at ON gpc_analyses(created_at DESC);
```

**Step 2: Update API route to save analysis**

After successfully getting Claude's response and enriching it, insert into `gpc_analyses`:

```typescript
await supabase.from('gpc_analyses').insert({
  user_id: user.id,
  protocol_text: protocolText,
  analysis_result: enrichedResult,
  impact_delta: impactDelta,
})
```

**Step 3: Verify save works**

Run an analysis, then check the table:

```bash
supabase db query "SELECT id, created_at FROM gpc_analyses LIMIT 5" --project-ref xwcviwzwedljuuyfduso
```

**Step 4: Commit**

```bash
git add app/api/analyze/ supabase/
git commit -m "feat: save analyses to gpc_analyses table with RLS"
```

---

## Notes for Implementer

- **Google OAuth**: Must be enabled in the Supabase dashboard (Authentication > Providers > Google). The user may need to set this up with Google Cloud Console credentials. Flag this if it's not already configured.
- **ANTHROPIC_API_KEY**: Available from shell env (`~/.zshrc`). The Next.js dev server inherits it automatically. For production deploy, it must be set as an env var in the hosting platform.
- **Claude model**: Use `claude-sonnet-4-5-20250929`. If that model ID doesn't work, fall back to `claude-sonnet-4-5-20250514`.
- **Rate limiting**: No rate limiting in MVP. If abuse is a concern, add later.
- **The 50 chemicals**: The CO2e values are approximate from published LCA literature. Mark each with a `dataSource` field. Exact values matter less than the right order of magnitude for a demo.
- **sessionStorage for results**: This means refreshing the analyze page loses the result. Acceptable for MVP. The DB save means users can retrieve past analyses later (not built in MVP but data is there).
