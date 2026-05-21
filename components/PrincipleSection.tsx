'use client'

import { PrincipleScore, Recommendation, WasteAnalysis, EnrichedChemical } from '@/lib/types'
import { buildRecommendationCitationString } from '@/lib/citation'
import PrincipleTag from './PrincipleTag'

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#DCFCE7', text: '#166534' },
  B: { bg: '#D1FAE5', text: '#065F46' },
  C: { bg: '#FEF3C7', text: '#92400E' },
  D: { bg: '#FED7AA', text: '#9A3412' },
  F: { bg: '#FEE2E2', text: '#991B1B' },
}

function ScoreBadge({ score, maxScore, confidence }: { score: number; maxScore: number; confidence: string }) {
  const pct = maxScore > 0 ? score / maxScore : 0
  const color = pct <= 0.3 ? '#166534' : pct <= 0.6 ? '#92400E' : '#991B1B'
  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-bold" style={{ color }}>{score}</span>
      <span className="text-xs" style={{ color: '#78716C' }}>/ {maxScore}</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#F0EBE1', color: '#78716C' }}>
        {confidence}
      </span>
    </div>
  )
}

interface PrincipleSectionProps {
  principleNumber: number
  principleName: string
  score?: PrincipleScore
  recommendations: Recommendation[]
  enrichedChemicals?: EnrichedChemical[]
  // P1-specific: waste analysis data
  wasteAnalysis?: WasteAnalysis
  analysisId?: string
}

export default function PrincipleSection({
  principleNumber,
  principleName,
  score,
  recommendations,
  enrichedChemicals,
  wasteAnalysis,
  analysisId,
}: PrincipleSectionProps) {
  const anchorId = `p${principleNumber}`

  return (
    <section id={anchorId} className="scroll-mt-20">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <PrincipleTag number={principleNumber} />
        <h2 className="text-lg font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
          {principleName}
        </h2>
      </div>

      {/* Score */}
      {score && score.score >= 0 && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
          <ScoreBadge score={score.score} maxScore={score.max_score} confidence={score.confidence} />
          {score.data_sources.length > 0 && (
            <p className="text-[10px] mt-1" style={{ color: '#A8A29E' }}>
              Sources: {score.data_sources.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* P1-specific: Waste analysis detail */}
      {principleNumber === 1 && wasteAnalysis && (
        <div className="mb-6 space-y-4">
          {/* Waste grade card */}
          <div className="p-4 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
            <div className="flex items-center gap-4 mb-3">
              <div
                className="flex items-center justify-center w-12 h-12 rounded-lg text-xl font-bold shrink-0"
                style={{
                  background: (GRADE_COLORS[wasteAnalysis.summary.grade] || GRADE_COLORS.C).bg,
                  color: (GRADE_COLORS[wasteAnalysis.summary.grade] || GRADE_COLORS.C).text,
                }}
              >
                {wasteAnalysis.summary.grade}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#1C1917' }}>
                  Waste Impact: {wasteAnalysis.summary.wasteImpactScore}/10
                </p>
                <p className="text-xs" style={{ color: '#57534E' }}>{wasteAnalysis.summary.primaryDriver}</p>
              </div>
            </div>

            {/* Direct waste */}
            <div className="grid grid-cols-3 gap-3 text-center mb-3">
              <div className="p-2 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.directWaste.totalWasteKg.toFixed(3)}</div>
                <div className="text-[9px] uppercase text-stone-500">Total kg</div>
              </div>
              <div className="p-2 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.directWaste.solventWasteKg.toFixed(3)}</div>
                <div className="text-[9px] uppercase text-stone-500">Solvent kg</div>
              </div>
              <div className="p-2 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.directWaste.nonSolventWasteKg.toFixed(3)}</div>
                <div className="text-[9px] uppercase text-stone-500">Non-solvent kg</div>
              </div>
            </div>

            {/* Hazard segments */}
            {wasteAnalysis.hazardSegments && wasteAnalysis.hazardSegments.length > 0 && (
              <div className="mb-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#7C2D36' }}>
                  Hazard-Segmented Waste
                </h4>
                <div className="space-y-1">
                  {wasteAnalysis.hazardSegments.map((seg) => (
                    <div key={seg.category} className="flex justify-between text-xs">
                      <span className="capitalize" style={{ color: '#57534E' }}>
                        {seg.category} ({seg.chemicalsCount})
                        {seg.chemicals.length > 0 && (
                          <span className="text-[10px] ml-1" style={{ color: '#A8A29E' }}>
                            — {seg.chemicals.slice(0, 3).join(', ')}
                          </span>
                        )}
                      </span>
                      <span className="font-semibold" style={{ color: '#1C1917' }}>{seg.totalKg.toFixed(3)} kg</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Liquid burden */}
            <div className="grid grid-cols-2 gap-3 text-center mb-3">
              <div className="p-2 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.liquidBurden.totalLiquidHandledKg.toFixed(3)}</div>
                <div className="text-[9px] uppercase text-stone-500">Liquid handled kg</div>
              </div>
              <div className="p-2 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.liquidBurden.totalLiquidDiscardedKg.toFixed(3)}</div>
                <div className="text-[9px] uppercase text-stone-500">Liquid discarded kg</div>
              </div>
            </div>

            {/* Process burden */}
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="p-1.5 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.processBurden.transferCount}</div>
                <div className="text-[8px] uppercase text-stone-500">Transfers</div>
              </div>
              <div className="p-1.5 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.processBurden.vesselCount}</div>
                <div className="text-[8px] uppercase text-stone-500">Vessels</div>
              </div>
              <div className="p-1.5 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.processBurden.purificationCount}</div>
                <div className="text-[8px] uppercase text-stone-500">Purifications</div>
              </div>
              <div className="p-1.5 rounded bg-white/60">
                <div className="text-sm font-bold">{wasteAnalysis.processBurden.washStepCount}</div>
                <div className="text-[8px] uppercase text-stone-500">Washes</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Principle-specific detail data (from deterministic scores) */}
      {score && Object.keys(score.details).length > 0 && principleNumber !== 1 && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#1C1917' }}>
            Scoring Details
          </h4>
          <div className="space-y-1">
            {score.details._summary != null && (
              <p className="text-sm text-zinc-300 mb-3 italic">
                {String(score.details._summary)}
              </p>
            )}
            {Object.entries(score.details)
              .filter(([key]) => key !== '_summary')
              .map(([key, val]) => (
                <div key={key} className="flex justify-between text-sm py-0.5">
                  <span className="text-zinc-400">{key.replace(/_/g, ' ')}</span>
                  <span className="text-zinc-200 font-mono">{String(val ?? '—')}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Flagged chemicals */}
      {score && score.chemicals_flagged.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#7C2D36' }}>
            Flagged Chemicals
          </h4>
          <div className="flex flex-wrap gap-1">
            {score.chemicals_flagged.map((chem) => {
              const enriched = enrichedChemicals?.find(
                (e) => e.name.toLowerCase() === chem.toLowerCase()
              )
              return (
                <span
                  key={chem}
                  className="text-xs px-2 py-0.5 rounded border"
                  style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#991B1B' }}
                  title={enriched?.ghs_hazards?.map((h) => `${h.code}: ${h.description}`).join(', ')}
                >
                  {chem}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#166534' }}>
            Recommendations ({recommendations.length})
          </h4>
          <p className="text-[10px] italic mb-2" style={{ color: '#A8A29E' }}>
            Recommendations across principles may suggest alternative paths. Each is independently evidence-backed — choose based on your experimental constraints.
          </p>
          <div className="space-y-2">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className="p-3 rounded-lg border"
                style={{ background: rec.isAccepted ? '#F0FDF4' : '#FAFAF8', borderColor: rec.isAccepted ? '#BBF7D0' : '#E7E5E4' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold" style={{ color: '#1C1917' }}>Step {rec.stepNumber}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase"
                    style={{
                      background: rec.severity === 'high' ? '#FEE2E2' : rec.severity === 'medium' ? '#FEF3C7' : '#DCFCE7',
                      color: rec.severity === 'high' ? '#DC2626' : rec.severity === 'medium' ? '#D97706' : '#16a34a',
                    }}
                  >
                    {rec.severity}
                  </span>
                  {rec.primaryBenefit && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: '#D1FAE5', color: '#065F46' }}>
                      {rec.primaryBenefit}
                    </span>
                  )}
                  {rec.isAccepted && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: '#16a34a', color: 'white' }}>
                      Accepted
                    </span>
                  )}
                  {/* Evidence tier badge */}
                  {(rec.evidenceTier ?? 'inferred') === 'sourced' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">
                      Literature-backed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/50">
                      Model-inferred
                    </span>
                  )}
                  {analysisId && (
                    <button
                      title="Copy citation for this recommendation"
                      className="text-zinc-500 hover:text-zinc-300 transition-colors ml-auto"
                      onClick={() => {
                        navigator.clipboard.writeText(buildRecommendationCitationString(rec, analysisId)).catch(() => {})
                      }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  )}
                </div>
                <p className="text-xs mb-1" style={{ color: '#1C1917' }}>
                  <strong>{rec.original.chemical}</strong> → <strong style={{ color: '#166534' }}>{rec.alternative.chemical}</strong>
                </p>
                <p className="text-xs" style={{ color: '#57534E' }}>{rec.original.issue}</p>
                {(rec.evidenceTier ?? 'inferred') === 'sourced' && (
                  <p className="text-xs mt-1" style={{ color: '#2D6A4F' }}>{rec.alternative.rationale}</p>
                )}

                {/* Evidence */}
                {rec.evidence && (
                  <div className="mt-2 pt-2 border-t border-[#E7E5E4]">
                    {rec.evidence.citations.length > 0 && (
                      <div className="space-y-0.5">
                        {rec.evidence.citations.map((cite, ci) => (
                          <p key={ci} className="text-[10px] italic" style={{ color: '#57534E' }}>
                            {cite.citation}
                            {cite.url && (
                              <a href={cite.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#16a34a] hover:underline not-italic font-bold">
                                [Link]
                              </a>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Model reasoning — shown when no literature citations */}
                {(rec.evidenceTier ?? 'inferred') === 'inferred' && rec.alternative.rationale && (
                  <div className="mt-3 rounded-md bg-amber-950/30 border border-amber-800/30 p-3">
                    <p className="text-xs font-medium text-amber-400/80 uppercase tracking-wide mb-1">
                      Model reasoning
                    </p>
                    <p className="text-sm text-zinc-300">{rec.alternative.rationale}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compatibility warnings */}
      {score?.compatibility_warnings && score.compatibility_warnings.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#B45309' }}>
            Warnings
          </h4>
          <ul className="space-y-0.5">
            {score.compatibility_warnings.map((w, i) => (
              <li key={i} className="text-xs" style={{ color: '#92400E' }}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
