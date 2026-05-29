'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { AnalysisResult } from '@/lib/types'
import { buildCitationString, buildBibtexCitation } from '@/lib/citation'
import EvidenceSidebar, { SidebarSection } from './EvidenceSidebar'
import PrincipleSection, { humanSource } from './PrincipleSection'
import UserMenu from './UserMenu'

// Internal data_source values that are pipeline artifacts, not citable sources
const INTERNAL_SOURCE_VALUES = new Set(['cache', 'not_found', 'error', 'unknown', 'none', ''])

const PRINCIPLE_NAMES: Record<number, string> = {
  1: 'Prevention',
  2: 'Atom Economy',
  3: 'Less Hazardous Chemical Syntheses',
  4: 'Designing Safer Chemicals',
  5: 'Safer Solvents and Auxiliaries',
  6: 'Design for Energy Efficiency',
  7: 'Use of Renewable Feedstocks',
  8: 'Reduce Derivatives',
  9: 'Catalysis',
  10: 'Design for Degradation',
  11: 'Real-time Analysis for Pollution Prevention',
  12: 'Inherently Safer Chemistry for Accident Prevention',
}

interface EvidenceAtlasProps {
  analysisId: string
  analysis: AnalysisResult
}

/**
 * Determine which principle sections to show.
 * Show a section only if we have: a deterministic score, recommendations, or enriched chemical data.
 */
function getActivePrinciples(analysis: AnalysisResult): number[] {
  const active = new Set<number>()

  // From deterministic scores
  if (analysis.deterministicScores) {
    for (const s of analysis.deterministicScores.scores) {
      if (s.score >= 0) active.add(s.principle_number)
    }
  }

  // From recommendations
  for (const rec of analysis.recommendations) {
    for (const pn of rec.principleNumbers) {
      active.add(pn)
    }
  }

  // If we have waste analysis, make sure P1 is included
  if (analysis.wasteAnalysis) active.add(1)

  // P4 (Designing Safer Chemicals) is product/molecular design scope — out of range
  // for protocol analysis. We never make recommendations here; exclude always.
  active.delete(4)

  return Array.from(active).sort((a, b) => a - b)
}

export default function EvidenceAtlas({ analysisId, analysis }: EvidenceAtlasProps) {
  const activePrinciples = getActivePrinciples(analysis)
  const metadata = analysis.analysisMetadata

  const [citeOpen, setCiteOpen] = useState(false)
  const [chemicalsOpen, setChemicalsOpen] = useState(false)
  const citeDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (citeDropdownRef.current && !citeDropdownRef.current.contains(e.target as Node)) {
        setCiteOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Build deduplicated flagged chemicals map: chemical → [principle numbers]
  const flaggedChemicalsMap = new Map<string, number[]>()
  if (analysis.deterministicScores) {
    for (const score of analysis.deterministicScores.scores) {
      for (const chem of score.chemicals_flagged) {
        if (!flaggedChemicalsMap.has(chem)) flaggedChemicalsMap.set(chem, [])
        flaggedChemicalsMap.get(chem)!.push(score.principle_number)
      }
    }
  }
  const flaggedChemicals = Array.from(flaggedChemicalsMap.entries()).sort(([a], [b]) => a.localeCompare(b))

  // Build sidebar sections
  const sidebarSections: SidebarSection[] = []

  if (flaggedChemicals.length > 0) {
    sidebarSections.push({ id: 'chemicals', label: 'Chemicals of Concern', hasRecommendations: false })
  }

  sidebarSections.push(
    ...activePrinciples.map((pn) => ({
      id: `p${pn}`,
      label: `P${pn}: ${PRINCIPLE_NAMES[pn] || `Principle ${pn}`}`,
      hasRecommendations: analysis.recommendations.some((r) => r.principleNumbers.includes(pn)),
    }))
  )

  if (analysis.overallAssessment.processComplexity) {
    sidebarSections.push({ id: 'process', label: 'Process Complexity', hasRecommendations: false })
  }

  sidebarSections.push({ id: 'sources', label: 'Data Sources & Methodology', hasRecommendations: false })

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <EvidenceSidebar sections={sidebarSections} />

      {/* Header */}
      <header className="print:hidden flex items-center justify-between px-6 py-4 lg:pl-[240px]">
        <Link
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1C3822' }}
        >
          greenchemistry.ai
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href={`/analyze/${analysisId}`}
            className="text-sm px-3 py-1.5 rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
            style={{ color: '#1C3822', borderColor: '#D6D0C4' }}
          >
            ← Back to Analysis
          </Link>
          <UserMenu />
        </div>
      </header>

      {/* Main content */}
      <main className="lg:pl-[240px] px-6 py-8 max-w-4xl mx-auto lg:mx-0 lg:max-w-none lg:pr-12">
        {/* Page title */}
        <div className="mb-10">
          <h1 className="text-2xl sm:text-3xl font-bold font-[family-name:var(--font-serif)] break-words" style={{ color: '#1C1917' }}>
            GreenChemistry Evidence Atlas
          </h1>
          <p className="text-lg mt-1 font-[family-name:var(--font-serif)]" style={{ color: '#57534E' }}>
            for {analysis.protocolTitle}
          </p>
          {metadata && (
            <div className="flex items-center gap-3 mt-2">
              <span className="text-xs" style={{ color: '#A8A29E' }}>
                GC.ai v{metadata.gcaiVersion} · Generated {new Date(metadata.generatedAt).toLocaleDateString()}
              </span>
              {/* Citation dropdown */}
              <div className="relative inline-block print:hidden" ref={citeDropdownRef}>
                <button
                  onClick={() => setCiteOpen(v => !v)}
                  className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    background: '#1C3822',
                    color: '#F6F3EB',
                    border: 'none',
                  }}
                >
                  CITE
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {citeOpen && (
                  <div className="absolute right-0 mt-1 w-52 rounded shadow-lg z-10" style={{ background: '#F6F3EB', border: '1px solid #D6D0C4' }}>
                    <button
                      className="w-full text-left px-4 py-2 text-xs hover:opacity-70 transition-opacity rounded-t"
                      style={{ color: '#1C1917', fontFamily: 'var(--font-mono)' }}
                      onClick={() => {
                        navigator.clipboard.writeText(buildCitationString(metadata)).catch(() => {})
                        setCiteOpen(false)
                      }}
                    >
                      Copy citation (plain text)
                    </button>
                    <button
                      className="w-full text-left px-4 py-2 text-xs hover:opacity-70 transition-opacity rounded-b border-t"
                      style={{ color: '#1C1917', fontFamily: 'var(--font-mono)', borderColor: '#D6D0C4' }}
                      onClick={() => {
                        navigator.clipboard.writeText(buildBibtexCitation(metadata, analysisId)).catch(() => {})
                        setCiteOpen(false)
                      }}
                    >
                      Copy BibTeX
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Chemicals of Concern — collapsed by default, deduplicated across all principles */}
        {flaggedChemicals.length > 0 && (
          <section id="chemicals" className="scroll-mt-20 mb-12">
            <button
              onClick={() => setChemicalsOpen(v => !v)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <h2 className="text-lg font-bold font-[family-name:var(--font-serif)]" style={{ color: '#1C1917' }}>
                Chemicals of Concern
              </h2>
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#FEF2F2', color: '#991B1B', fontFamily: 'var(--font-mono)' }}>
                {flaggedChemicals.length}
              </span>
              <svg
                className="w-4 h-4 ml-auto transition-transform"
                style={{ color: '#A8A29E', transform: chemicalsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <p className="text-xs mt-1 mb-3" style={{ color: '#78716C' }}>
              Each flagged chemical listed once — see which principles flagged it and its GHS hazard codes.
            </p>
            {chemicalsOpen && (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E7E5E4' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: '#F0EBE1' }}>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider" style={{ color: '#78716C', fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>Chemical</th>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider" style={{ color: '#78716C', fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>Flagged in</th>
                      <th className="text-left px-3 py-2 font-bold uppercase tracking-wider" style={{ color: '#78716C', fontFamily: 'var(--font-mono)', fontSize: '0.6rem' }}>GHS Hazards</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedChemicals.map(([chem, principles], i) => {
                      const enriched = analysis.enrichedChemicals?.find(
                        (e) => e.name.toLowerCase() === chem.toLowerCase()
                      )
                      return (
                        <tr key={chem} style={{ background: i % 2 === 0 ? '#FAFAF8' : '#F6F3EB', borderTop: '1px solid #E7E5E4' }}>
                          <td className="px-3 py-2 font-semibold font-[family-name:var(--font-mono)]" style={{ color: '#991B1B' }}>
                            {chem}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {principles.map(pn => (
                                <a key={pn} href={`#p${pn}`} className="hover:opacity-70 transition-opacity"
                                  style={{ background: '#ECB815', color: '#1C3822', padding: '0.05rem 0.4rem', borderRadius: '3px', fontSize: '0.6rem', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                                  P{pn}
                                </a>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {enriched?.ghs_hazards && enriched.ghs_hazards.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {enriched.ghs_hazards.slice(0, 4).map(h => (
                                  <span
                                    key={h.code}
                                    title={h.description}
                                    className="cursor-help"
                                    style={{
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '0.6rem',
                                      fontWeight: 700,
                                      padding: '0.1rem 0.4rem',
                                      borderRadius: '3px',
                                      background: '#FEF2F2',
                                      color: '#991B1B',
                                      border: '1px solid #FECACA',
                                    }}
                                  >
                                    {h.code}
                                  </span>
                                ))}
                                {enriched.ghs_hazards.length > 4 && (
                                  <span style={{ color: '#A8A29E', fontSize: '0.6rem' }}>
                                    +{enriched.ghs_hazards.length - 4}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: '#A8A29E' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* P4 scope note */}
        <div className="mb-8 p-3 rounded" style={{ background: '#F6F3EB', border: '1px solid #D6D0C4' }}>
          <p className="text-xs italic" style={{ color: '#78716C' }}>
            <strong>Principle 4 (Designing Safer Chemicals)</strong> is not scored in this analysis.
            P4 concerns molecular design — synthesizing products that are inherently less toxic — which is outside the scope of protocol optimization. GreenChemistry.ai analyzes how a synthesis is performed, not what it produces.
          </p>
        </div>

        {/* Principle sections */}
        <div className="space-y-12">
          {activePrinciples.map((pn) => {
            const score = analysis.deterministicScores?.scores.find((s) => s.principle_number === pn)
            const recs = analysis.recommendations.filter((r) => r.principleNumbers.includes(pn))

            return (
              <PrincipleSection
                key={pn}
                principleNumber={pn}
                principleName={PRINCIPLE_NAMES[pn] || `Principle ${pn}`}
                score={score}
                recommendations={recs}
                enrichedChemicals={analysis.enrichedChemicals}
                wasteAnalysis={pn === 1 ? analysis.wasteAnalysis : undefined}
                analysisId={analysisId}
              />
            )
          })}

          {/* Process Complexity section */}
          {analysis.overallAssessment.processComplexity && (
            <section id="process" className="scroll-mt-20">
              <h2 className="text-lg font-bold font-[family-name:var(--font-serif)] mb-4" style={{ color: '#1C1917' }}>
                Process Complexity
              </h2>
              <div className="p-4 rounded-lg" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold" style={{ color: '#1C1917' }}>
                    Complexity Score: {analysis.overallAssessment.processComplexity.score}/10
                  </span>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-bold uppercase"
                    style={{
                      background: analysis.overallAssessment.processComplexity.level === 'low' ? '#F0FDF4'
                        : analysis.overallAssessment.processComplexity.level === 'medium' ? '#FEF3C7' : '#FEF2F2',
                      color: analysis.overallAssessment.processComplexity.level === 'low' ? '#16a34a'
                        : analysis.overallAssessment.processComplexity.level === 'medium' ? '#D97706' : '#DC2626',
                    }}
                  >
                    {analysis.overallAssessment.processComplexity.level}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  {[
                    { label: 'Steps', value: analysis.overallAssessment.processComplexity.metrics.step_count },
                    { label: 'Transfers', value: analysis.overallAssessment.processComplexity.metrics.transfer_count },
                    { label: 'Vessels', value: analysis.overallAssessment.processComplexity.metrics.vessel_count },
                    { label: 'Preps', value: analysis.overallAssessment.processComplexity.metrics.prep_count },
                    { label: 'Purifications', value: analysis.overallAssessment.processComplexity.metrics.purification_count },
                  ].map((m) => (
                    <div key={m.label} className="p-2 rounded" style={{ background: 'rgba(255,255,255,0.6)' }}>
                      <div className="text-lg font-bold" style={{ color: '#1C1917' }}>{m.value}</div>
                      <div className="text-[9px] uppercase" style={{ color: '#A8A29E', fontFamily: 'var(--font-mono)' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] italic" style={{ color: '#A8A29E' }}>
                  Complexity metrics serve as proxies for waste (transfer loss), failure risk, and operator burden.
                </p>
              </div>
            </section>
          )}

          {/* Data Sources & Methodology */}
          <section id="sources" className="scroll-mt-20">
            <h2 className="text-lg font-bold font-[family-name:var(--font-serif)] mb-4" style={{ color: '#1C1917' }}>
              Data Sources & Methodology
            </h2>
            <div className="p-4 rounded-lg space-y-3" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
              {/* Evidence sources from waste analysis */}
              {analysis.wasteAnalysis?.evidenceSources && analysis.wasteAnalysis.evidenceSources.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>
                    Waste Analysis Sources
                  </h4>
                  <p className="text-xs" style={{ color: '#57534E' }}>
                    {analysis.wasteAnalysis.evidenceSources.join(' · ')}
                  </p>
                </div>
              )}

              {/* Scoring data sources */}
              {analysis.deterministicScores && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>
                    Deterministic Scoring
                  </h4>
                  <p className="text-xs" style={{ color: '#57534E' }}>
                    {analysis.deterministicScores.scores.length} principles scored · Grade: {analysis.deterministicScores.grade} · Score: {analysis.deterministicScores.total_score}/{analysis.deterministicScores.max_possible}
                  </p>
                </div>
              )}

              {/* Enriched chemicals summary */}
              {analysis.enrichedChemicals && analysis.enrichedChemicals.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>
                    Chemical Data
                  </h4>
                  <p className="text-xs" style={{ color: '#57534E' }}>
                    {analysis.enrichedChemicals.length} chemicals resolved.
                    {(() => {
                      const sources = [...new Set(
                        analysis.enrichedChemicals
                          .map((c) => c.data_source)
                          .filter((s): s is string => !!s && !INTERNAL_SOURCE_VALUES.has(s))
                      )].map(humanSource)
                      return sources.length > 0 ? ` Data from: ${sources.join(', ')}.` : ''
                    })()}
                  </p>
                </div>
              )}

              {/* Methodology version */}
              {metadata && (
                <div className="pt-2 border-t border-[#E7E5E4]">
                  <p className="text-[10px]" style={{ color: '#A8A29E' }}>
                    Methodology: {metadata.methodologyVersion} · Software: GC.ai v{metadata.gcaiVersion}
                  </p>
                </div>
              )}

              {/* Source hierarchy note */}
              <div className="pt-2 border-t border-[#E7E5E4]">
                <p className="text-[10px] italic" style={{ color: '#A8A29E' }}>
                  Scoring uses structured hazard data (GHS H-codes via PubChem PUG-View) and curated datasets (CHEM21 solvent guide, ACS GCI). SDS references, when available, provide supporting context but are not used as primary scoring inputs.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Print footer */}
      <footer className="hidden print:block border-t px-6 py-4 text-center" style={{ borderColor: '#D6D0C4' }}>
        {metadata && (
          <p className="text-xs" style={{ color: '#78716C' }}>
            {buildCitationString(metadata)}
          </p>
        )}
      </footer>
    </div>
  )
}
