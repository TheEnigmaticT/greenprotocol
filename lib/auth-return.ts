export function safeReturnTo(value: string | null | undefined, fallback = '/dashboard') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  try {
    const url = new URL(value, 'https://greenchemistry.ai')
    return url.origin === 'https://greenchemistry.ai' ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch {
    return fallback
  }
}
