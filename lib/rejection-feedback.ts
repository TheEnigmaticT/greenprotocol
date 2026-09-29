export const REJECTION_FEEDBACK_SAMPLE_RATE = 1 / 3
export const REJECTION_FEEDBACK_MAX_LENGTH = 500

export function shouldPromptForRejectionFeedback(randomValue: number): boolean {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new Error('randomValue must be a finite number from 0 (inclusive) to 1 (exclusive).')
  }

  return randomValue < REJECTION_FEEDBACK_SAMPLE_RATE
}

export type RejectionFeedbackReasonValidation =
  | { valid: true; reason: string }
  | { valid: false; error: string }

export type RejectionFeedbackSubmission = {
  recommendationId?: string
  recommendationIndex: number
  reason: string
}

export type RejectionFeedbackSubmissionValidation =
  | { valid: true; submission: RejectionFeedbackSubmission }
  | { valid: false; error: string }

export function validateRejectionFeedbackSubmission(value: unknown): RejectionFeedbackSubmissionValidation {
  if (!value || typeof value !== 'object') {
    return { valid: false, error: 'A feedback submission is required.' }
  }

  const { recommendationId, recommendationIndex, reason } = value as Record<string, unknown>
  if (!Number.isInteger(recommendationIndex) || typeof recommendationIndex !== 'number' || recommendationIndex < 0) {
    return { valid: false, error: 'recommendationIndex must be a non-negative integer.' }
  }
  if (recommendationId !== undefined && (typeof recommendationId !== 'string' || !recommendationId.trim())) {
    return { valid: false, error: 'recommendationId must be a non-empty string when provided.' }
  }

  const reasonValidation = validateRejectionFeedbackReason(reason)
  if (!reasonValidation.valid) return reasonValidation

  return {
    valid: true,
    submission: {
      recommendationId: recommendationId?.trim(),
      recommendationIndex,
      reason: reasonValidation.reason,
    },
  }
}

export function validateRejectionFeedbackReason(value: unknown): RejectionFeedbackReasonValidation {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Reason must be text.' }
  }

  const reason = value.trim()
  if (reason.length > REJECTION_FEEDBACK_MAX_LENGTH) {
    return { valid: false, error: `Reason must be ${REJECTION_FEEDBACK_MAX_LENGTH} characters or fewer.` }
  }

  return { valid: true, reason }
}
