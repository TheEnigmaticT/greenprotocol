export default function AnalysisSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-12 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-64 rounded" style={{ background: '#1B433240' }} />
        <div className="h-4 w-40 rounded" style={{ background: '#1B433220' }} />
      </div>

      {/* Protocol comparison skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-64 rounded-lg" style={{ background: '#EF444410' }} />
        <div className="h-64 rounded-lg" style={{ background: '#22C55E10' }} />
      </div>

      {/* Recommendations skeleton */}
      <div className="space-y-4">
        <div className="h-6 w-48 rounded" style={{ background: '#1B433240' }} />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-lg" style={{ background: '#14532d10', border: '1px solid #1B433220' }} />
        ))}
      </div>

      {/* Scoreboard skeleton */}
      <div className="space-y-6">
        <div className="h-6 w-40 rounded" style={{ background: '#1B433240' }} />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-6 rounded" style={{ background: '#1B433220', width: `${80 - i * 10}%` }} />
            <div className="h-6 rounded" style={{ background: '#22C55E10', width: `${60 - i * 8}%` }} />
          </div>
        ))}
      </div>

      {/* Message */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-t-transparent rounded-full" style={{ borderColor: '#22C55E', borderTopColor: 'transparent' }} />
          <p className="text-lg" style={{ color: '#86efac' }}>
            Analyzing your protocol against the 12 Principles of Green Chemistry...
          </p>
        </div>
      </div>
    </div>
  )
}
