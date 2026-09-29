import { describe, expect, it } from 'vitest'
import {
  REJECTION_FEEDBACK_MAX_LENGTH,
  shouldPromptForRejectionFeedback,
  validateRejectionFeedbackSubmission,
  validateRejectionFeedbackReason,
} from '@/lib/rejection-feedback'

describe('rejection feedback sampling', () => {
  it('samples exactly the first third of a uniform random range', () => {
    expect(shouldPromptForRejectionFeedback(0)).toBe(true)
    expect(shouldPromptForRejectionFeedback(0.332)).toBe(true)
    expect(shouldPromptForRejectionFeedback(1 / 3)).toBe(false)
    expect(shouldPromptForRejectionFeedback(0.99)).toBe(false)
  })

  it('rejects invalid random values instead of changing the sampling rate', () => {
    expect(() => shouldPromptForRejectionFeedback(-0.01)).toThrow('randomValue')
    expect(() => shouldPromptForRejectionFeedback(1)).toThrow('randomValue')
    expect(() => shouldPromptForRejectionFeedback(Number.NaN)).toThrow('randomValue')
  })
})

describe('rejection feedback validation', () => {
  it('accepts a scoped submission and rejects an invalid recommendation reference', () => {
    expect(validateRejectionFeedbackSubmission({
      recommendationId: 'rec-123',
      recommendationIndex: 2,
      reason: 'This solvent is incompatible with the substrate.',
    })).toEqual({
      valid: true,
      submission: {
        recommendationId: 'rec-123',
        recommendationIndex: 2,
        reason: 'This solvent is incompatible with the substrate.',
      },
    })
    expect(validateRejectionFeedbackSubmission({
      recommendationIndex: -1,
      reason: '',
    })).toEqual({ valid: false, error: 'recommendationIndex must be a non-negative integer.' })
  })

  it('trims an optional reason and bounds retained feedback', () => {
    expect(validateRejectionFeedbackReason('  incompatible with our catalyst  ')).toEqual({
      valid: true,
      reason: 'incompatible with our catalyst',
    })
    expect(validateRejectionFeedbackReason('   ')).toEqual({ valid: true, reason: '' })
    expect(validateRejectionFeedbackReason('x'.repeat(REJECTION_FEEDBACK_MAX_LENGTH + 1))).toEqual({
      valid: false,
      error: `Reason must be ${REJECTION_FEEDBACK_MAX_LENGTH} characters or fewer.`,
    })
  })
})
