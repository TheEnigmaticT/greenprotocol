import { describe, expect, it } from 'vitest'
import { buildPredecisionEvidenceContext, buildPredecisionQuery } from '@/lib/predecision-evidence'
import type { AnalysisStep, LiteratureEvidenceMatch } from '@/lib/types'

const steps: AnalysisStep[] = [{
  stepNumber: 1,
  description: 'Oxidize ethanol to acetaldehyde at ambient temperature.',
  chemicals: [{ name: 'ethanol', role: 'reactant', quantity: '1 mol', quantityMl: null, quantityKg: null }],
  conditions: { temperature: '20 C', duration: '1 h', atmosphere: 'air' },
}]

const candidate: LiteratureEvidenceMatch = {
  id: 'unit-1',
  sourceDocumentId: 'doc-1',
  doi: '10.1000/example',
  title: 'Candidate oxidation paper',
  pageStart: 3,
  pageEnd: 4,
  quote: 'A different alcohol oxidation was evaluated.',
  evidenceType: 'comparison',
  applicability: 'Different substrate class',
  limitations: 'No ethanol-to-acetaldehyde experiment reported.',
  candidateStatus: 'candidate_pending_adjudication',
  similarity: 0.91,
}

describe('predecision reaction evidence context', () => {
  it('excludes high-similarity literature with no declared reaction material overlap', () => {
    const context = buildPredecisionEvidenceContext({ steps, matches: [{
      ...candidate, title: 'Percarbonate bleach activation', quote: 'Peroxodicarbonate was produced electrochemically.',
      applicability: undefined, limitations: undefined, similarity: 0.99,
    }] })
    expect(context).not.toContain('source_id=unit-1')
    expect(context).toContain('No retrieved candidates mention the declared reaction materials')
  })

  it('queries the text evidence index with reaction materials ahead of generic conditions', () => {
    const query = buildPredecisionQuery('Alcohol oxidation', steps)
    expect(query).toContain('reactant: ethanol')
    expect(query).toContain('Alcohol oxidation')
    expect(query.length).toBeLessThanOrEqual(500)
  })

  it('distinguishes retrieval failure from a completed search with no matches', () => {
    const context = buildPredecisionEvidenceContext({ steps, matches: [], retrievalStatus: 'unavailable' })
    expect(context).toContain('Literature retrieval unavailable; no conclusion about the absence of applicable literature can be drawn.')
    expect(context).not.toContain('No literature evidence units were retrieved from the bounded index.')
  })

  it('does not label an explicitly invalid reaction as validated', () => {
    const context = buildPredecisionEvidenceContext({
      reactionSmiles: 'invalid>>invalid', reactionSmilesMetadata: { validated: false }, steps, matches: [],
    })
    expect(context).not.toContain('Validated reaction representation: invalid>>invalid')
    expect(context).toContain('Validated reaction representation: unavailable')
  })

  it('preserves validated reaction representation and labels semantic candidate evidence as non-precedent', () => {
    const context = buildPredecisionEvidenceContext({
      reactionSmiles: 'CCO>>CC=O',
      reactionSmilesMetadata: { validated: true, source: 'chemistry-service' },
      steps,
      matches: [candidate],
    })

    expect(context).toContain('Validated reaction representation: CCO>>CC=O')
    expect(context).toContain('source_id=unit-1')
    expect(context).toContain('Candidate oxidation paper')
    expect(context).toContain('Semantic similarity alone is not an applicable reaction precedent')
    expect(context).toContain('No applicable reaction precedent is established')
    expect(context).toContain('Different substrate class')
  })

  it('does not claim an applicable precedent when the reaction representation is absent', () => {
    const context = buildPredecisionEvidenceContext({
      reactionSmilesMetadata: { validated: false, error: 'extract_failed' },
      steps,
      matches: [],
    })

    expect(context).toContain('Validated reaction representation: unavailable')
    expect(context).toContain('No applicable reaction precedent is established')
    expect(context).toContain('extract_failed')
  })
})
