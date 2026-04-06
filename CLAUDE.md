# GreenChemistry.ai

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

## Backlog Convention

When adding items to BACKLOG.md, always include:
- Clear description of what's wrong or what's needed
- `[done-when::...]` with specific, verifiable acceptance criteria
- `[priority::low|medium|high]` if not medium
- `[needs-ui::true]` if it involves visible UI changes
- `[due::YYYY-MM-DD]` if there's a deadline

Example:
- [ ] Scoring results don't render on mobile [added::2026-04-06] [done-when::Scoring table fully visible on 375px viewport, no horizontal scroll] [needs-ui::true] [priority::medium]
