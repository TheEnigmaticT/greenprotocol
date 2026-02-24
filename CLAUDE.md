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
