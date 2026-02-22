'use client'

import { AnalysisResult, Recommendation } from '@/lib/types'
import PrincipleTag from './PrincipleTag'

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#EF444430', text: '#EF4444' },
    medium: { bg: '#F59E0B30', text: '#F59E0B' },
    low: { bg: '#22C55E30', text: '#22C55E' },
  }
  const c = colors[severity] || colors.low
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-semibold uppercase"
      style={{ background: c.bg, color: c.text }}
    >
      {severity}
    </span>
  )
}

function ConfidenceBadge({ level }: { level: string }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#52525b30', color: '#a3a3a3' }}>
      {level} confidence
    </span>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div
      className="p-4 rounded-lg border border-forest-800 space-y-3"
      style={{ background: '#14532d10' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: '#F5F5F4' }}>
          Step {rec.stepNumber}
        </span>
        <SeverityBadge severity={rec.severity} />
        <ConfidenceBadge level={rec.confidenceLevel} />
      </div>

      <div className="flex flex-wrap gap-1">
        {rec.principleNumbers.map((n) => (
          <PrincipleTag key={n} number={n} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Original */}
        <div className="p-3 rounded" style={{ background: '#EF444410' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#EF4444' }}>ORIGINAL</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#F5F5F4' }}>
            {rec.original.chemical}
          </div>
          <p className="text-xs" style={{ color: '#a3a3a3' }}>{rec.original.issue}</p>
        </div>

        {/* Alternative */}
        <div className="p-3 rounded" style={{ background: '#22C55E10' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#22C55E' }}>RECOMMENDED</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#F5F5F4' }}>
            {rec.alternative.chemical}
          </div>
          <p className="text-xs mb-1" style={{ color: '#86efac' }}>{rec.alternative.rationale}</p>
          <p className="text-xs" style={{ color: '#a3a3a3' }}>
            <strong>Yield:</strong> {rec.alternative.yieldImpact}
          </p>
          {rec.alternative.caveats && (
            <p className="text-xs mt-1" style={{ color: '#F59E0B' }}>
              <strong>Note:</strong> {rec.alternative.caveats}
            </p>
          )}
          <p className="text-xs mt-1" style={{ color: '#737373' }}>
            Source: {rec.alternative.evidenceBasis}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AnalysisResults({
  analysis,
  originalProtocol,
}: {
  analysis: AnalysisResult
  originalProtocol: string
}) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2
          className="text-2xl font-bold font-[family-name:var(--font-serif)] mb-1"
          style={{ color: '#F5F5F4' }}
        >
          {analysis.protocolTitle}
        </h2>
        <p className="text-sm" style={{ color: '#86efac' }}>{analysis.chemistrySubdomain}</p>
      </div>

      {/* Protocol comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: '#EF4444' }}>Original Protocol</h3>
          <pre
            className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed overflow-auto max-h-96"
            style={{ background: '#EF444410', color: '#F5F5F4', border: '1px solid #EF444430' }}
          >
            {originalProtocol}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: '#22C55E' }}>Revised Protocol</h3>
          <pre
            className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed overflow-auto max-h-96"
            style={{ background: '#22C55E10', color: '#F5F5F4', border: '1px solid #22C55E30' }}
          >
            {analysis.revisedProtocol}
          </pre>
        </div>
      </div>

      {/* Recommendations */}
      {analysis.recommendations.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: '#F5F5F4' }}>
            Recommendations ({analysis.recommendations.length})
          </h3>
          {analysis.recommendations.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </div>
      ) : (
        <div className="p-6 rounded-lg text-center" style={{ background: '#22C55E10', border: '1px solid #22C55E30' }}>
          <p className="text-lg" style={{ color: '#22C55E' }}>
            This protocol is already quite green! No major changes recommended.
          </p>
        </div>
      )}

      {/* Overall assessment */}
      <div
        className="p-4 rounded-lg border border-forest-800"
        style={{ background: '#14532d10' }}
      >
        <h3 className="text-sm font-semibold mb-2" style={{ color: '#F59E0B' }}>Overall Assessment</h3>
        <p className="text-sm mb-2" style={{ color: '#F5F5F4' }}>
          <strong>Most impactful change:</strong> {analysis.overallAssessment.mostImpactfulChange}
        </p>
        {analysis.overallAssessment.greenPrinciplesViolated.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {analysis.overallAssessment.greenPrinciplesViolated.map((n) => (
              <PrincipleTag key={n} number={n} />
            ))}
          </div>
        )}
        <p className="text-xs italic" style={{ color: '#a3a3a3' }}>
          {analysis.overallAssessment.disclaimer}
        </p>
      </div>
    </div>
  )
}
