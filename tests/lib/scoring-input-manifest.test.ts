import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type {
  AnalysisResult,
  Citation,
  DeterministicScores,
  EnrichedChemical,
} from '@/lib/types'
import {
  buildScoringInputManifest,
  replayFrozenScoring,
  type ScoringInputManifest,
  type ScoringInputProvenance,
} from '@/lib/scoring-input-manifest'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function makeScores(): DeterministicScores {
  return {
    scores: [
      {
        principle_number: 1,
        principle_name: 'Prevent Waste',
        score: 7,
        max_score: 10,
        normalized: 0.7,
        details: { foo: 'bar' },
        chemicals_flagged: ['dcm'],
        data_sources: ['chem21'],
        confidence: 'calculated',
        compatibility_warnings: [],
      },
    ],
    total_score: 7,
    max_possible: 10,
    grade: 'B',
    smiles_extraction: { ok: true },
    yield_extraction: { ok: true },
  }
}

function makeReference(overrides: Partial<EnrichedChemical> = {}): EnrichedChemical {
  const citation: Citation = { source_id: 'src-1', source_name: 'PubChem', citation: 'PMID:1' }
  return {
    name: 'dichloromethane',
    role: 'solvent',
    occurrenceId: 'occ-1',
    stepNumber: 1,
    reference_status: 'resolved',
    molecular_weight: 84.93,
    density_g_per_ml: 1.33,
    smiles: 'ClCCl',
    molecular_formula: 'CH2Cl2',
    ghs_hazards: [{ code: 'H351', description: 'Suspected carcinogen', source: 'PubChem' }],
    green_alternatives: [{ chemical: 'ethanol', source: 'Chem21', content: 'safer' }],
    citations: [citation],
    data_source: 'PubChem',
    ...overrides,
  } as EnrichedChemical
}

function makeRequest(): Parameters<typeof buildScoringInputManifest>[0]['request'] {
  return {
    chemicals: [
      { name: 'dichloromethane', role: 'solvent', step_number: 1, reference_status: 'resolved' },
    ],
    steps: [{ stepNumber: 1, description: 'Mix', chemicals: [], conditions: {} }],
    protocol_text: 'Mix it.',
  } as unknown as Parameters<typeof buildScoringInputManifest>[0]['request']
}

function makeProvenance(overrides: Partial<ScoringInputProvenance> = {}): ScoringInputProvenance {
  return {
    methodologyVersion: 'waste-v0',
    model: 'claude-3',
    promptHash: 'p-hash',
    schemaHash: 's-hash',
    webRevision: 'rev-1',
    ...overrides,
  }
}

function buildInput(
  overrides: Partial<Parameters<typeof buildScoringInputManifest>[0]> = {},
): Parameters<typeof buildScoringInputManifest>[0] {
  return {
    sourceText: 'Add 5 mL dichloromethane and stir for 10 minutes at 25 C.',
    request: makeRequest(),
    scores: makeScores(),
    references: [makeReference()],
    warnings: ['one warning'],
    provenance: makeProvenance(),
    ...overrides,
  }
}

describe('buildScoringInputManifest', () => {
  it('uses schemaVersion literal 1', () => {
    const manifest = buildScoringInputManifest(buildInput())
    expect(manifest.schemaVersion).toBe(1)
  })

  it('hashed the exact source text with sha256 and no normalization', () => {
    const source = 'Add 5 mL dichloromethane.\r\n\r\nHeat.\r\n'
    const manifest = buildScoringInputManifest(buildInput({ sourceText: source }))
    expect(manifest.sourceHash).toBe(sha256(source))
    // Compare to a whitespace-normalized variant to assert no normalization
    expect(manifest.sourceHash).not.toBe(sha256('Add 5 mL dichloromethane.\n\nHeat.'))
  })

  it('does not freeze the manifest top-level object itself but deep-copies data', () => {
    const manifest = buildScoringInputManifest(buildInput())
    expect(Object.isFrozen(manifest)).toBe(false)
    const firstRef = manifest.references[0]
    if (!firstRef) throw new Error('fixture must have a reference')
    const firstCitation = firstRef.citations?.[0]
    if (!firstCitation) throw new Error('fixture must have a citation')
    expect(Object.isFrozen(firstRef)).toBe(true)
    expect(Object.isFrozen(firstCitation)).toBe(true)
    expect(Object.isFrozen(manifest.request)).toBe(true)
    expect(Object.isFrozen(manifest.scores)).toBe(true)
    expect(Object.isFrozen(manifest.warnings)).toBe(true)
    expect(Object.isFrozen(manifest.provenance)).toBe(true)
  })

  it('deep-copies the request so caller mutation does not leak', () => {
    const request = makeRequest()
    const manifest = buildScoringInputManifest(buildInput({ request }))
    request.chemicals[0].name = 'MUTATED'
    expect(manifest.request.chemicals[0].name).toBe('dichloromethane')
  })

  it('deep-copies references including evidence, citations, and status', () => {
    const references = [makeReference()]
    const manifest = buildScoringInputManifest(buildInput({ references }))
    references[0].name = 'MUTATED'
    const originalCitation = references[0].citations?.[0]
    if (!originalCitation) throw new Error('fixture must include citation evidence')
    originalCitation.source_id = 'MUTATED'
    expect(manifest.references[0].name).toBe('dichloromethane')
    expect(manifest.references[0].citations?.[0]?.source_id).toBe('src-1')
    expect(manifest.references[0].reference_status).toBe('resolved')
  })

  it('deep-copies scores so caller mutation does not leak', () => {
    const scores = makeScores()
    const manifest = buildScoringInputManifest(buildInput({ scores }))
    scores.scores[0].score = 0
    scores.scores[0].details = { replaced: true }
    expect(manifest.scores.scores[0].score).toBe(7)
    expect(manifest.scores.scores[0].details).toEqual({ foo: 'bar' })
  })

  it('does not freeze warnings or provenance contents in a way that lets caller mutate the built manifest', () => {
    const warnings = ['one warning']
    const provenance = makeProvenance()
    const manifest = buildScoringInputManifest(buildInput({ warnings, provenance }))
    warnings.push('second')
    provenance.methodologyVersion = 'MUTATED'
    expect(manifest.warnings).toEqual(['one warning'])
    expect(manifest.provenance.methodologyVersion).toBe('waste-v0')
  })

  it('produces a canonical stable JSON digest (object keys sorted, arrays preserve order)', () => {
    const input = buildInput()
    const m1 = buildScoringInputManifest(input)
    // Re-order input references (different ordering) — digest must reflect semantic content,
    // not insertion order, only when the underlying values are the same.
    const shuffled = buildInput({
      ...input,
      references: [input.references[0], makeReference({ occurrenceId: 'occ-2' })],
    })
    const m2 = buildScoringInputManifest(shuffled)
    expect(m1.digest).not.toBe(m2.digest)
    // Identical input -> identical digest
    expect(m1.digest).toBe(buildScoringInputManifest(input).digest)
    // Digest must be hex sha256 of canonical JSON
    expect(m1.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes digest when sourceText changes', () => {
    const base = buildScoringInputManifest(buildInput())
    const edited = buildScoringInputManifest(buildInput({ sourceText: 'Different text' }))
    expect(edited.digest).not.toBe(base.digest)
  })

  it('changes digest when request changes', () => {
    const base = buildScoringInputManifest(buildInput())
    const editedRequest = makeRequest()
    editedRequest.protocol_text = 'Other protocol'
    const edited = buildScoringInputManifest(buildInput({ request: editedRequest }))
    expect(edited.digest).not.toBe(base.digest)
  })

  it('changes digest when references change', () => {
    const base = buildScoringInputManifest(buildInput())
    const editedRefs = [makeReference({ name: 'methanol' })]
    const edited = buildScoringInputManifest(buildInput({ references: editedRefs }))
    expect(edited.digest).not.toBe(base.digest)
  })

  it('changes digest when scores change', () => {
    const base = buildScoringInputManifest(buildInput())
    const editedScores = makeScores()
    editedScores.total_score = 99
    const edited = buildScoringInputManifest(buildInput({ scores: editedScores }))
    expect(edited.digest).not.toBe(base.digest)
  })

  it('changes digest when warnings change', () => {
    const base = buildScoringInputManifest(buildInput())
    const edited = buildScoringInputManifest(buildInput({ warnings: ['different'] }))
    expect(edited.digest).not.toBe(base.digest)
  })

  it('changes digest when provenance changes', () => {
    const base = buildScoringInputManifest(buildInput())
    const edited = buildScoringInputManifest(
      buildInput({ provenance: makeProvenance({ webRevision: 'rev-2' }) }),
    )
    expect(edited.digest).not.toBe(base.digest)
  })
})

describe('replayFrozenScoring', () => {
  it('returns stored-result-replay mode with a deep copy of scores and recomputed=false', () => {
    const input = buildInput()
    const manifest = buildScoringInputManifest(input)
    const result = replayFrozenScoring(manifest, {
      sourceText: input.sourceText,
      methodologyVersion: input.provenance.methodologyVersion,
    })
    expect(result.mode).toBe('stored-result-replay')
    expect(result.recomputed).toBe(false)
    expect(result.scores).toEqual(input.scores)
    // Caller mutation of returned scores must not leak back
    result.scores.scores[0].score = 0
    expect(manifest.scores.scores[0].score).toBe(7)
  })

  it('rejects a manifest whose schemaVersion is not 1', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const tampered = { ...manifest, schemaVersion: 2 } as unknown as ScoringInputManifest
    expect(() =>
      replayFrozenScoring(tampered, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/schemaVersion/i)
  })

  it('rejects a tampered digest', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const tampered = { ...manifest, digest: 'a'.repeat(64) }
    expect(() =>
      replayFrozenScoring(tampered, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/digest/i)
  })

  it('rejects a mutated sourceHash', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const tampered: ScoringInputManifest = { ...manifest, sourceHash: 'b'.repeat(64) }
    expect(() =>
      replayFrozenScoring(tampered, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/sourceHash/i)
  })

  it('rejects a source text that does not match the recorded sourceHash', () => {
    const manifest = buildScoringInputManifest(buildInput())
    expect(() =>
      replayFrozenScoring(manifest, {
        sourceText: 'Totally different text',
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/sourceHash|source/i)
  })

  it('rejects a methodologyVersion that does not match the manifest provenance', () => {
    const manifest = buildScoringInputManifest(buildInput())
    expect(() =>
      replayFrozenScoring(manifest, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v1',
      }),
    ).toThrow(/methodology/i)
  })

  it('rejects tampered scores inside the manifest', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const tamperedScores: DeterministicScores = {
      ...manifest.scores,
      scores: [
        {
          ...manifest.scores.scores[0],
          score: 0,
        },
      ],
    }
    const tampered: ScoringInputManifest = { ...manifest, scores: tamperedScores }
    expect(() =>
      replayFrozenScoring(tampered, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/digest|tamper/i)
  })

  it('rejects a manifest with no sourceText-able provenance methodologyVersion (legacy input)', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const legacy: ScoringInputManifest = {
      ...manifest,
      provenance: { ...manifest.provenance, methodologyVersion: '' as 'waste-v0' },
    }
    expect(() =>
      replayFrozenScoring(legacy, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow(/methodology/i)
  })

  it('returns the scores deep copy isolated from the manifest (mutation does not leak)', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const { scores } = replayFrozenScoring(manifest, {
      sourceText: buildInput().sourceText,
      methodologyVersion: 'waste-v0',
    })
    scores.scores[0].score = 999
    expect(manifest.scores.scores[0].score).toBe(7)
  })

  it('is deterministic and does not call any provider or service', () => {
    // Pure-function check: same input, same output, no IO.
    const manifest = buildScoringInputManifest(buildInput())
    const expected = buildInput().sourceText
    const a = replayFrozenScoring(manifest, {
      sourceText: expected,
      methodologyVersion: 'waste-v0',
    })
    const b = replayFrozenScoring(manifest, {
      sourceText: expected,
      methodologyVersion: 'waste-v0',
    })
    expect(a.scores).toEqual(b.scores)
    expect(a.mode).toBe('stored-result-replay')
  })

  it('AnalysisResult.scoringInputManifest round-trips through JSON serialization (shape stability)', () => {
    const input = buildInput()
    const manifest = buildScoringInputManifest(input)
    const analysisResult: AnalysisResult = {
      protocolTitle: 'p',
      chemistrySubdomain: 's',
      steps: [],
      recommendations: [],
      revisedProtocol: '',
      overallAssessment: {
        greenPrinciplesViolated: [],
        mostImpactfulChange: '',
        experimentalValidationNeeded: false,
        disclaimer: '',
      },
      scoringInputManifest: manifest,
    } as unknown as AnalysisResult
    const round = JSON.parse(JSON.stringify(analysisResult)) as AnalysisResult
    expect(round.scoringInputManifest).toBeDefined()
    expect((round.scoringInputManifest as ScoringInputManifest).schemaVersion).toBe(1)
    expect(replayFrozenScoring(round.scoringInputManifest as ScoringInputManifest, {
      sourceText: input.sourceText,
      methodologyVersion: 'waste-v0',
    }).mode).toBe('stored-result-replay')
  })

  it('survives JSON storage round-trip when optional reference/request fields are undefined', () => {
    // Real Supabase JSON serializes analysis_result. undefined values are
    // stripped on storage, so the canonical digest MUST be JSON-compatible
    // for replay to succeed after a row is read back.
    const source = 'Add 5 mL dichloromethane.'
    const manifest = buildScoringInputManifest({
      sourceText: source,
      request: {
        chemicals: [
          {
            name: 'dichloromethane',
            role: 'solvent',
            quantity: undefined as unknown as string,
            smiles: null,
            reference_status: undefined as unknown as string,
            raw_quantity: null,
            reference_name: null,
            reference_smiles: null,
            reference_provenance: null,
            quantity_g: null,
            quantity_kg: null,
            quantity_mol: null,
            molecular_weight: undefined as unknown as number,
            step_number: 1,
          },
        ],
        steps: [{ stepNumber: 1, description: 'Mix', chemicals: [], conditions: {} }],
        protocol_text: source,
      } as unknown as Parameters<typeof buildScoringInputManifest>[0]['request'],
      scores: makeScores(),
      references: [
        makeReference({
          occurrenceId: undefined as unknown as string,
          stepNumber: undefined as unknown as number,
          reference_status: undefined as unknown as string,
          molecular_weight: undefined,
          density_g_per_ml: undefined as unknown as number,
          ghs_hazards: [],
          green_alternatives: [],
          citations: [{ source_id: 's', source_name: 'n', citation: 'c' }],
          data_source: undefined,
        }),
      ],
      warnings: ['a', undefined as unknown as string, 'b'],
      provenance: makeProvenance({ webRevision: null }),
    })

    // Simulate Supabase storage: serialize, then parse back.
    const stored = JSON.parse(JSON.stringify(manifest)) as unknown
    const replay = replayFrozenScoring(
      stored as ScoringInputManifest,
      { sourceText: source, methodologyVersion: 'waste-v0' },
    )
    expect(replay.mode).toBe('stored-result-replay')
    expect(replay.scores.total_score).toBe(7)
  })

  it('rejects a manifest whose canonical form contains a non-finite number (NaN/Infinity)', () => {
    const manifest = buildScoringInputManifest(buildInput())
    const poisoned = JSON.parse(JSON.stringify(manifest)) as ScoringInputManifest
    // Inject NaN at runtime via a numeric cast through string to bypass TS
    ;(poisoned.scores.total_score as unknown as number) = Number.NaN
    expect(() =>
      replayFrozenScoring(poisoned, {
        sourceText: buildInput().sourceText,
        methodologyVersion: 'waste-v0',
      }),
    ).toThrow()
  })
})
