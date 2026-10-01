/** Existing account policy shared by web analysis and registered integrations.
 * Call only with the email of a server-verified Supabase Auth user, never an
 * imported source, delivery address, or browser-supplied actor identifier.
 */
const UNLIMITED_ANALYSIS_EMAILS = new Set([
  'trevor.longino+gc1@gmail.com',
  'alana@concannon.ie',
])

export function hasUnlimitedAnalyses(email?: string): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return UNLIMITED_ANALYSIS_EMAILS.has(normalized) || normalized.endsWith('@greenchemistry.ai')
}
