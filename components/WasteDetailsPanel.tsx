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
  const {
    directWaste,
    hazardSegments,
    liquidBurden,
    processBurden,
    upstream,
    evidenceSources,
    regulatoryContext,
  } = wasteAnalysis
  const reg = regulatoryContext
  const hasReg = !!reg && reg.chemicals.length > 0
  const wasteUnavailable = wasteAnalysis.version !== 'waste-analysis/v2' || wasteAnalysis.availability?.actualWasteMass === 'unavailable' || wasteAnalysis.summary.confidence === 'unavailable' || wasteAnalysis.summary.wasteImpactScore < 0

  return (
    <div className="px-4 pb-4">
      {wasteUnavailable ? (
        <>
          <Section label="Waste estimate">
            <p className="text-[11px]" style={{ color: '#57534E' }}>Actual waste generation is unknown.</p>
            <p className="text-[10px] italic mt-1" style={{ color: '#A8A29E' }}>{wasteAnalysis.availability?.reason}</p>
          </Section>
          <Section label="Observed input inventory">
            {wasteAnalysis.observedInputInventory?.knownInputMassKg != null ? (
              <Metric label={`Known input mass · ${wasteAnalysis.observedInputInventory.massCoverage} coverage`} value={`${wasteAnalysis.observedInputInventory.knownInputMassKg.toFixed(3)} kg`} />
            ) : (
              <p className="text-[11px]" style={{ color: '#57534E' }}>No input mass was available.</p>
            )}
            <p className="text-[10px] italic mt-1" style={{ color: '#A8A29E' }}>Input inventory is not a waste total or mass balance.</p>
          </Section>
        </>
      ) : (
        <Section label="Direct waste">
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Total" value={kg(directWaste.totalWasteKg ?? 0)} />
            <Metric label="Solvent" value={kg(directWaste.solventWasteKg ?? 0)} />
            <Metric label="Non-solvent" value={kg(directWaste.nonSolventWasteKg ?? 0)} />
          </div>
        </Section>
      )}

      {/* Hazard segments */}
      {hazardSegments.length > 0 && (
        <Section label={wasteUnavailable ? 'Hazard flags (not waste quantities)' : 'Hazard-segmented waste'}>
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
                  {seg.totalKg == null ? 'Mass unavailable' : wasteUnavailable ? `${kg(seg.totalKg)} input` : kg(seg.totalKg)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!wasteUnavailable && (
        <Section label="Liquid burden">
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Handled" value={kg(liquidBurden.totalLiquidHandledKg ?? 0)} />
            <Metric label="Discarded (est.)" value={kg(liquidBurden.totalLiquidDiscardedKg ?? 0)} />
          </div>
        </Section>
      )}

      {/* Process burden */}
      <Section label="Process burden">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <Metric label="Transfers" value={String(processBurden.transferCount)} />
          <Metric label="Vessels" value={String(processBurden.vesselCount)} />
          <Metric label="Purifications" value={String(processBurden.purificationCount)} />
          <Metric label="Wash steps" value={String(processBurden.washStepCount)} />
          <Metric label="Complexity" value={String(processBurden.workflowComplexity)} />
        </div>
        {wasteUnavailable && <p className="text-[10px] italic mt-2" style={{ color: '#A8A29E' }}>Observed workflow indicators; they do not quantify waste.</p>}
      </Section>

      {/* Regulatory context — US RCRA (compliance context, not scoring) */}
      {hasReg && reg && (
        <Section label="Regulatory context · US RCRA">
          <ul className="space-y-2">
            {reg.chemicals.map((c) => (
              <li key={c.chemical} className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: '#1C1917' }}>
                    {c.chemical}
                  </span>
                  {c.cas && (
                    <span
                      className="text-[10px]"
                      style={{ color: '#A8A29E', fontFamily: 'var(--font-mono)' }}
                    >
                      CAS {c.cas}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {c.signals.map((s) => (
                    <span
                      key={s.code}
                      title={`${s.label} — ${s.basis}`}
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: '#F0EBE1', color: '#78716C', fontFamily: 'var(--font-mono)' }}
                    >
                      {s.code}
                      {s.regulatoryLevel ? ` · ${s.regulatoryLevel}` : ''}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] mt-2" style={{ color: '#A8A29E' }}>
            {reg.chemicalsWithSignals} of {reg.chemicalsScreened} chemicals matched federal codes.
            {!reg.coverageComplete && ' Coverage is a curated subset of common lab chemicals.'}
          </p>
          <p className="text-[10px] italic mt-1" style={{ color: '#A8A29E' }}>
            {reg.disclaimer}
          </p>
        </Section>
      )}

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
