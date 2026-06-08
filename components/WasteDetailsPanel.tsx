'use client'

import { WasteAnalysis } from '@/lib/types'

const HAZARD_LABELS: Record<string, string> = {
  toxic: 'Acute toxicity',
  cmr: 'CMR (carcinogen / mutagen / reprotoxic)',
  flammable: 'Flammable',
  corrosive: 'Corrosive',
  environmental: 'Environmental hazard',
}

function hazardLabel(category: string): string {
  return HAZARD_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1)
}

function kg(n: number): string {
  if (n === 0) return '0 kg'
  if (n < 0.01) return '<0.01 kg'
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-3 mt-3 border-t" style={{ borderColor: '#E7E5E4' }}>
      <p
        className="text-[10px] font-bold uppercase tracking-wider mb-2"
        style={{ color: '#78716C', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px]" style={{ color: '#57534E' }}>
        {label}
      </p>
      <p
        className="text-sm font-semibold truncate"
        style={{ color: '#1C1917', fontFamily: 'var(--font-mono)' }}
      >
        {value}
      </p>
    </div>
  )
}

export default function WasteDetailsPanel({ wasteAnalysis }: { wasteAnalysis: WasteAnalysis }) {
  const { directWaste, hazardSegments, liquidBurden, processBurden, upstream, evidenceSources } =
    wasteAnalysis

  return (
    <div className="px-4 pb-4">
      {/* Direct waste */}
      <Section label="Direct waste">
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Total" value={kg(directWaste.totalWasteKg)} />
          <Metric label="Solvent" value={kg(directWaste.solventWasteKg)} />
          <Metric label="Non-solvent" value={kg(directWaste.nonSolventWasteKg)} />
        </div>
      </Section>

      {/* Hazard segments */}
      {hazardSegments.length > 0 && (
        <Section label="Hazard-segmented waste">
          <ul className="space-y-2">
            {hazardSegments.map((seg) => (
              <li key={seg.category} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span
                    className="inline-block text-[10px] px-2 py-0.5 rounded font-semibold mb-1"
                    style={{ background: '#F0EBE1', color: '#78716C' }}
                  >
                    {hazardLabel(seg.category)}
                  </span>
                  <p className="text-[11px] truncate" style={{ color: '#A8A29E' }}>
                    {seg.chemicals.join(', ')}
                  </p>
                </div>
                <span
                  className="text-sm font-semibold shrink-0"
                  style={{ color: '#1C1917', fontFamily: 'var(--font-mono)' }}
                >
                  {kg(seg.totalKg)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Liquid burden */}
      <Section label="Liquid burden">
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Handled" value={kg(liquidBurden.totalLiquidHandledKg)} />
          <Metric label="Discarded (est.)" value={kg(liquidBurden.totalLiquidDiscardedKg)} />
        </div>
      </Section>

      {/* Process burden */}
      <Section label="Process burden">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <Metric label="Transfers" value={String(processBurden.transferCount)} />
          <Metric label="Vessels" value={String(processBurden.vesselCount)} />
          <Metric label="Purifications" value={String(processBurden.purificationCount)} />
          <Metric label="Wash steps" value={String(processBurden.washStepCount)} />
          <Metric label="Complexity" value={String(processBurden.workflowComplexity)} />
        </div>
      </Section>

      {/* Evidence + upstream */}
      <Section label="Evidence">
        {evidenceSources.length > 0 ? (
          <ul className="space-y-1">
            {evidenceSources.map((src) => (
              <li key={src} className="text-[11px] flex items-start gap-1.5" style={{ color: '#57534E' }}>
                <span style={{ color: '#16a34a' }}>•</span>
                {src}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px]" style={{ color: '#A8A29E' }}>
            No structured evidence sources recorded for this analysis.
          </p>
        )}
        {!upstream.lcaAvailable && (
          <p className="text-[10px] italic mt-2" style={{ color: '#A8A29E' }}>
            {upstream.notes}
          </p>
        )}
      </Section>
    </div>
  )
}
