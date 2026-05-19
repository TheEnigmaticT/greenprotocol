# Frontend patterns

## Landing page responsive grid
- The landing page uses a local 12-column helper in `app/page.tsx` via the `.g`, `.c*`, and `.cs*` classes.
- The grid container should set `width: 100%`, `box-sizing: border-box`, and `.g > * { min-width: 0; }` so mobile tracks can actually shrink.
- At `max-width: 900px`, mobile full-width columns should use `grid-column: 1 / -1`, not `span 12`, because elements that also carry `grid-column-start` helper classes can otherwise collapse to a sliver.
- Any section-specific desktop grid inside the landing page should expose its own responsive class instead of hard-coding `gridTemplateColumns` inline, so mobile overrides can live in the same breakpoint block.

## Mobile-safe nested grids
- For desktop card matrices, define a named class with `minmax(0, 1fr)` columns.
- Example: `.principles-grid` uses 4 columns on desktop and 2 columns on mobile.
- Avoid inline `gridTemplateColumns` when a section needs a mobile-specific layout.

## Mobile-safe flex rows with long strings
- Any flex item that contains a long unbroken string (URLs, emails, slugs) must set `min-width: 0` on the flex child.
- Truncate the text with `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap` when the row is decorative or non-editable.
- Current example: the showcase browser URL bar on the homepage.

## Mobile-safe grid items with rich text
- Grid items containing large floated elements or long rich-text blocks can expand the grid via min-content sizing.
- If a section uses a decorative float like a drop cap, make it a named class and disable or simplify the float on mobile.
- Current example: `.stack-dropcap` floats on desktop but becomes a normal block on mobile.

## Explicit mobile layouts for mixed-content feature sections
- Sections that combine display typography, stats, and CTA blocks should not rely solely on generic column-collapse rules.
- Give the stat card / CTA column its own named wrapper and mobile-specific styles for width, padding, and internal layout.
- Current examples: `.stack-facts-col`, `.stack-energy-chip`, `.stack-energy-row`, `.contact-cta-col`, and `.contact-cta-link`.
