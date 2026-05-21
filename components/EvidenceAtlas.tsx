'use client'

import Link from 'next/link'
import { AnalysisResult } from '@/lib/types'
import { buildCitationString } from '@/lib/citation'
import EvidenceSidebar, { SidebarSection } from './EvidenceSidebar'
import PrincipleSection from './PrincipleSection'
import UserMenu from './UserMenu'

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

  // Skip P4 (Designing Safer Chemicals) unless explicitly scored
  // (it's product design, not protocol analysis)

  return Array.from(active).sort((a, b) => a - b)
}

export default function EvidenceAtlas({ analysisId, analysis }: EvidenceAtlasProps) {
  const activePrinciples = getActivePrinciples(analysis)
  const metadata = analysis.analysisMetadata

  // Build sidebar sections
  const sidebarSections: SidebarSection[] = [
    ...activePrinciples.map((pn) => ({
      id: `p${pn}`,
      label: `P${pn}: ${PRINCIPLE_NAMES[pn] || `Principle ${pn}`}`,
      hasRecommendations: analysis.recommendations.some((r) => r.principleNumbers.includes(pn)),
    })),
  ]

  // Add process complexity if present
  if (analysis.overallAssessment.processComplexity) {
    sidebarSections.push({
      id: 'process',
      label: 'Process Complexity',
      hasRecommendations: false,
    })
  }

  // Always add sources section
  sidebarSections.push({
    id: 'sources',
    label: 'Data Sources & Methodology',
    hasRecommendations: false,
  })

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <EvidenceSidebar sections={sidebarSections} />

      {/* Header */}
      <header className="print:hidden flex items-center justify-between px-6 py-4 lg:pl-[240px]">
        <Link
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1B4332' }}
        >
          greenchemistry.ai
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href={`/analyze/${analysisId}`}
            className="text-sm px-3 py-1.5 rounded-lg border transition-colors font-[family-name:var(--font-mono)]"
            style={{ color: '#1B4332', borderColor: '#D6D0C4' }}
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
              <button
                onClick={() => {
                  if (metadata) {
                    navigator.clipboard.writeText(buildCitationString(metadata)).catch(() => {})
                  }
                }}
                className="print:hidden text-[10px] px-2 py-0.5 rounded border border-[#D6D0C4] hover:bg-white transition-colors font-bold uppercase tracking-tight"
                style={{ color: '#78716C' }}
              >
                Cite
              </button>
            </div>
          )}
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
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      analysis.overallAssessment.processComplexity.level === 'low'
                        ? 'bg-green-100 text-green-700'
                        : analysis.overallAssessment.processComplexity.level === 'medium'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}
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
                    <div key={m.label} className="p-2 rounded bg-white/60">
                      <div className="text-lg font-bold">{m.value}</div>
                      <div className="text-[9px] uppercase text-stone-500">{m.label}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] text-stone-500 italic">
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
                    {analysis.enrichedChemicals.length} chemicals enriched via{' '}
                    {[...new Set(analysis.enrichedChemicals.map((c) => c.data_source).filter(Boolean))].join(', ')}
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
