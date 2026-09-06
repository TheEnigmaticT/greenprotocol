export type SourceFormat = 'line-oriented' | 'prose'

export interface ProtocolPreflight {
  /** Canonical transport representation. This is the immutable source used downstream. */
  protocolText: string
  sourceFormat: SourceFormat
}

const MAX_PROTOCOL_CHARS = 100_000
const prohibitedControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u
const injectionPatterns = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?)\b/i,
  /\b(?:reveal|print|show|leak)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\b(?:system|developer)\s+message\s*:/i,
  /\b(?:tool[_ -]?call|function[_ -]?call)\s*:/i,
  /<\/?(?:system|developer|assistant|tool)>/i,
]
const procedureActions = /\b(?:add(?:ed)?|charge(?:d)?|dissolv(?:e|ed)|mix(?:ed|ing)?|stirr?(?:ed|ing)?|heat(?:ed|ing)?|cool(?:ed|ing)?|reflux(?:ed|ing)?|filter(?:ed|ing)?|wash(?:ed|ing)?|extract(?:ed|ing)?|separat(?:e|ed|ing)|dr(?:y|ied|ying)|concentrat(?:e|ed|ing)|evaporat(?:e|ed|ing)|purif(?:y|ied|ying)|chromatograph(?:ed|ing)?|elut(?:e|ed|ing)|monitor(?:ed|ing)?|quench(?:ed|ing)?|transfer(?:red|ring)?|triturat(?:e|ed|ing)|distill(?:ed|ing)?|crystalli[sz](?:e|ed|ing)|introduc(?:e|ed|ing)|bubble(?:d|ing)?)\b/i
const chemistrySignals = /\b(?:mol|mmol|equiv|mg|g|kg|µg|mL|L|µL|°C|K|bar|atm|ph|tLC|hPLC|NMR|Rf|flask|vial|solvent|aqueous|organic|chromatography|reaction|mixture|solution|substrate|product|water|brine|acetone|hexane|heptane|ethyl acetate|ethanol|ether)\b/i

/**
 * Runs before any model/provider call. It deliberately performs only lossless
 * transport normalization: source wording is not model-rewritten or inferred.
 */
export function preflightProtocol(rawProtocolText: string): ProtocolPreflight {
  if (typeof rawProtocolText !== 'string' || !rawProtocolText.trim()) throw new Error('Malformed protocol input: empty text')
  if (rawProtocolText.length > MAX_PROTOCOL_CHARS) throw new Error(`Malformed protocol input: exceeds ${MAX_PROTOCOL_CHARS} characters`)
  if (prohibitedControls.test(rawProtocolText)) throw new Error('Unsafe protocol input: prohibited control characters')
  if (injectionPatterns.some(pattern => pattern.test(rawProtocolText))) throw new Error('Unsafe protocol input: suspected prompt injection')

  const protocolText = rawProtocolText.replace(/\r\n?/g, '\n')
  if (!procedureActions.test(protocolText) || !chemistrySignals.test(protocolText)) {
    throw new Error('Malformed protocol input: no apparent chemistry procedure')
  }
  return { protocolText, sourceFormat: protocolText.includes('\n') ? 'line-oriented' : 'prose' }
}
