'use client'

export default function DeterministicScoreRecovery({
  onRetry,
  isRetrying,
  error,
}: {
  onRetry: () => void | Promise<void>
  isRetrying: boolean
  error: string | null
}) {
  return (
    <section
      className="p-6 rounded-xl print:hidden"
      style={{ background: '#FEF2F2', border: '1px solid #FCA5A5' }}
      aria-labelledby="grade-unavailable-title"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h3 id="grade-unavailable-title" className="text-lg font-semibold font-[family-name:var(--font-serif)]" style={{ color: '#991B1B' }}>
            Grade unavailable
          </h3>
          <p className="text-sm mt-1" style={{ color: '#7F1D1D' }}>
            A deterministic grade could not be calculated because required chemistry data was unavailable.
          </p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="shrink-0 px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50"
          style={{ background: '#1C3822', color: '#FAF8F3' }}
        >
          {isRetrying ? 'Retrying…' : 'Retry scoring'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm mt-3" style={{ color: '#991B1B' }}>{error}</p>
      )}
    </section>
  )
}
