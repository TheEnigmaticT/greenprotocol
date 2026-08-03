export const ANALYSIS_STORAGE_KEY = 'gpc_analysis'
export const PROTOCOL_STORAGE_KEY = 'gpc_protocol'
export const NEW_ANALYSIS_HREF = '/analyze?new=1'

interface StorageReader {
  getItem(key: string): string | null
  removeItem(key: string): void
}

interface SearchParamReader {
  get(name: string): string | null
}

interface ResolveAnalysisSessionOptions {
  sessionStorage: StorageReader
  searchParams: SearchParamReader
}


export function clearAnalysisSession(sessionStorage: Pick<StorageReader, 'removeItem'>): void {
  sessionStorage.removeItem(ANALYSIS_STORAGE_KEY)
  sessionStorage.removeItem(PROTOCOL_STORAGE_KEY)
}

export function resolveAnalysisSession<T extends { protocolText?: string }>({
  sessionStorage,
  searchParams,
}: ResolveAnalysisSessionOptions): T | null {
  if (searchParams.get('new') === '1') {
    clearAnalysisSession(sessionStorage)
    return null
  }

  const storedAnalysis = sessionStorage.getItem(ANALYSIS_STORAGE_KEY)
  if (!storedAnalysis) {
    return null
  }

  try {
    const parsed = JSON.parse(storedAnalysis) as T
    return {
      ...parsed,
      protocolText: parsed.protocolText || sessionStorage.getItem(PROTOCOL_STORAGE_KEY) || undefined,
    }
  } catch {
    sessionStorage.removeItem(ANALYSIS_STORAGE_KEY)
    return null
  }
}
