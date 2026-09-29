---
title: "GreenChemistry.ai 0.8: recommendations that show their work"
slug: "greenchemistry-0-8-evidence-backed-recommendations"
date: "2026-09-23T15:00:00Z"
excerpt: "GreenChemistry.ai 0.8 gives scientists Accept, Reject, and Ask cards that show the evidence and limits behind a proposed change."
draft: false
---

You should be able to see why a recommendation fits your reaction before you change a procedure. GreenChemistry.ai 0.8 makes that part of the product.

A recommendation now lands in one of three places.

- **Accept** means the proposed change has matching literature or database evidence for the reaction context.
- **Reject** means the system looked at a candidate and shows why it rejected it.
- **Ask** means the material, procedure, or evidence doesn't support a safe recommendation yet.

That last state matters. A plausible solvent swap is still a bad recommendation if the evidence doesn't fit the chemistry on the page.

![Accept, Reject, and Ask recommendation cards in GreenChemistry.ai](/blog/greenchemistry-0-8/recommendation-cards.png)

*The three outcomes stay together. You can see what the product accepts, rejects, or needs you to clarify before it makes a recommendation.*

## Recommendations now have to earn their place

Accept cards fail closed. GreenChemistry.ai doesn't turn an adjacent paper or a generic hazard flag into permission to change a scientist's procedure. The evidence has to fit the chemistry closely enough to support the recommendation.

The rest of the scoring stays deterministic. ACS GCIPR waste and solvent data, hazard warnings, and material cleanup feed the cards. The product can explain what it found without treating a parser's first guess as a chemical conclusion.

## Model calls stay separate from the math

The scoring math doesn't run through a language model. Numbers stay numbers.

For classification and language tasks, GreenChemistry.ai uses a Qwen model through OpenRouter's Zero Data Retention path by default. That provider doesn't retain protocol text and analysis context for training or long-term storage under that route. Teams that need to keep model weights on their own infrastructure can use a self-hosted path instead.

Those choices change where the model runs. They don't change the standard for a recommendation. The evidence still has to hold up.

## An empty result now says what happened

A blank recommendation list used to leave too much unsaid. In 0.8, the product tells the scientist when it held a recommendation back and why.

That can happen when a material isn't resolved, a mixture is indefinite, or the procedure doesn't have enough detail to support a change. Ask points to the missing information instead of giving a confident answer with a hole in it.

A chromatography eluent written as a hexane/ethyl acetate ratio stays as that mixture. GreenChemistry.ai won't split it into separate charges and invent a solvent recommendation from incomplete input.

![GreenChemistry.ai explaining that it held back a recommendation because two materials could not be resolved](/blog/greenchemistry-0-8/held-back-explanation.png)

*When the input can't support a recommendation, the product says what it couldn't resolve and asks for a cleaner material name.*

## Ask belongs after the score

Ask, formerly Talk About This, is for the follow-up work: checking why a grade moved, clarifying a material name, or reviewing a warning against the procedure in front of you.

The 0.8 release gives that conversation enough time to finish its tool lookups before it answers. If a solvent hazard profile is missing from the local evidence pack, Ask reports the limit instead of returning a false "unavailable" failure.

![Ask panel reporting that no direct evidence was located for a proposed solvent substitution](/blog/greenchemistry-0-8/ask-evidence-limit.png)

*Ask can explain a limit in the evidence without pretending the answer is settled.*

## Try it on a procedure you know

Open a protocol on [GreenChemistry.ai](https://greenchemistry.ai), run an analysis, and read the recommendation cards before you ask for a follow-up. If the product can't support a recommendation, it should tell you what is missing.

That is the standard 0.8 is built around: fewer confident guesses, more visible reasoning.
