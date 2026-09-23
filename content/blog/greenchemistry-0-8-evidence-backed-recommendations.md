---
title: "GreenChemistry.ai 0.8: The Version Where We Stop Guessing"
slug: "greenchemistry-0-8-evidence-backed-recommendations"
date: "2026-09-23T15:00:00Z"
excerpt: "GreenChemistry.ai 0.8 keeps a plausible chemical suggestion from becoming a recommendation until it can explain why it belongs in this reaction."
draft: false
---

A chemically plausible suggestion is cheap. A recommendation you can put in a lab notebook is harder.

That is the whole point of 0.8.

Green chemistry software has an easy failure mode. It sees a bad solvent, finds a greener one in a database, and acts like the job is done. But reactions don't happen in databases. The replacement has to make sense for the actual charge, conditions, and chemistry in front of you. If we can't make that case, we shouldn't put the suggestion in front of you as an answer.

## The cards have to earn their labels

Recommendations now land in one of three places:

- **Accept** means we found evidence that fits the reaction context.
- **Reject** means the system considered a change and declined to recommend it. You can see why.
- **Ask** means the system needs a scientist to clarify something before it can responsibly go further.

Accept is fail-closed. A swap that sounds good but doesn't have a matching evidence path doesn't get an Accept card. It can still be part of the conversation. It doesn't get to masquerade as permission.

The scoring behind those cards remains deterministic. Waste, solvent framing, hazard warnings, and material cleanup don't get recalculated by a chat model because it wrote a convincing sentence. They are separate jobs, and they stay separate.

## The system tells you when it has nothing

An empty recommendation screen used to leave too much room for interpretation. Did the analysis go well? Did it miss the chemistry? Did something break?

Now it says what happened.

If a material isn't scored, an identity is too vague, or the charge doesn't contain enough detail to ground a replacement, the product holds the card back and tells you what would make the analysis better. That could mean naming a material more precisely, adding the charge, or leaving a ratio mixture alone because that's all the procedure gives us.

"Hexane/ethyl acetate 7:3" stays a mixture. We're not going to invent separate component charges and then pretend we know what a greener chromatography system looks like for a procedure that never gave us that information.

That restraint matters. Silence can be a useful answer when it has an explanation attached.

## Ask now does its job

Ask (Talk About This) is for the conversation after the score. Why did a grade move? What does this warning mean? What information would let the system evaluate this part of the protocol?

The turn now has enough room to finish its tool lookups and answer. When a solvent hazard profile is not in the local evidence pack yet, Ask no longer throws a false unavailable error. Hazard lookup stays gated until the data is there. A half-answer with a reassuring interface is worse than a plain limitation.

## Models get a boundary too

The product uses models for language and classification work. It doesn't hand them the math.

Our default route runs model calls through OpenRouter under its zero-data-retention policy, so protocol text and analysis context are not retained for training or long-term storage through that path. Teams that want to run the same decision work under their own control can use their own hardware instead.

That's not a marketing checkbox. Chemistry teams have to know which part of a system is calculating, which part is interpreting, and where their protocol goes. Otherwise they're being asked to trust a black box while calling it evidence.

Open a protocol on [GreenChemistry.ai](https://greenchemistry.ai), run the analysis, then read the cards before opening Ask. If a card is missing, 0.8 should tell you why. That is the version change.
