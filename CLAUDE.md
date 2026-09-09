# GreenChemistry.ai

AI-powered green chemistry protocol optimizer for LabreNew.org.

## Commands
- `npm run dev` — dev server (port 3000)
- `npm run build` — production build
- `npm run lint` — ESLint

## Branches & Deploy
- **`main`** — integration/source of truth. Changes land through reviewed PRs and are validated by CI. It is not production.
- **`production`** — protected release branch. Vercel (project `greenchemistryai`) deploys greenchemistry.ai only after an approved `main` → `production` PR merges.
- **Never push, force-push, or refspec-push to `production`.** Do not use `git push origin main:production` or deploy from a local worktree.
- A release candidate PR runs the staging image, chemistry sentinel, and deployed web smoke. It must pass all required checks, receive PR approval, then receive explicit GitHub Production Environment approval.
- Production deploys only the immutable, staging-validated image digest for the approved commit. Read back Vercel alias, Cloud Run revision/traffic, and sentinel evidence after each release.
- Roll back with a revert PR to `production`, not a force push. See `docs/runbooks/release-rollback.md`.

## Stack
Next.js 16 (App Router), TypeScript, Tailwind v4, Supabase Auth, OpenRouter-compatible chemistry-provider routing

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
