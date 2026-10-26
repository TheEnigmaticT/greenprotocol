import type { ChemistryDataStatus, UnresolvedMaterialReason } from '@/lib/types'

/** `unspecified` covers analyses saved before per-material reasons were recorded. */
export type UnknownMaterialReason = UnresolvedMaterialReason | 'unspecified'

export interface UnknownMaterial {
  name: string
  steps: number[]
  roles: string[]
}

export interface UnknownMaterialGroup {
  reason: UnknownMaterialReason
  materials: UnknownMaterial[]
}

const REASON_ORDER: UnknownMaterialReason[] = ['not_recognized', 'reference_missing', 'provider_error', 'unspecified', 'indefinite']

function addUnique<T>(items: T[], item: T | undefined) {
  if (item !== undefined && !items.includes(item)) items.push(item)
}

/**
 * Groups every material that could not be scored by why. Uses the per-material
 * details when the analysis has them and falls back to the plain name lists for
 * older saved analyses, so both render.
 */
export function groupUnknownMaterials(status: ChemistryDataStatus): UnknownMaterialGroup[] {
  const byReason = new Map<UnknownMaterialReason, Map<string, UnknownMaterial>>()
  const seenNames = new Set<string>()

  function add(name: string, reason: UnknownMaterialReason, step?: number, role?: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    seenNames.add(key)
    const materials = byReason.get(reason) ?? new Map<string, UnknownMaterial>()
    byReason.set(reason, materials)
    const material = materials.get(key) ?? { name: trimmed, steps: [], roles: [] }
    materials.set(key, material)
    addUnique(material.steps, step)
    addUnique(material.roles, role?.trim() || undefined)
  }

  for (const detail of status.unresolvedDetails ?? []) {
    add(detail.name, detail.reason, detail.stepNumber, detail.role)
  }
  for (const name of status.indefiniteChemicals ?? []) {
    if (!seenNames.has(name.trim().toLowerCase())) add(name, 'indefinite')
  }
  for (const name of status.unresolvedChemicals ?? []) {
    if (!seenNames.has(name.trim().toLowerCase())) add(name, 'unspecified')
  }

  return REASON_ORDER.flatMap(reason => {
    const materials = byReason.get(reason)
    if (!materials) return []
    return [{
      reason,
      materials: [...materials.values()].map(m => ({ ...m, steps: [...m.steps].sort((a, b) => a - b) })),
    }]
  })
}

export function countUnknownMaterials(groups: UnknownMaterialGroup[]): number {
  return groups.reduce((total, group) => total + group.materials.length, 0)
}

export function describeSteps(steps: number[]): string {
  if (steps.length === 0) return ''
  if (steps.length === 1) return `Step ${steps[0]}`
  return `Steps ${steps.slice(0, -1).join(', ')} and ${steps[steps.length - 1]}`
}

/** "iranium · solvent", prefixed by its step when known. */
export function describeMaterial(material: UnknownMaterial): string {
  return [describeSteps(material.steps), material.name, material.roles.join(', ')].filter(Boolean).join(' · ')
}

export interface UnknownGroupCopy {
  lead: string
  consequence: string
  action: string
}

export function unknownGroupCopy(reason: UnknownMaterialReason, plural: boolean): UnknownGroupCopy {
  const them = plural ? 'them' : 'it'
  switch (reason) {
    case 'not_recognized':
      return {
        lead: plural ? "We couldn't match these to known chemicals:" : "We couldn't match this to a known chemical:",
        consequence: `We left ${them} out of the chemistry calculations, so your score could go up or down once ${plural ? "they're" : "it's"} identified.`,
        action: 'Check the spelling, or use the full chemical name or CAS number, then run the analysis again.',
      }
    case 'reference_missing':
      return {
        lead: plural ? "We couldn't get reference records for these:" : "We couldn't get a reference record for this:",
        consequence: `Calculations that need ${plural ? 'their' : 'its'} properties, such as hazards or molecular weight, leave ${them} out, so your score could change once the data is available.`,
        action: 'Add the CAS number to the procedure and run the analysis again, or ask about it in chat.',
      }
    case 'provider_error':
      return {
        lead: plural ? "We couldn't look these up just now:" : "We couldn't look this up just now:",
        consequence: `Our reference data source didn't answer, so we left ${them} out of the chemistry calculations for now.`,
        action: 'This is usually temporary. Run the analysis again in a few minutes.',
      }
    case 'indefinite':
      return {
        lead: plural ? "These are mixtures or don't have a fixed composition:" : "This is a mixture or doesn't have a fixed composition:",
        consequence: `We can't score ${plural ? 'them' : 'it'} as a single chemical, so we left ${them} out of the chemistry calculations. Your score could go up or down once ${plural ? 'they are' : 'it is'} specified.`,
        action: 'If you know what is in it, name the components (for example, sodium chloride and water instead of brine) and run the analysis again.',
      }
    case 'unspecified':
      return {
        lead: plural ? "We couldn't find reference data for these:" : "We couldn't find reference data for this:",
        consequence: `We left ${them} out of the chemistry calculations, so your score could go up or down once ${plural ? 'they are' : 'it is'} identified.`,
        action: 'Check the spelling, or use the full chemical name or CAS number, then run the analysis again.',
      }
  }
}

const REASON_IN_CHAT: Record<UnknownMaterialReason, string> = {
  not_recognized: "wasn't matched to a known chemical",
  reference_missing: 'has no reference record',
  provider_error: "couldn't be looked up (the reference source didn't answer)",
  indefinite: 'is a mixture or has no fixed composition',
  unspecified: "wasn't found in the reference data",
}

const MAX_CHAT_CHEMICALS = 10
const MAX_CHEMICAL_NAME_CHARS = 120

/** Scope values for the chat: unique names, trimmed, within the limits the chat endpoint enforces. */
export function clarificationChemicals(groups: UnknownMaterialGroup[]): string[] {
  const names = groups.flatMap(group => group.materials.map(material => material.name.trim().slice(0, MAX_CHEMICAL_NAME_CHARS)))
  return [...new Set(names)].slice(0, MAX_CHAT_CHEMICALS)
}

/** The first message the chat sends on the scientist's behalf. */
export function buildClarificationRequest(groups: UnknownMaterialGroup[]): string {
  const included = new Set(clarificationChemicals(groups))
  const lines = groups.flatMap(group => group.materials
    .filter(material => included.has(material.name.trim().slice(0, MAX_CHEMICAL_NAME_CHARS)))
    .map(material => {
      const where = [describeSteps(material.steps).toLowerCase(), material.roles.join(', ')].filter(Boolean).join(', ')
      return `- ${material.name}${where ? ` (${where})` : ''} ${REASON_IN_CHAT[group.reason]}`
    }))
  return [
    "Some materials in this analysis couldn't be fully scored:",
    ...lines,
    'What is going on with these, and what should I change in my procedure so they can be scored?',
  ].join('\n')
}

/** Sent when the whole grade is missing rather than individual materials. */
export function buildScoringFailureRequest(failure: 'rescore-failed' | 'scoring-unavailable', errorTitle?: string): string {
  return failure === 'rescore-failed'
    ? `I tried to retry scoring this analysis and it didn't work${errorTitle ? ` ("${errorTitle}")` : ''}. What could be causing this, and what can I do about it?`
    : "This analysis doesn't have a grade because the reference data wasn't available when it ran. What does that mean for my results, and what can I do about it?"
}
