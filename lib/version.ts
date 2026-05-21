/**
 * Canonical version source for GreenChemistry.ai.
 * The version string comes from package.json — do not duplicate it elsewhere.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('../package.json')

export const GCAI_VERSION: string = pkg.version

export interface AnalysisMetadata {
  generatedAt: string
  gcaiVersion: string
  methodologyVersion: string
}

export function getAnalysisMetadata(): AnalysisMetadata {
  return {
    generatedAt: new Date().toISOString(),
    gcaiVersion: GCAI_VERSION,
    methodologyVersion: 'waste-v0',
  }
}
