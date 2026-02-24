export default function AnalysisSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-12 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-8 w-64 rounded" style={{ background: '#E7E5E4' }} />
        <div className="h-4 w-40 rounded" style={{ background: '#F0EBE1' }} />
      </div>

      {/* Protocol comparison skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-64 rounded-lg" style={{ background: '#FEF2F2' }} />
        <div className="h-64 rounded-lg" style={{ background: '#F0FDF4' }} />
      </div>

      {/* Recommendations skeleton */}
      <div className="space-y-4">
        <div className="h-6 w-48 rounded" style={{ background: '#E7E5E4' }} />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #D6D0C4' }} />
        ))}
      </div>

      {/* Scoreboard skeleton */}
      <div className="space-y-6">
        <div className="h-6 w-40 rounded" style={{ background: '#E7E5E4' }} />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1">
            <div className="h-6 rounded" style={{ background: '#F0EBE1', width: `${80 - i * 10}%` }} />
            <div className="h-6 rounded" style={{ background: '#DCFCE7', width: `${60 - i * 8}%` }} />
          </div>
        ))}
      </div>

      {/* Message */}
      <div className="text-center py-8">
        <div className="inline-flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-t-transparent rounded-full" style={{ borderColor: '#1B4332', borderTopColor: 'transparent' }} />
          <p className="text-lg" style={{ color: '#78716C' }}>
            Analyzing your protocol against the 12 Principles of Green Chemistry...
          </p>
        </div>
      </div>
    </div>
  )
}
