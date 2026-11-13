import { describe, expect, it } from 'vitest'
import {
  PARSE_SYSTEM_PROMPT,
  CANDIDATE_PARSE_SYSTEM_PROMPT,
} from '@/lib/prompts/parse'

describe('parse prompt input-authority rules', () => {
  it('keeps the legacy parse prompt intact (no candidate-only instructions)', () => {
    // The non-candidate prompt remains the historical baseline; candidate-only
    // rules are layered on via CANDIDATE_PARSE_SYSTEM_PROMPT.
    expect(PARSE_SYSTEM_PROMPT).not.toMatch(/INPUT-AUTHORITY/i)
    expect(PARSE_SYSTEM_PROMPT).toMatch(/Return ONLY valid JSON/)
  })

  it('instructs the candidate parser to keep separate occurrences and not aggregate', () => {
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/separate (?:formulations|occurrences)/i)
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/do not aggregate amounts|not.*aggregate/i)
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/never sum separate variants|not.*sum.*separate/i)
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/not (?:silently )?(?:choose|pick).*first amount/i)
  })

  it('instructs the candidate parser to keep source quantities verbatim and not infer mass', () => {
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/quantity.*verbatim/i)
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/do not infer .* mass|not infer product mass/i)
  })

  it('instructs the candidate parser to flag pore sizes / mesh as non-quantity descriptors', () => {
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/pore size|particle size|mesh/i)
  })

  it('instructs the candidate parser to distinguish function role from process use (additive)', () => {
    // The prompt must mention both role (function) and process use as additive
    // annotations, not as a silent reinterpretation of workup → wash.
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/process\s*use/i)
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/workup/i)
  })

  it('instructs the candidate parser to prefer keeping ambiguous occurrences and let validation flag them', () => {
    expect(CANDIDATE_PARSE_SYSTEM_PROMPT).toMatch(/human review|flag|validation/i)
  })
})
