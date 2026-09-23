---
title: "GreenChemistry.ai 0.8: Recommendations That Show Their Work"
slug: "greenchemistry-0-8-evidence-backed-recommendations"
date: "2026-09-23T15:00:00Z"
excerpt: "Version 0.8 ships an evidence-backed recommendation engine: Accept, Reject, and Ask cards grounded in literature and chemistry data, clearer empty states, and a more reliable Ask conversation on your scored protocol."
draft: false
---

GreenChemistry.ai 0.8 is live.

This release is about one design choice: greening advice should be usable in a lab notebook only when we can show why it applies to *this* reaction.

## Evidence-backed recommendations

The recommendation engine now classifies proposed changes into three explicit outcomes:

- **Accept** — a substitution or change with matching literature or database evidence for the current reaction context
- **Reject** — a candidate we evaluated and declined to promote, with the reason kept visible
- **Ask** — a direction that needs your judgment, more detail, or a clearer charge before it can be scored as a greening move

Accept is fail-closed. Plausible-sounding swaps without a matching evidence path do not become Accept cards. Papers and analogous cases can still inform the conversation, but they do not quietly upgrade into a green light for your protocol.

Scoring remains deterministic where it always was. ACS GCIPR-aligned waste and solvent framing, hazard-aware warnings, and material identity cleanup sit underneath the cards so the UI names chemicals the way a chemist wrote them, not the way a parser first saw them.

## When there is nothing to recommend

Silence is not the same as success.

If the engine cannot produce Accept or Reject cards — for example when materials are unscored, identity is indefinite, or the charge is too incomplete to ground a swap — you now get an explicit empty state. It explains what was held back and points Ask at the right questions: clarify the material, tighten the charge, or decide whether a ratio mixture should stay as written.

Common lab eluents such as hexane/ethyl acetate written as a ratio stay intact as indefinite mixtures. We do not invent component-level greening for a chromatography solvent that was never specified as separate charges.

## Ask is part of the workflow

Ask (Talk About This) is meant for the follow-up that happens after the score: why a grade moved, what a warning means, how to rephrase a material so it resolves.

In 0.8 the conversation turn has enough budget to finish tool lookups and still answer. When a solvent hazard profile is not yet in our local evidence pack, Ask stays calm instead of flashing a false “unavailable” failure. Full local GHS coverage for common solvents is still being harvested; until that pack is complete, hazard lookup stays gated rather than half-broken.

## What stayed the same

- Deterministic scoring math is not delegated to a chat model
- Production still ships only through the release path you approve
- The product goal is still the same: help researchers move protocols toward safer, lower-waste options without pretending certainty we do not have

## Try it

Open a protocol on [GreenChemistry.ai](https://greenchemistry.ai), run an analysis, and read the recommendation cards before you open Ask. If a card is missing, the empty state should tell you why — that is intentional.

We will keep tightening evidence coverage, solvent identity, and hazard data in follow-up releases. Version 0.8 is the point where the product refuses to overclaim.
