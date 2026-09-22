import type { JsonSchema } from '@/lib/benchmark/provider'

// These schemas mirror the private PARSE_SCHEMA, PRINCIPLE_SCHEMA, and
// ASSEMBLE_SCHEMA declarations in lib/pipeline.ts.
export const PARSE_SCHEMA: JsonSchema = {
  type: 'object', properties: {
    protocolTitle: { type: 'string' }, chemistrySubdomain: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: {
      stepNumber: { type: 'number' }, description: { type: 'string' },
      chemicals: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' }, role: { type: 'string' }, quantity: { type: 'string' },
        quantityMl: { type: 'number' }, quantityKg: { type: 'number' },
      }, required: ['name', 'role'] } },
      conditions: { type: 'object', properties: { temperature: { type: 'string' }, duration: { type: 'string' }, atmosphere: { type: 'string' } } },
    }, required: ['stepNumber', 'description', 'chemicals', 'conditions'] } },
    error: { type: 'string' }, message: { type: 'string' },
  }, required: ['protocolTitle', 'chemistrySubdomain', 'steps'],
}

export const PRINCIPLE_SCHEMA: JsonSchema = {
  type: 'object', properties: {
    principleNumber: { type: 'number' }, recommendations: { type: 'array', items: { type: 'object', properties: {
      stepNumber: { type: 'number' }, principleNumbers: { type: 'array', items: { type: 'number' } }, principleNames: { type: 'array', items: { type: 'string' } },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      original: { type: 'object', properties: { chemical: { type: 'string' }, issue: { type: 'string' } }, required: ['chemical', 'issue'] },
      alternative: { type: 'object', properties: { chemical: { type: 'string' }, rationale: { type: 'string' }, yieldImpact: { type: 'string' }, caveats: { type: 'string' }, evidenceBasis: { type: 'string' } }, required: ['chemical', 'rationale'] },
      confidenceLevel: { type: 'string', enum: ['high', 'medium', 'low'] }, primaryBenefit: { type: 'string' },
    }, required: ['stepNumber', 'original', 'alternative'] } },
  }, required: ['principleNumber', 'recommendations'],
}

export const ASSEMBLE_SCHEMA: JsonSchema = {
  type: 'object', properties: {
    revisedProtocol: { type: 'string' }, overallAssessment: { type: 'object', properties: {
      greenPrinciplesViolated: { type: 'array', items: { type: 'number' } }, mostImpactfulChange: { type: 'string' }, experimentalValidationNeeded: { type: 'boolean' }, disclaimer: { type: 'string' },
    }, required: ['greenPrinciplesViolated', 'mostImpactfulChange', 'experimentalValidationNeeded', 'disclaimer'] },
  }, required: ['revisedProtocol', 'overallAssessment'],
}

export interface ParseContract { protocolTitle: string; chemistrySubdomain: string; steps: unknown[]; error?: string; message?: string }
export interface PrincipleContract { principleNumber: number; recommendations: Record<string, unknown>[] }
export interface AssembleContract { revisedProtocol: string; overallAssessment: Record<string, unknown> }
