# GreenChemistry.ai

AI-powered green chemistry protocol optimizer for LabreNew.org.

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — production build
- `npm run lint` — ESLint

## Branches & Deploy
- **`main`** — integration/source of truth. All local work + Lovable's external pushes land here. Push freely: `git push origin main`.
- **`production`** — the deploy branch. Vercel (project `greenchemistryai`) deploys to greenchemistry.ai **only** from `production`. Code on `main` is NOT live until promoted.
- **Promote to production:** `git push origin main:production` (fast-forward `production` to `main`'s tip → triggers Vercel autodeploy). Then verify: `vercel ls greenchemistryai --prod`.
- Keep `main` == `origin/main` == `origin/production` after each deploy. Do **not** keep a local `production` branch — it goes stale and is a footgun; deploy by pushing `main:production`, not by checking production out.
- Note: `git fetch` updates `origin/*` tracking refs but never moves local branch pointers — a local `production` will silently drift behind `origin/production` even on a single machine.

## Stack
Next.js 15 (App Router), TypeScript, Tailwind v4, Supabase Auth, Claude Sonnet API

## Architecture
- `app/` — Next.js App Router pages and API routes
- `lib/` — Utilities (Supabase clients, chemical data, prompts, types)
- `components/` — React components

## Auth
- Supabase Auth (Google OAuth + email/password)
- GreenChemistry.ai production Supabase project (ref: jjxvlofcnyiqrtvwccsq)
- All custom tables prefixed `gpc_`
- Protected routes: `/analyze`
- Public routes: `/`, `/login`

## Env Vars
- `NEXT_PUBLIC_SUPABASE_URL` — in .env.local
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — in .env.local
- `ANTHROPIC_API_KEY` — from shell env (~/.zshrc)

## Design
- Dark mode default
- Palette: forest green (#1C3822), gold (#ECB815)
- Fonts: IBM Plex Mono (chemicals), Libre Baskerville (headings)

## Backlog Convention

When adding items to BACKLOG.md, always include:
- Clear description of what's wrong or what's needed
- `[done-when::...]` with specific, verifiable acceptance criteria
- `[priority::low|medium|high]` if not medium
- `[needs-ui::true]` if it involves visible UI changes
- `[due::YYYY-MM-DD]` if there's a deadline

Example:
- [ ] Scoring results don't render on mobile [added::2026-04-06] [done-when::Scoring table fully visible on 375px viewport, no horizontal scroll] [needs-ui::true] [priority::medium]
