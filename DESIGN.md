# GreenChemistry.ai — Design System

A scientific tool that feels like a trusted lab partner: warm, precise, unhurried. Never clinical or generic SaaS. The visual language borrows from field notebooks, botanical illustration, and academic publishing — then lifts it with gold.

---

## Color Tokens

| Token | Hex | Use |
|---|---|---|
| `--color-forest` | `#1C3822` | Primary dark; header/footer backgrounds, dark section fills |
| `--color-near-black` | `#0D1F16` | Deepest backgrounds; dark mode body background |
| `--color-mid-forest` | `#2D4A3A` | Secondary text on dark; dividers; card borders |
| `--color-gold` | `#ECB815` | Primary accent; section labels, callout borders, progress indicators |
| `--color-sage` | `#A8C5A2` | Secondary text on dark backgrounds |
| `--color-cream` | `#F6F3EB` | Light section background; the page ground |
| `--color-bone` | `#F5F0E8` | Slightly warmer cream; card backgrounds on cream |
| `--color-text-dark` | `#1C1917` | Body text on light backgrounds |
| `--color-text-mid` | `#78716C` | Secondary/muted text on light |
| `--color-text-light` | `#F6F3EB` | Body text on dark backgrounds |

### Semantic color pairs

- **Header / Footer**: background `#1C3822`, text `#F6F3EB`, accent `#ECB815`, secondary `#A8C5A2`
- **Light sections**: background `#F6F3EB`, text `#1C1917`, labels `#ECB815`
- **Cards on cream**: background `#FAFAF8`, border `#D6D0C4`
- **Danger / original**: background `#FEF2F2`, text `#DC2626`
- **Success / alternative**: background `#F0FDF4`, text `#16a34a`
- **Warning / medium severity**: background `#FEF3C7`, text `#D97706`

### Principle tag colors (Green Chemistry 12 Principles)

- Principles 1–4 (prevention/efficiency): bg `#DCFCE7`, text green shades
- Principles 5–8 (materials): bg `#DBEAFE`, text blue shades
- Principles 9–12 (design): bg `#EDE9FE`, text purple shades

---

## Typography

### Fonts

| Role | Family | Weights |
|---|---|---|
| Display / Headings | `Libre Baskerville` (serif) | 700 |
| Body | `Libre Baskerville` (serif) | 400, 400i |
| Labels / Mono / Chemical names | `IBM Plex Mono` (monospace) | 400, 700 |

**Rule**: Chemical names, protocol steps, code, and section labels always use IBM Plex Mono. Prose, headings, and marketing copy use Libre Baskerville.

### Type scale

| Name | Size | Line-height | Weight | Font | Use |
|---|---|---|---|---|---|
| Display | 32–40px | 1.15 | 700 | Baskerville | Hero headlines |
| Heading 1 | 22–28px | 1.35 | 700 | Baskerville | Section titles, protocol titles |
| Heading 2 | 18px | 1.4 | 700 | Baskerville | Card headers, sub-sections |
| Body | 13–14px | 1.65 | 400 | Baskerville | All prose |
| Body italic | 13px | 1.65 | 400i | Baskerville | Caveats, disclaimers |
| Label | 10px | 1.2 | 700 | IBM Plex Mono | Section overlines (UPPERCASE, ls 0.2em) |
| Mono body | 13px | 1.6 | 400 | IBM Plex Mono | Chemical names, protocol text |
| Mono small | 11px | 1.5 | 400 | IBM Plex Mono | Tags, badges, metadata |
| Caption | 10–11px | 1.4 | 400 | IBM Plex Mono | Footer text, timestamps |

### Label pattern

Section overlines always: `IBM Plex Mono`, `10px`, `700`, `UPPERCASE`, `letter-spacing: 0.2em`, color `#ECB815`.

```
THE PROBLEM
WHAT IT DOES
HOW IT WORKS
REAL EXAMPLE OUTPUT
```

---

## Logo

The logo is assembled from two separate files at runtime — do not use the combined logo-wide files.

| Part | File | Notes |
|---|---|---|
| Logomark (`:=` equivalency symbol) | `public/logomark-light.svg` / `public/logomark-dark.svg` | Green circle with gold molecular elements. Fix SVG dimensions before use: `width="616" height="661"` |
| Wordmark (custom lettering) | `public/wordmark-light.svg` | Aspect ratio 3974:567. Fix: `width="3974" height="567"` |

**Assembly**: render logomark at 28–36px height, wordmark at 18–22px height, gap 8–10px, flex row, align center.

Both SVGs export with `width="100%"` from the source tool — always patch to explicit pixel dimensions before embedding in any context that needs intrinsic sizing.

---

## Spacing & Layout

- **Page margins**: 64px horizontal (print/document), 24–32px (mobile)
- **Section vertical padding**: 24–36px top, 20–28px bottom
- **Card padding**: 16px (compact), 20px (standard)
- **Gap between cards**: 12–16px
- **Max content width**: 680px for prose columns; full-bleed for dark header/footer bands

---

## Component Patterns

### Section structure

Every content section: gold label (UPPERCASE mono) → headline or body → content. Labels always appear above, never beside the heading.

### Dark band (header / footer)

Full-width, forest green (`#1C3822`), horizontal padding 64px, vertical padding 20–36px. Logo left, metadata/nav right. Gold rule line (2px, `#ECB815`) as accent divider.

### Recommendation card

Two-column inside: red panel (original chemical + issue) left, green panel (alternative + rationale) right. Severity badge (high/medium/low), principle tags, accept/decline controls. On acceptance: green ring + shadow.

### Principle tag

Pill badge: `rounded-full`, `px-2 py-0.5`, `text-xs`, `font-medium`. Color by principle group (see color tokens above). Format: `#N Name`.

### Severity badge

`rounded`, `px-2 py-0.5`, `text-xs`, `font-semibold`, `UPPERCASE`. Colors: high = red, medium = amber, low = green.

### Protocol text

Always `IBM Plex Mono`, `13px`, `whitespace-pre-wrap`, `leading-relaxed`. Original protocol on red-tinted background, revised protocol on green-tinted background.

### Callout / example output block

Left border `3px solid #ECB815`, background `#F6F3EB` or `#FAFAF8`, padding `16px 20px`. Headline summary in mono bold, bullet lines in mono regular, smaller size.

### Cards on cream

Background `#FAFAF8`, border `1px solid #D6D0C4`, border-radius `8px`, padding `16–20px`.

---

## Dark / Light Mode

The app defaults to **dark mode** (near-black background `#0D1F16`, forest green accents). The landing page and documents use a **light mode** (cream background `#F6F3EB`). Do not mix — each surface is fully one or the other.

---

## Tone & Voice (design implications)

- **Precise, not verbose**: labels and badges over long explanations
- **Cite everything**: evidence basis always shown alongside recommendations
- **Warm, not sterile**: cream and forest green over white and gray
- **Scientific credibility**: monospace for all chemical names, no exceptions
- **Confidence with caveats**: strong recommendations paired with yield impact and caveats

---

## Assets

| Asset | Path |
|---|---|
| Logomark light | `public/logomark-light.svg` |
| Logomark dark | `public/logomark-dark.svg` |
| Wordmark light | `public/wordmark-light.svg` |
| Logo wide light | `public/logo-wide-light.svg` |
| Logo wide dark | `public/logo-wide-dark.svg` |
| Favicon | `public/file.svg` |
