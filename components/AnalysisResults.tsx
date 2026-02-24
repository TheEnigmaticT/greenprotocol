'use client'

import { AnalysisResult, Recommendation } from '@/lib/types'
import PrincipleTag from './PrincipleTag'

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#FEE2E2', text: '#DC2626' },
    medium: { bg: '#FEF3C7', text: '#D97706' },
    low: { bg: '#DCFCE7', text: '#16a34a' },
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
    <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#F0EBE1', color: '#78716C' }}>
      {level} confidence
    </span>
  )
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <div
      className="p-4 rounded-lg border space-y-3"
      style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>
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
        <div className="p-3 rounded" style={{ background: '#FEF2F2' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#DC2626' }}>ORIGINAL</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#1C1917' }}>
            {rec.original.chemical}
          </div>
          <p className="text-xs" style={{ color: '#78716C' }}>{rec.original.issue}</p>
        </div>

        {/* Alternative */}
        <div className="p-3 rounded" style={{ background: '#F0FDF4' }}>
          <div className="text-xs font-semibold mb-1" style={{ color: '#16a34a' }}>RECOMMENDED</div>
          <div className="text-sm font-[family-name:var(--font-mono)] font-semibold mb-1" style={{ color: '#1C1917' }}>
            {rec.alternative.chemical}
          </div>
          <p className="text-xs mb-1" style={{ color: '#2D6A4F' }}>{rec.alternative.rationale}</p>
          <p className="text-xs" style={{ color: '#78716C' }}>
            <strong>Yield:</strong> {rec.alternative.yieldImpact}
          </p>
          {rec.alternative.caveats && (
            <p className="text-xs mt-1" style={{ color: '#9B3D48' }}>
              <strong>Note:</strong> {rec.alternative.caveats}
            </p>
          )}
          <p className="text-xs mt-1" style={{ color: '#A8A29E' }}>
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
          style={{ color: '#1C1917' }}
        >
          {analysis.protocolTitle}
        </h2>
        <p className="text-sm" style={{ color: '#78716C' }}>{analysis.chemistrySubdomain}</p>
      </div>

      {/* Protocol comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: '#DC2626' }}>Original Protocol</h3>
          <pre
            className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed overflow-auto max-h-96"
            style={{ background: '#FEF2F2', color: '#1C1917', border: '1px solid #FECACA' }}
          >
            {originalProtocol}
          </pre>
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: '#16a34a' }}>Revised Protocol</h3>
          <pre
            className="p-4 rounded-lg text-sm whitespace-pre-wrap font-[family-name:var(--font-mono)] leading-relaxed overflow-auto max-h-96"
            style={{ background: '#F0FDF4', color: '#1C1917', border: '1px solid #BBF7D0' }}
          >
            {analysis.revisedProtocol}
          </pre>
        </div>
      </div>

      {/* Recommendations */}
      {analysis.recommendations.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold" style={{ color: '#1C1917' }}>
            Recommendations ({analysis.recommendations.length})
          </h3>
          {analysis.recommendations.map((rec, i) => (
            <RecommendationCard key={i} rec={rec} />
          ))}
        </div>
      ) : (
        <div className="p-6 rounded-lg text-center" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
          <p className="text-lg" style={{ color: '#16a34a' }}>
            This protocol is already quite green! No major changes recommended.
          </p>
        </div>
      )}

      {/* Overall assessment */}
      <div
        className="p-4 rounded-lg border"
        style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}
      >
        <h3 className="text-sm font-semibold mb-2" style={{ color: '#7C2D36' }}>Overall Assessment</h3>
        <p className="text-sm mb-2" style={{ color: '#1C1917' }}>
          <strong>Most impactful change:</strong> {analysis.overallAssessment.mostImpactfulChange}
        </p>
        {analysis.overallAssessment.greenPrinciplesViolated.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {analysis.overallAssessment.greenPrinciplesViolated.map((n) => (
              <PrincipleTag key={n} number={n} />
            ))}
          </div>
        )}
        <p className="text-xs italic" style={{ color: '#78716C' }}>
          {analysis.overallAssessment.disclaimer}
        </p>
      </div>
    </div>
  )
}
