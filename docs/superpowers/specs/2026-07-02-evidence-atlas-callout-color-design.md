# Evidence Atlas Callout Color Design

**Date:** 2026-07-02
**Status:** Approved for planning
**Surface:** `app/analyze/[id]/page.tsx`

## Problem

The Evidence Atlas callout on the persisted analysis page is unreadable in its current dark zinc treatment.

Current implementation:
- container: `border-zinc-700/60 bg-zinc-900/50`
- heading: `text-zinc-200`
- body: `text-zinc-400`
- CTA: `bg-zinc-800 ... text-zinc-300`

This clashes with the warmer cream/forest palette used across the rest of the analysis UI and weakens legibility in the screenshot the user referenced.

## Goal

Make the Evidence Atlas callout readable and visually consistent with the rest of the branded results surface.

## Chosen Direction

Use a warm branded card instead of a dark zinc utility panel.

### Color treatment
- Panel background: warm cream, aligned with existing analysis cards
- Panel border: soft neutral border, aligned with existing results sections
- Heading: forest / near-black brand text
- Body copy: warm stone body text with clearer contrast than the current zinc gray
- CTA: branded neutral button treatment that remains visible without introducing a new loud accent system

## Non-Goals

- No layout rewrite
- No copy rewrite
- No navigation behavior changes
- No broader Evidence Atlas redesign
- No global token refactor in this pass

## Implementation Notes

Apply the change only to the persisted analysis-page callout in `app/analyze/[id]/page.tsx:170-185`.

Keep the existing structure:
- text block on the left
- CTA on the right
- same spacing and affordance level

Only replace the dark zinc color system with the warm branded system already used elsewhere in the app.

## Verification

- The callout is readable in a browser smoke test on `/analyze/[id]`
- The heading/body/button colors visibly match the surrounding results page better than the prior zinc panel
- No functional behavior changes
