/**
 * Tests for score provenance validation.
 * 
 * Run with: npm test tests/lib/provenance-validation.test.ts
 */

import { describe, it, expect } from 'vitest'
import { validateScore, assertValidScore, isValidProvenance } from '@/lib/validate-provenance'
import type { PrincipleScore } from '@/lib/types'

describe('Provenance Validation', () => {
  describe('isValidProvenance', () => {
    it('accepts valid provenance values', () => {
      expect(isValidProvenance('declared')).toBe(true)
      expect(isValidProvenance('calculated')).toBe(true)
      expect(isValidProvenance('benchmark')).toBe(true)
      expect(isValidProvenance('model-inferred')).toBe(true)
      expect(isValidProvenance('unavailable')).toBe(true)
    })

    it('rejects invalid provenance values', () => {
      expect(isValidProvenance('estimated')).toBe(false)  // legacy value
      expect(isValidProvenance('partial')).toBe(false)     // legacy value
      expect(isValidProvenance('unknown')).toBe(false)
      expect(isValidProvenance('')).toBe(false)
      expect(isValidProvenance(null)).toBe(false)
      expect(isValidProvenance(undefined)).toBe(false)
    })
  })

  describe('validateScore', () => {
    it('accepts a valid calculated score', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Less Hazardous Chemical Syntheses',
        score: 4.5,
        max_score: 10,
        normalized: 0.45,
        details: {},
        chemicals_flagged: ['benzene'],
        data_sources: ['pubchem_ghs'],
        confidence: 'calculated',
      }

      const errors = validateScore(score)
      expect(errors).toHaveLength(0)
    })

    it('accepts a valid model-inferred score with reasoning', () => {
      const score: PrincipleScore = {
        principle_number: 8,
        principle_name: 'Reduce Derivatives',
        score: 6.2,
        max_score: 10,
        normalized: 0.62,
        details: {
          reasoning: 'AI classified 5 steps: 3 ideal, 2 protecting group steps. Ideality: 60%',
        },
        chemicals_flagged: [],
        data_sources: ['ai_assessment', 'baran_ideality'],
        confidence: 'model-inferred',
      }

      const errors = validateScore(score)
      expect(errors).toHaveLength(0)
    })

    it('accepts a valid unavailable score', () => {
      const score: PrincipleScore = {
        principle_number: 2,
        principle_name: 'Atom Economy',
        score: -1,
        max_score: 10,
        normalized: -1,
        details: { error: 'Reaction SMILES could not be parsed' },
        chemicals_flagged: [],
        data_sources: [],
        confidence: 'unavailable',
      }

      const errors = validateScore(score)
      expect(errors).toHaveLength(0)
    })

    it('rejects invalid confidence value', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Test',
        score: 5,
        max_score: 10,
        normalized: 0.5,
        details: {},
        chemicals_flagged: [],
        data_sources: ['pubchem_ghs'],
        confidence: 'estimated' as unknown as PrincipleScore['confidence'],  // legacy value
      }

      const errors = validateScore(score)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('confidence')
      expect(errors[0].message).toContain('Invalid confidence value')
    })

    it('rejects unavailable score with non-negative value', () => {
      const score: PrincipleScore = {
        principle_number: 2,
        principle_name: 'Atom Economy',
        score: 5,  // Should be -1
        max_score: 10,
        normalized: 0.5,  // Should be -1
        details: {},
        chemicals_flagged: [],
        data_sources: [],
        confidence: 'unavailable',
      }

      const errors = validateScore(score)
      expect(errors.length).toBeGreaterThanOrEqual(2)
      expect(errors.some(e => e.field === 'score')).toBe(true)
      expect(errors.some(e => e.field === 'normalized')).toBe(true)
    })

    it('rejects model-inferred score without reasoning', () => {
      const score: PrincipleScore = {
        principle_number: 8,
        principle_name: 'Reduce Derivatives',
        score: 6.2,
        max_score: 10,
        normalized: 0.62,
        details: {},  // Missing reasoning
        chemicals_flagged: [],
        data_sources: ['ai_assessment'],
        confidence: 'model-inferred',
      }

      const errors = validateScore(score)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('details.reasoning')
      expect(errors[0].message).toContain('must include reasoning')
    })

    it('rejects non-unavailable score with no data sources', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Less Hazardous',
        score: 4.5,
        max_score: 10,
        normalized: 0.45,
        details: {},
        chemicals_flagged: [],
        data_sources: [],  // Missing data sources
        confidence: 'calculated',
      }

      const errors = validateScore(score)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('data_sources')
      expect(errors[0].message).toContain('must have at least one data source')
    })

    it('rejects internal pipeline values in data_sources', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Test',
        score: 5,
        max_score: 10,
        normalized: 0.5,
        details: {},
        chemicals_flagged: [],
        data_sources: ['pubchem_ghs', 'not_found', 'error'],  // Internal values
        confidence: 'calculated',
      }

      const errors = validateScore(score)
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0].field).toBe('data_sources')
      expect(errors[0].message).toContain('internal pipeline values')
    })
  })

  describe('assertValidScore', () => {
    it('does not throw for valid score', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Test',
        score: 4.5,
        max_score: 10,
        normalized: 0.45,
        details: {},
        chemicals_flagged: [],
        data_sources: ['pubchem_ghs'],
        confidence: 'calculated',
      }

      expect(() => assertValidScore(score)).not.toThrow()
    })

    it('throws for invalid score', () => {
      const score: PrincipleScore = {
        principle_number: 3,
        principle_name: 'Test',
        score: 4.5,
        max_score: 10,
        normalized: 0.45,
        details: {},
        chemicals_flagged: [],
        data_sources: [],  // Missing data sources
        confidence: 'calculated',
      }

      expect(() => assertValidScore(score)).toThrow('Invalid PrincipleScore')
    })
  })
})
