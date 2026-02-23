'use client'

import { AnalysisSummary } from '@/lib/types'

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  if (n >= 10) return Math.round(n).toString()
  if (n >= 0.1) return n.toFixed(1)
  return n.toFixed(2)
}

function severityColor(severity: string) {
  switch (severity) {
    case 'high': return '#EF4444'
    case 'medium': return '#F59E0B'
    case 'low': return '#22C55E'
    default: return '#a3a3a3'
  }
}

export default function AnalysisCard({ analysis }: { analysis: AnalysisSummary }) {
  const { analysis_result, impact_delta, created_at } = analysis
  const title = analysis_result.protocolTitle || 'Untitled Protocol'
  const subdomain = analysis_result.chemistrySubdomain || ''
  const date = new Date(created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  })

  // Find max severity across recommendations
  const severities = analysis_result.recommendations?.map(r => r.severity) || []
  const maxSeverity = severities.includes('high') ? 'high' : severities.includes('medium') ? 'medium' : 'low'

  return (
    <a
      href={`/analyze/${analysis.id}`}
      className="block p-5 rounded-xl border border-forest-700 hover:border-amber-500 transition-all group"
      style={{ background: '#14532d20' }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3
          className="font-[family-name:var(--font-serif)] font-semibold text-base group-hover:opacity-80 transition-opacity line-clamp-2"
          style={{ color: '#F5F5F4' }}
        >
          {title}
        </h3>
        <span
          className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5"
          style={{ background: severityColor(maxSeverity) }}
          title={`${maxSeverity} severity`}
        />
      </div>

      {subdomain && (
        <p className="text-xs mb-3 font-[family-name:var(--font-mono)]" style={{ color: '#a3a3a3' }}>
          {subdomain}
        </p>
      )}

      <div className="flex items-center gap-4 text-xs" style={{ color: '#86efac' }}>
        {impact_delta.co2eSavedKg > 0 && (
          <span title="CO2e saved">-{fmt(impact_delta.co2eSavedKg)} kg CO2e</span>
        )}
        {impact_delta.hazardousWasteEliminatedKg > 0 && (
          <span title="Hazardous waste eliminated">-{fmt(impact_delta.hazardousWasteEliminatedKg)} kg waste</span>
        )}
      </div>

      <p className="text-xs mt-3" style={{ color: '#737373' }}>{date}</p>
    </a>
  )
}
