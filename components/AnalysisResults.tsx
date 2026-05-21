'use client'

import PrincipleTag from './PrincipleTag'
import QuickWins from './QuickWins'
import { useState } from 'react'
import { AnalysisResult, Recommendation, Evidence } from '@/lib/types'

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

function EvidenceView({ evidence }: { evidence: Evidence }) {
  return (
    <div className="mt-4 pt-4 border-t border-[#D6D0C4] space-y-4">
      {evidence.why_flagged.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#7C2D36' }}>
            Why Flagged (Evidence)
          </h4>
          <ul className="space-y-1">
            {evidence.why_flagged.map((ef, idx) => (
              <li key={idx} className="text-xs flex gap-2" style={{ color: '#44403C' }}>
                <span className="font-bold text-[10px] bg-[#FEE2E2] px-1 rounded h-fit shrink-0">{ef.source}</span>
                <span>{ef.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidence.why_replacement.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#166534' }}>
            Why Replacement (Evidence)
          </h4>
          <ul className="space-y-1">
            {evidence.why_replacement.map((er, idx) => (
              <li key={idx} className="text-xs flex gap-2" style={{ color: '#44403C' }}>
                <span className="font-bold text-[10px] bg-[#DCFCE7] px-1 rounded h-fit shrink-0">{er.source}</span>
                <span><strong>{er.chemical}:</strong> {er.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidence.citations.length > 0 && (
        <div className="bg-white/50 p-2 rounded border border-[#E7E5E4]">
          <h4 className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: '#78716C' }}>
            Sources & Citations
          </h4>
          <div className="space-y-1">
            {evidence.citations.map((cite, idx) => (
              <div key={idx} className="text-[10px] italic leading-tight" style={{ color: '#57534E' }}>
                {cite.citation}
                {cite.url && (
                  <a href={cite.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#16a34a] hover:underline not-italic font-bold">
                    [Link]
                  </a>
                )}
                {cite.doi && <span className="ml-1 not-italic opacity-60">DOI: {cite.doi}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RecommendationCard({ 
  rec, 
  onToggleAccept 
}: { 
  rec: Recommendation; 
  onToggleAccept: () => void 
}) {
  const isAccepted = !!rec.isAccepted
  const [showEvidence, setShowEvidence] = useState(false)

  return (
    <div
      className={`p-4 rounded-lg border space-y-3 transition-all ${isAccepted ? 'ring-2' : ''}`}
      style={{ 
        background: isAccepted ? '#F0FDF4' : '#FAFAF8', 
        borderColor: isAccepted ? '#16a34a' : '#D6D0C4',
        boxShadow: isAccepted ? '0 0 15px rgba(22, 163, 74, 0.1)' : 'none'
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>
            Step {rec.stepNumber}
          </span>
          <SeverityBadge severity={rec.severity} />
          <ConfidenceBadge level={rec.confidenceLevel} />
          {rec.evidence && (
            <button 
              onClick={() => setShowEvidence(!showEvidence)}
              className="text-[10px] px-2 py-0.5 rounded border border-[#D6D0C4] hover:bg-white transition-colors font-bold uppercase tracking-tight"
              style={{ color: showEvidence ? '#16a34a' : '#78716C', borderColor: showEvidence ? '#16a34a' : '#D6D0C4' }}
            >
              {showEvidence ? 'Hide Evidence' : 'Show Evidence'}
            </button>
          )}
        </div>
        
        <button
          onClick={onToggleAccept}
          className={`text-xs px-3 py-1.5 rounded-full font-bold uppercase tracking-wider transition-colors border shrink-0 self-start sm:self-auto ${
            isAccepted 
              ? 'bg-[#16a34a] text-white border-[#16a34a]' 
              : 'bg-white text-[#78716C] border-[#D6D0C4] hover:border-[#16a34a] hover:text-[#16a34a]'
          }`}
        >
          {isAccepted ? '✓ Accepted' : 'Accept Solution'}
        </button>
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
        <div className="p-3 rounded" style={{ background: isAccepted ? '#DCFCE7' : '#F0FDF4' }}>
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
          {!rec.evidence && (
            <p className="text-xs mt-1" style={{ color: '#A8A29E' }}>
              Source: {rec.alternative.evidenceBasis}
            </p>
          )}
        </div>
      </div>

      {showEvidence && rec.evidence && (
        <EvidenceView evidence={rec.evidence} />
      )}
    </div>
  )
}

export default function AnalysisResults({ 
  analysis, 
  originalProtocol, 
  onUpdateAnalysis 
}: { 
  analysis: AnalysisResult; 
  originalProtocol: string; 
  onUpdateAnalysis?: (updated: AnalysisResult) => void 
}) {
  const [viewMode, setViewMode] = useState<'full' | 'quick'>('full')

  const toggleRecommendation = (index: number) => {
    if (!onUpdateAnalysis) return
    
    const newRecommendations = [...analysis.recommendations]
    newRecommendations[index] = {
      ...newRecommendations[index],
      isAccepted: !newRecommendations[index].isAccepted
    }
    
    onUpdateAnalysis({
      ...analysis,
      recommendations: newRecommendations
    })
  }

  return (
    <div className="space-y-8">
      {/* Header & View Toggle */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="min-w-0">
          <h2
            className="text-xl sm:text-2xl font-bold font-[family-name:var(--font-serif)] mb-1 break-words"
            style={{ color: '#1C1917' }}
          >
            {analysis.protocolTitle}
          </h2>
          <p className="text-sm" style={{ color: '#78716C' }}>{analysis.chemistrySubdomain}</p>
        </div>

        <div className="flex p-1 bg-[#F0EBE1] rounded-lg shrink-0">
          <button
            onClick={() => setViewMode('full')}
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
              viewMode === 'full' 
                ? 'bg-white shadow-sm text-[#1C1917]' 
                : 'text-[#78716C] hover:text-[#1C1917]'
            }`}
          >
            Full Analysis
          </button>
          <button
            onClick={() => setViewMode('quick')}
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
              viewMode === 'quick' 
                ? 'bg-[#16a34a] text-white shadow-sm' 
                : 'text-[#78716C] hover:text-[#1C1917]'
            }`}
          >
            Quick Wins
          </button>
        </div>
      </div>

      {viewMode === 'quick' ? (
        <QuickWins recommendations={analysis.recommendations} />
      ) : (
        <>
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
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold" style={{ color: '#1C1917' }}>
                  Recommendations ({analysis.recommendations.length})
                </h3>
                {analysis.recommendations.filter(r => r.isAccepted).length > 0 && (
                  <span
                    className="text-xs px-2.5 py-1 rounded-full font-semibold"
                    style={{ background: '#DCFCE7', color: '#16a34a' }}
                  >
                    {analysis.recommendations.filter(r => r.isAccepted).length} accepted
                  </span>
                )}
              </div>
              {analysis.recommendations.map((rec, i) => (
                <RecommendationCard 
                  key={i} 
                  rec={rec} 
                  onToggleAccept={() => toggleRecommendation(i)} 
                />
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-lg text-center" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
              <p className="text-lg" style={{ color: '#16a34a' }}>
                This protocol is already quite green! No major changes recommended.
              </p>
            </div>
          )}
        </>
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
        {analysis.overallAssessment.processComplexity && (
          <div className="mb-4 p-3 rounded bg-white/50 border border-[#D6D0C4]">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#1C1917' }}>Process Complexity</h4>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                analysis.overallAssessment.processComplexity.level === 'low' ? 'bg-green-100 text-green-700' :
                analysis.overallAssessment.processComplexity.level === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {analysis.overallAssessment.processComplexity.level} (Score: {analysis.overallAssessment.processComplexity.score}/10)
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              <div className="p-1">
                <div className="text-lg font-bold">{analysis.overallAssessment.processComplexity.metrics.step_count}</div>
                <div className="text-[9px] uppercase text-stone-500">Steps</div>
              </div>
              <div className="p-1">
                <div className="text-lg font-bold">{analysis.overallAssessment.processComplexity.metrics.transfer_count}</div>
                <div className="text-[9px] uppercase text-stone-500">Transfers</div>
              </div>
              <div className="p-1">
                <div className="text-lg font-bold">{analysis.overallAssessment.processComplexity.metrics.vessel_count}</div>
                <div className="text-[9px] uppercase text-stone-500">Vessels</div>
              </div>
              <div className="p-1">
                <div className="text-lg font-bold">{analysis.overallAssessment.processComplexity.metrics.prep_count}</div>
                <div className="text-[9px] uppercase text-stone-500">Preps</div>
              </div>
              <div className="p-1">
                <div className="text-lg font-bold">{analysis.overallAssessment.processComplexity.metrics.purification_count}</div>
                <div className="text-[9px] uppercase text-stone-500">Purifications</div>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-stone-500 italic">
              Complexity metrics serve as proxies for waste (transfer loss), failure risk, and operator burden.
            </p>
          </div>
        )}
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
