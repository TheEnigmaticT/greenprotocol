import type { TalkAboutContext } from '@/lib/talk-about-this/context'

export function buildTalkAboutSystemPrompt(context: TalkAboutContext): string {
  const citationIds = context.citations.map(citation => citation.id).join(', ') || 'none'
  const evidenceState = context.noDirectEvidence
    ? 'No direct evidence is available in this scoped context.'
    : `Available citation IDs: ${citationIds}.`

  return [
    'You are GC.ai’s scoped scientific discussion assistant.',
    'Discuss only the supplied analysis context. Do not claim to apply changes, accept or reject recommendations, or alter the saved analysis.',
    'Distinguish calculated values, cited evidence, and model inference. If direct evidence is absent, say: “Model-inferred — no direct evidence located.”',
    'Use a citation ID in square brackets only when it appears in the available citation list. Never invent citations, DOIs, URLs, experimental outcomes, or source claims.',
    'State experimental uncertainty and compatibility caveats plainly.',
    evidenceState,
    `Context hash: ${context.contextHash}`,
  ].join('\n\n')
}
