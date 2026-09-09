import type { AnalysisStep } from '@/lib/types'

/** A predicted product must not become a declared inventory item. */
export function groundDeclaredProducts(steps: AnalysisStep[], protocolText: string) {
  const source = protocolText.replace(/\s+/g, ' ')
  const warnings: string[] = []
  const groundedSteps = steps.map(step => ({
    ...step,
    chemicals: step.chemicals.filter(chemical => {
      if (chemical.role !== 'product') return true
      const name = chemical.name.trim().replace(/\s+/g, ' ')
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const explicitlyNamed = name && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(source)
      if (explicitlyNamed) return true
      warnings.push(`Product "${chemical.name}" was not explicitly named in the source and was excluded from the declared inventory. Any reaction product prediction remains model-inferred.`)
      return false
    }),
  }))
  return { steps: groundedSteps, warnings }
}
