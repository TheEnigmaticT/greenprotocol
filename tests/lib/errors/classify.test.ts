import { describe, expect, it } from 'vitest'
import { AnalysisError, classifyAnalysisFailure } from '@/lib/errors/classify'
import { describeUnavailableScore } from '@/lib/errors/score-unavailable'

function failure(properties: { name?: string; status?: number; message: string }) {
  return Object.assign(new Error(properties.message), properties.name ? { name: properties.name } : {}, properties.status ? { status: properties.status } : {})
}

describe('classifyAnalysisFailure', () => {
  it('trusts the code on an AnalysisError and keeps the raw detail on the exception', () => {
    const error = new AnalysisError('persist_failed', 'insert or update on table "gpc_analyses" violates foreign key')
    expect(classifyAnalysisFailure(error)).toBe('persist_failed')
    expect(error.message).toContain('gpc_analyses')
  })

  it.each([
    [{ status: 401, message: 'invalid x-api-key' }, 'provider_auth'],
    [{ message: 'Could not resolve authentication method' }, 'provider_auth'],
    [{ name: 'CompatibleModelConfigurationError', message: 'GCAI_LLM_API_KEY is required' }, 'provider_auth'],
    [{ status: 429, message: 'slow down' }, 'provider_rate_limit'],
    [{ status: 529, message: 'Overloaded' }, 'provider_unavailable'],
    [{ name: 'QwenTransportError', message: 'Qwen transport failed for parse: provider unavailable after bounded retries' }, 'provider_unavailable'],
    [{ message: 'Claude did not return a tool_use block for parse (stop_reason=max_tokens)' }, 'provider_unavailable'],
    [{ message: 'something nobody anticipated' }, 'unknown'],
  ])('maps %j to %s', (properties, expected) => {
    expect(classifyAnalysisFailure(failure(properties))).toBe(expected)
  })

  it.each([undefined, null, 'a string', 42])('treats a non-error throw (%s) as unknown', (thrown) => {
    expect(classifyAnalysisFailure(thrown)).toBe('unknown')
  })
})

describe('describeUnavailableScore', () => {
  it.each([
    ['Cannot calculate PMI — no yield data and no reaction type benchmark available', /yield/i],
    ['No reaction SMILES provided — atom economy requires a balanced reaction equation. Retry LLM Phase 1 with reaction SMILES extraction.', /reaction/i],
    ['RDKit not available — cannot calculate atom economy', /reaction/i],
    ['CHEM21 data unavailable: SolventEvidenceUnavailableError', /solvent guide/i],
    ['Failed to parse assessment: {"foo": 1}', /didn't finish/i],
  ])('explains "%s" in plain language without repeating it', (raw, expected) => {
    const text = describeUnavailableScore({ error: raw })
    expect(text).toMatch(expected)
    expect(text).not.toMatch(/RDKit|SMILES|CHEM21|PMI|LLM|Phase|\{/)
  })

  it('has a calm default when there is no error detail at all', () => {
    expect(describeUnavailableScore(undefined)).toBe("We didn't have enough information to score this principle.")
    expect(describeUnavailableScore({ error: 42 })).toBe("We didn't have enough information to score this principle.")
  })
})
