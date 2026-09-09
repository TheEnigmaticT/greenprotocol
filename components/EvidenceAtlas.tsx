'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AnalysisResult, Recommendation } from '@/lib/types'
import { buildCitationString, buildBibtexCitation, formatCitationACS } from '@/lib/citation'
import PrincipleSection, { humanSource } from './PrincipleSection'
import AppShell from './AppShell'
import { buildQuietGradeLine } from '@/lib/quiet-grade'

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

const PN_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: '#DCFCE7', text: '#15803d' },
  2: { bg: '#DCFCE7', text: '#15803d' },
  3: { bg: '#DCFCE7', text: '#15803d' },
  4: { bg: '#DCFCE7', text: '#15803d' },
  5: { bg: '#DBEAFE', text: '#1d4ed8' },
  6: { bg: '#DBEAFE', text: '#1d4ed8' },
  7: { bg: '#DBEAFE', text: '#1d4ed8' },
  8: { bg: '#DBEAFE', text: '#1d4ed8' },
  9: { bg: '#EDE9FE', text: '#7e22ce' },
  10: { bg: '#EDE9FE', text: '#7e22ce' },
  11: { bg: '#EDE9FE', text: '#7e22ce' },
  12: { bg: '#EDE9FE', text: '#7e22ce' },
}


function chemMatches(rec: Recommendation, chemical: string): boolean {
  const target = chemical.trim().toLowerCase()
  if (!target) return false
  return (
    rec.original.chemical.toLowerCase() === target
    || rec.alternative.chemical.toLowerCase() === target
  )
}

function RelatedPrescriptions({ analysis, chemical }: { analysis: AnalysisResult; chemical: string }) {
  const related = analysis.recommendations.filter(rec => chemMatches(rec, chemical))

  return (
    <div>
      <p className="m-0 mb-2 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#57534E' }}>
        Related prescriptions
      </p>
      {related.length === 0 ? (
        <p className="m-0 text-sm font-[family-name:var(--font-sans)]" style={{ color: '#A8A29E' }}>
          No related prescriptions for this chemical.
        </p>
      ) : (
        <div className="space-y-3">
          {related.map((rec, i) => {
            const tier = rec.evidenceTier ?? ((rec.evidence?.citations.length ?? 0) > 0 ? 'sourced' : 'inferred')
            return (
              <article
                key={rec.id ?? `${rec.stepNumber}-${rec.original.chemical}-${i}`}
                className="rounded-lg border p-3 space-y-2"
                style={{ background: '#FFFFFF', borderColor: '#E7E5E4' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold font-[family-name:var(--font-mono)]" style={{ color: '#1C1917' }}>
                    Step {rec.stepNumber}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase"
                    style={{
                      background: rec.severity === 'high' ? '#FEE2E2' : rec.severity === 'medium' ? '#FEF3C7' : '#DCFCE7',
                      color: rec.severity === 'high' ? '#DC2626' : rec.severity === 'medium' ? '#D97706' : '#16a34a',
                    }}
                  >
                    {rec.severity}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                    style={{
                      background: tier === 'sourced' ? '#DCFCE7' : '#FEF3C7',
                      color: tier === 'sourced' ? '#166534' : '#92400E',
                    }}
                  >
                    {tier === 'sourced' ? 'Literature-backed' : 'Model-inferred'}
                  </span>
                </div>
                <p className="m-0 text-sm font-[family-name:var(--font-sans)]" style={{ color: '#1C1917' }}>
                  Replace{' '}
                  <strong className="font-[family-name:var(--font-mono)]">{rec.original.chemical}</strong>
                  {' '}with{' '}
                  <strong className="font-[family-name:var(--font-mono)]" style={{ color: '#166534' }}>{rec.alternative.chemical}</strong>.
                </p>
                {rec.original.issue && (
                  <p className="m-0 text-xs font-[family-name:var(--font-sans)]" style={{ color: '#57534E' }}>
                    {rec.original.issue}
                  </p>
                )}
                {rec.alternative.rationale && (
                  <p className="m-0 text-sm font-[family-name:var(--font-sans)] leading-relaxed" style={{ color: '#1C1917' }}>
                    {rec.alternative.rationale}
                  </p>
                )}
                {rec.evidence?.citations && rec.evidence.citations.length > 0 && (
                  <div className="pt-2 border-t space-y-1" style={{ borderColor: '#E7E5E4' }}>
                    <p className="m-0 text-[9px] font-bold uppercase tracking-wider" style={{ color: '#78716C', fontFamily: 'var(--font-mono)' }}>
                      Citations
                    </p>
                    {rec.evidence.citations.map((cite, ci) => (
                      <p key={ci} className="m-0 text-[10px] font-[family-name:var(--font-mono)] leading-relaxed" style={{ color: '#57534E' }}>
                        {formatCitationACS(cite)}
                        {cite.url && (
                          <>
                            {' '}
                            <a href={cite.url} target="_blank" rel="noopener noreferrer" className="text-[#16a34a] hover:underline font-semibold">
                              ↗
                            </a>
                          </>
                        )}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function getActivePrinciples(analysis: AnalysisResult): number[] {
  const active = new Set<number>()
  if (analysis.deterministicScores) {
    for (const s of analysis.deterministicScores.scores) {
      if (s.score >= 0) active.add(s.principle_number)
    }
  }
  for (const rec of analysis.recommendations) {
    for (const pn of rec.principleNumbers) active.add(pn)
  }
  if (analysis.wasteAnalysis) active.add(1)
  active.delete(4)
  return Array.from(active).sort((a, b) => a - b)
}

type Mode = 'chemicals' | 'principles'

interface EvidenceAtlasProps {
  analysisId: string
  analysis: AnalysisResult
}

export default function EvidenceAtlas({ analysisId, analysis }: EvidenceAtlasProps) {
  const activePrinciples = getActivePrinciples(analysis)
  const metadata = analysis.analysisMetadata
  const quietGrade = buildQuietGradeLine(analysis)

  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>('principles')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedPrinciple, setSelectedPrinciple] = useState<number | null>(activePrinciples[0] ?? null)
  const [selectedChemical, setSelectedChemical] = useState<string | null>(null)
  const [citeOpen, setCiteOpen] = useState(false)
  const citeDropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const deepLinkApplied = useRef(false)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (citeDropdownRef.current && !citeDropdownRef.current.contains(e.target as Node)) {
        setCiteOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (deepLinkApplied.current) return
    const chem = searchParams.get('chem')?.trim()
    const pRaw = searchParams.get('p')?.trim()
    if (chem) {
      queueMicrotask(() => {
        setMode('chemicals')
        setSelectedChemical(chem)
      })
      deepLinkApplied.current = true
      return
    }
    if (pRaw) {
      const pn = Number(pRaw)
      if (Number.isFinite(pn) && pn >= 1 && pn <= 12) {
        queueMicrotask(() => {
          setMode('principles')
          setSelectedPrinciple(pn)
        })
        deepLinkApplied.current = true
      }
    }
  }, [searchParams])

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const flaggedChemicalsMap = useMemo(() => {
    const map = new Map<string, number[]>()
    if (analysis.deterministicScores) {
      for (const score of analysis.deterministicScores.scores) {
        for (const chem of score.chemicals_flagged) {
          if (!map.has(chem)) map.set(chem, [])
          map.get(chem)!.push(score.principle_number)
        }
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [analysis.deterministicScores])

  useEffect(() => {
    if (!selectedChemical && flaggedChemicalsMap.length > 0) {
      queueMicrotask(() => setSelectedChemical(flaggedChemicalsMap[0][0]))
    }
  }, [flaggedChemicalsMap, selectedChemical])

  const q = query.trim().toLowerCase()

  const filteredPrinciples = useMemo(() => {
    const all = analysis.deterministicScores?.scores
      ?.slice()
      .sort((a, b) => a.principle_number - b.principle_number)
      .map(s => s.principle_number)
      ?? activePrinciples
    const unique = Array.from(new Set([...all, ...activePrinciples])).sort((a, b) => a - b)
    if (!q) return unique
    return unique.filter(pn => {
      const name = PRINCIPLE_NAMES[pn] || ''
      const score = analysis.deterministicScores?.scores.find(s => s.principle_number === pn)
      const hay = `p${pn} ${name} ${(score?.chemicals_flagged || []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [analysis, activePrinciples, q])

  const filteredChemicals = useMemo(() => {
    if (!q) return flaggedChemicalsMap
    return flaggedChemicalsMap.filter(([chem, principles]) => {
      const enriched = analysis.enrichedChemicals?.find(e => e.name.toLowerCase() === chem.toLowerCase())
      const codes = enriched?.ghs_hazards?.map(h => h.code).join(' ') || ''
      return `${chem} ${principles.map(p => `p${p}`).join(' ')} ${codes}`.toLowerCase().includes(q)
    })
  }, [flaggedChemicalsMap, analysis.enrichedChemicals, q])

  const openPrinciple = (pn: number) => {
    setMode('principles')
    setSelectedPrinciple(pn)
  }

  const openChemical = (chem: string) => {
    setMode('chemicals')
    setSelectedChemical(chem)
  }

  const selectedScore = selectedPrinciple != null
    ? analysis.deterministicScores?.scores.find(s => s.principle_number === selectedPrinciple)
    : undefined

  const selectedChemEntry = selectedChemical
    ? flaggedChemicalsMap.find(([c]) => c === selectedChemical)
    : undefined
  const selectedEnriched = selectedChemical
    ? analysis.enrichedChemicals?.find(e => e.name.toLowerCase() === selectedChemical.toLowerCase())
    : undefined

  return (
    <AppShell analysisId={analysisId} activeTab="atlas">
      <main id="main-content" className="mx-auto max-w-6xl px-4 sm:px-6 py-7 space-y-5">
        <div className="atlas-mast">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 font-[family-name:var(--font-serif)] text-[24px] sm:text-[28px] font-bold leading-snug break-words" style={{ color: '#0D1F16' }}>
                {analysis.protocolTitle}
              </h1>
              <p className="mt-2 mb-0 font-[family-name:var(--font-mono)] text-xs font-medium tabular-nums" style={{ color: '#A8A29E' }} role="status">
                {quietGrade}
              </p>
            </div>
            {metadata && (
              <div className="relative print:hidden shrink-0" ref={citeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setCiteOpen(v => !v)}
                  className="inline-flex items-center gap-1.5 min-h-9 px-3 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-wider uppercase"
                  style={{ background: '#1C3822', color: '#F6F3EB' }}
                >
                  Cite
                </button>
                {citeOpen && (
                  <div className="absolute right-0 mt-1 w-52 rounded shadow-lg z-10" style={{ background: '#F6F3EB', border: '1px solid #D6D0C4' }}>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 text-xs hover:opacity-70"
                      style={{ color: '#1C1917', fontFamily: 'var(--font-mono)' }}
                      onClick={() => {
                        navigator.clipboard.writeText(buildCitationString(metadata)).catch(() => {})
                        setCiteOpen(false)
                      }}
                    >
                      Copy citation (plain text)
                    </button>
                    <button
                      type="button"
                      className="w-full text-left px-4 py-2 text-xs hover:opacity-70 border-t"
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
            )}
          </div>

          <div className="mt-[18px]">
            <div className={`flex ${searchOpen ? 'flex-col sm:flex-row' : 'flex-row'} items-stretch sm:items-center gap-0 sm:gap-0 w-full sm:w-fit max-w-full`}>
              <div
                className="grid grid-cols-[1fr_1fr_auto] overflow-hidden rounded-lg border w-full sm:w-[420px] max-w-full"
                style={{ borderColor: '#D6D0C4', background: '#FAFAF8' }}
                role="tablist"
                aria-label="Atlas mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'chemicals'}
                  onClick={() => setMode('chemicals')}
                  className="inline-flex items-center justify-center min-h-11 px-3.5 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-[0.12em] uppercase border-r"
                  style={{
                    borderColor: '#D6D0C4',
                    background: mode === 'chemicals' ? '#1C3822' : '#FAFAF8',
                    color: mode === 'chemicals' ? '#F6F3EB' : '#57534E',
                  }}
                >
                  Chemicals
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'principles'}
                  onClick={() => setMode('principles')}
                  className="inline-flex items-center justify-center min-h-11 px-3.5 font-[family-name:var(--font-mono)] text-[11px] font-bold tracking-[0.12em] uppercase border-r"
                  style={{
                    borderColor: '#D6D0C4',
                    background: mode === 'principles' ? '#1C3822' : '#FAFAF8',
                    color: mode === 'principles' ? '#F6F3EB' : '#57534E',
                  }}
                >
                  Principles
                </button>
                <button
                  type="button"
                  aria-expanded={searchOpen}
                  aria-label="Toggle search"
                  onClick={() => setSearchOpen(v => !v)}
                  className="inline-flex items-center justify-center min-h-11 min-w-12 px-3 text-[15px]"
                  style={{
                    background: searchOpen ? '#2D4A3A' : '#FAFAF8',
                    color: searchOpen ? '#ECB815' : '#57534E',
                  }}
                >
                  🔍
                </button>
              </div>

              {searchOpen && (
                <div className="flex items-center gap-2 mt-2 sm:mt-0 sm:ml-2.5 flex-1 min-w-0 w-full sm:w-[300px]">
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search chemicals, principles…"
                    className="w-full min-h-11 px-3.5 rounded border font-[family-name:var(--font-mono)] text-[13px] font-medium"
                    style={{ borderColor: '#ECB815', background: '#FAFAF8', color: '#1C1917' }}
                  />
                  <button
                    type="button"
                    aria-label="Close search"
                    onClick={() => { setSearchOpen(false); setQuery('') }}
                    className="inline-flex items-center justify-center min-w-11 min-h-11 rounded border"
                    style={{ borderColor: '#D6D0C4', background: '#FAFAF8', color: '#57534E' }}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
            {q && (
              <p className="mt-2.5 mb-0 font-[family-name:var(--font-mono)] text-[11px] font-medium" style={{ color: '#78716C' }}>
                Showing matches for “{query.trim()}”
                <button
                  type="button"
                  className="ml-1.5 underline font-bold uppercase tracking-wider"
                  style={{ color: '#1C3822' }}
                  onClick={() => setQuery('')}
                >
                  Clear
                </button>
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Index pane */}
          <aside className="lg:col-span-5 min-w-0">
            {mode === 'principles' ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <div>
                    <p className="m-0 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>Index</p>
                    <h2 className="m-0 mt-1 font-[family-name:var(--font-serif)] text-xl font-bold" style={{ color: '#1C1917' }}>
                      {filteredPrinciples.length} principles
                    </h2>
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-xs" style={{ color: '#78716C' }}>Lower = greener</span>
                </div>
                <ul className="m-0 p-0 list-none space-y-1">
                  {filteredPrinciples.map(pn => {
                    const score = analysis.deterministicScores?.scores.find(s => s.principle_number === pn)
                    const isActive = selectedPrinciple === pn
                    const unavailable = !score || score.score < 0 || pn === 4
                    const colors = PN_COLORS[pn] || PN_COLORS[1]
                    const flagged = score?.chemicals_flagged?.length ?? 0
                    return (
                      <li key={pn}>
                        <button
                          type="button"
                          onClick={() => setSelectedPrinciple(pn)}
                          className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded min-h-11 min-w-0"
                          style={{
                            background: isActive ? '#F5F0E8' : 'transparent',
                            boxShadow: isActive ? 'inset 3px 0 0 #ECB815' : undefined,
                          }}
                        >
                          <span
                            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-bold font-[family-name:var(--font-mono)]"
                            style={{ background: colors.bg, color: colors.text }}
                          >
                            P{pn}
                          </span>
                          <span className="flex-1 min-w-0 truncate font-[family-name:var(--font-sans)] text-sm" style={{ color: '#1C1917' }}>
                            {PRINCIPLE_NAMES[pn] || `Principle ${pn}`}
                          </span>
                          <span className="shrink-0 font-[family-name:var(--font-mono)] text-xs tabular-nums" style={{ color: unavailable ? '#A8A29E' : '#DC2626' }}>
                            {pn === 4 ? 'N/A out of scope' : unavailable ? 'N/A' : `${score!.score.toFixed(1)}${flagged ? ` · ${flagged} flagged` : ''}`}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <div>
                    <p className="m-0 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>Index</p>
                    <h2 className="m-0 mt-1 font-[family-name:var(--font-serif)] text-xl font-bold" style={{ color: '#1C1917' }}>
                      Chemicals of Concern
                    </h2>
                  </div>
                  <span className="font-[family-name:var(--font-mono)] text-xs" style={{ color: '#78716C' }}>
                    {filteredChemicals.length}
                  </span>
                </div>
                {filteredChemicals.length === 0 ? (
                  <p className="text-sm font-[family-name:var(--font-sans)]" style={{ color: '#78716C' }}>
                    No flagged chemicals in this analysis.
                  </p>
                ) : (
                  <ul className="m-0 p-0 list-none space-y-2">
                    {filteredChemicals.map(([chem, principles]) => {
                      const enriched = analysis.enrichedChemicals?.find(e => e.name.toLowerCase() === chem.toLowerCase())
                      const isActive = selectedChemical === chem
                      return (
                        <li key={chem}>
                          <button
                            type="button"
                            onClick={() => setSelectedChemical(chem)}
                            className="w-full text-left rounded-lg border p-3 min-w-0"
                            style={{
                              background: isActive ? '#FAFAF8' : '#FAFAF8',
                              borderColor: isActive ? '#ECB815' : '#D6D0C4',
                              boxShadow: isActive ? 'inset 3px 0 0 #ECB815' : undefined,
                            }}
                          >
                            <div className="font-[family-name:var(--font-mono)] text-sm font-semibold break-words" style={{ color: '#991B1B' }}>
                              {chem}
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {principles.map(pn => (
                                <span
                                  key={pn}
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded font-[family-name:var(--font-mono)]"
                                  style={{ background: '#ECB815', color: '#1C3822' }}
                                >
                                  P{pn}
                                </span>
                              ))}
                            </div>
                            {enriched?.ghs_hazards && enriched.ghs_hazards.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {enriched.ghs_hazards.slice(0, 4).map(h => (
                                  <span
                                    key={h.code}
                                    title={h.description}
                                    className="font-[family-name:var(--font-mono)] text-[10px] font-bold px-1.5 py-0.5 rounded"
                                    style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}
                                  >
                                    {h.code}
                                  </span>
                                ))}
                              </div>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </aside>

          {/* Dossier pane */}
          <section className="lg:col-span-7 min-w-0">
            {mode === 'principles' && selectedPrinciple != null ? (
              <div className="rounded-lg border p-4 sm:p-5" style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}>
                {selectedPrinciple === 4 ? (
                  <p className="text-sm italic font-[family-name:var(--font-sans)]" style={{ color: '#78716C' }}>
                    Principle 4 (Designing Safer Chemicals) is not scored in this analysis. P4 concerns molecular design — outside the scope of protocol optimization.
                  </p>
                ) : (
                  <>
                    {selectedScore?.chemicals_flagged?.length ? (
                      <div className="mb-4">
                        <p className="m-0 mb-2 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#57534E' }}>
                          Chemicals of concern for this principle
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedScore.chemicals_flagged.map(chem => (
                            <button
                              key={chem}
                              type="button"
                              onClick={() => openChemical(chem)}
                              className="text-left rounded border px-3 py-2 min-h-11 font-[family-name:var(--font-mono)] text-xs font-semibold"
                              style={{ borderColor: '#FECACA', background: '#FEF2F2', color: '#991B1B' }}
                            >
                              {chem} →
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <PrincipleSection
                      principleNumber={selectedPrinciple}
                      principleName={PRINCIPLE_NAMES[selectedPrinciple] || `Principle ${selectedPrinciple}`}
                      score={selectedScore}
                      recommendations={analysis.recommendations.filter(r => r.principleNumbers.includes(selectedPrinciple))}
                      enrichedChemicals={analysis.enrichedChemicals}
                      wasteAnalysis={selectedPrinciple === 1 ? analysis.wasteAnalysis : undefined}
                      analysisId={analysisId}
                    />
                  </>
                )}
              </div>
            ) : mode === 'chemicals' && selectedChemEntry ? (
              <div className="rounded-lg border p-4 sm:p-5 space-y-4" style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}>
                <div>
                  <p className="m-0 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
                    Chemical dossier
                  </p>
                  <h2 className="m-0 mt-1 font-[family-name:var(--font-mono)] text-xl font-bold break-words" style={{ color: '#991B1B' }}>
                    {selectedChemEntry[0]}
                  </h2>
                </div>
                {selectedEnriched?.ghs_hazards && selectedEnriched.ghs_hazards.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedEnriched.ghs_hazards.map(h => (
                      <span
                        key={h.code}
                        title={h.description}
                        className="font-[family-name:var(--font-mono)] text-[11px] font-bold px-2 py-1 rounded"
                        style={{ background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA' }}
                      >
                        {h.code}
                      </span>
                    ))}
                  </div>
                )}
                {selectedEnriched?.ghs_hazards?.[0]?.description && (
                  <p className="m-0 text-sm font-[family-name:var(--font-sans)] leading-relaxed" style={{ color: '#1C1917' }}>
                    {selectedEnriched.ghs_hazards[0].description}
                  </p>
                )}
                <div>
                  <p className="m-0 mb-2 font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#57534E' }}>
                    Flagged in principles
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedChemEntry[1].map(pn => (
                      <button
                        key={pn}
                        type="button"
                        onClick={() => openPrinciple(pn)}
                        className="inline-flex items-center justify-center min-h-11 px-3 rounded border font-[family-name:var(--font-mono)] text-xs font-bold"
                        style={{ background: '#ECB815', color: '#1C3822', borderColor: '#ECB815' }}
                      >
                        P{pn}: {PRINCIPLE_NAMES[pn]?.split(' ').slice(0, 3).join(' ') || pn} →
                      </button>
                    ))}
                  </div>
                </div>
                <RelatedPrescriptions analysis={analysis} chemical={selectedChemEntry[0]} />
                {selectedEnriched?.data_source && !INTERNAL_SOURCE_VALUES.has(selectedEnriched.data_source) && (
                  <p className="text-xs font-[family-name:var(--font-mono)]" style={{ color: '#A8A29E' }}>
                    Source: {humanSource(selectedEnriched.data_source)}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border p-5" style={{ background: '#FAFAF8', borderColor: '#D6D0C4' }}>
                <p className="m-0 text-sm font-[family-name:var(--font-sans)]" style={{ color: '#78716C' }}>
                  Select an item from the index to open its dossier.
                </p>
              </div>
            )}

            {/* Methodology footer kept reachable */}
            <details className="mt-6 print:hidden">
              <summary className="cursor-pointer font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: '#9D8026' }}>
                Data sources &amp; methodology
              </summary>
              <div className="mt-3 p-4 rounded-lg space-y-3" style={{ background: '#FAFAF8', border: '1px solid #E7E5E4' }}>
                {analysis.wasteAnalysis?.evidenceSources && analysis.wasteAnalysis.evidenceSources.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>Waste Analysis Sources</h4>
                    <p className="text-xs m-0" style={{ color: '#57534E' }}>{analysis.wasteAnalysis.evidenceSources.join(' · ')}</p>
                  </div>
                )}
                {analysis.deterministicScores && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>Deterministic Scoring</h4>
                    <p className="text-xs m-0" style={{ color: '#57534E' }}>
                      {analysis.deterministicScores.scores.length} principles scored · Grade: {analysis.deterministicScores.grade} · Score: {analysis.deterministicScores.total_score}/{analysis.deterministicScores.max_possible}
                    </p>
                  </div>
                )}
                {analysis.enrichedChemicals && analysis.enrichedChemicals.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#1C1917' }}>Chemical Data</h4>
                    <p className="text-xs m-0" style={{ color: '#57534E' }}>
                      {analysis.enrichedChemicals.length} chemicals resolved.
                      {(() => {
                        const sources = [...new Set(
                          analysis.enrichedChemicals
                            .map(c => c.data_source)
                            .filter((s): s is string => !!s && !INTERNAL_SOURCE_VALUES.has(s)),
                        )].map(humanSource)
                        return sources.length > 0 ? ` Data from: ${sources.join(', ')}.` : ''
                      })()}
                    </p>
                  </div>
                )}
                {metadata && (
                  <p className="text-[10px] m-0 pt-2 border-t" style={{ color: '#A8A29E', borderColor: '#E7E5E4' }}>
                    Methodology: {metadata.methodologyVersion} · Software: GC.ai v{metadata.gcaiVersion}
                  </p>
                )}
              </div>
            </details>
          </section>
        </div>
      </main>

      <footer className="hidden print:block border-t px-6 py-4 text-center" style={{ borderColor: '#D6D0C4' }}>
        {metadata && (
          <p className="text-xs" style={{ color: '#78716C' }}>
            {buildCitationString(metadata)}
          </p>
        )}
      </footer>
    </AppShell>
  )
}
