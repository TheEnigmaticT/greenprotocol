const CHEMICAL_DISPLAY_NAMES: Record<string, string> = {
  dmf: 'N,N-Dimethylformamide',
}

export function displayChemicalName(name: string): string {
  return CHEMICAL_DISPLAY_NAMES[name.trim().toLowerCase()] ?? name
}

export function formatChemicalText(text: string): string {
  return text.replace(/\bDMF\b/gi, 'N,N-Dimethylformamide')
}
