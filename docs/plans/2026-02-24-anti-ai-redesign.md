# Anti-AI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign GreenChemistry.ai to eliminate AI design tells per the "Quit Designing Like AI" styleguide.

**Architecture:** Light cream background for public pages, dark kept for analysis results. Oversized typography as structural design. Horizontal scroll principles strip. Burgundy replaces amber as secondary accent.

**Tech Stack:** Next.js, Tailwind v4, CSS scroll-linked animations

---

## Color Palette

| Role | Old | New |
|------|-----|-----|
| Background (light pages) | `#0A0F0D` | `#FAF8F3` (cream) |
| Background (dark pages) | `#0A0F0D` | `#1B2A22` (forest dark) |
| Text primary | `#F5F5F4` | `#1C1917` |
| Text muted | `#a3a3a3` | `#57534E` |
| Text subtle | `#737373` | `#78716C` |
| Accent secondary | `#F59E0B` (amber) | `#7C2D36` (burgundy) |
| Accent primary | `#22C55E` | `#1B4332` (dark forest on light bg) |
| Info/highlight | `#86efac` | `#2D6A4F` (on light), keep on dark |
| Input bg | `#14532d` | `#F5F0E8` (warm cream) |
| Card bg | `#14532d20` | `#F0EBE1` |
| Card border | `border-forest-700` | `#D6D0C4` |

## Pages

**Light pages:** `/` (home), `/login`, `/dashboard`, `/u/[username]`
**Dark pages:** `/analyze`, `/analyze/[id]`

## Tasks

### Task 1: globals.css + layout.tsx
Update CSS variables, add light/dark page support, remove `dark` class.

### Task 2: app/page.tsx — Landing page revolution
- Massive single-color headline in Libre Baskerville
- ".ai" as small mono tag
- Horizontal scroll principles with oversized numbers
- Scroll-linked background color (cream → sage → cream)
- Staggered fade-in reveals

### Task 3: components/ProtocolInput.tsx — Light theme
Restyle textarea, buttons, progress bar for cream background.

### Task 4: components/UserMenu.tsx — Light theme
Dark text, burgundy accents.

### Task 5: app/login/page.tsx — Light theme
Cream bg, burgundy CTA, warm input fields.

### Task 6: app/dashboard/page.tsx + AnalysisCard.tsx + UsernameSetup.tsx — Light theme
Dashboard chrome, cards, profile setup all on cream.

### Task 7: app/u/[username]/page.tsx — Light public profile
Cream bg, oversized stat numbers, burgundy accents.

### Task 8: Dark pages stay dark (analyze, analyze/[id])
Minor tweaks: burgundy replaces amber for assessment headers. Keep dark bg.

### Task 9: Build verification
`npm run build` must pass.
