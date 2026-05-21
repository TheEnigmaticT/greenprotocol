'use client'

import { WasteAnalysis } from '@/lib/types'

function MetricRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs" style={{ color: '#57534E' }}>{label}</span>
      <span className="text-xs font-semibold" style={{ color: '#1C1917' }}>
        {value.toFixed(3)} {unit}
      </span>
    </div>
  )
}

export default function WasteDetailsPanel({ wasteAnalysis }: { wasteAnalysis: WasteAnalysis }) {
  const { directWaste, hazardSegments, liquidBurden, processBurden, upstream, evidenceSources } = wasteAnalysis

  return (
    <div
      className="p-4 rounded-lg border space-y-4"
      style={{ background: '#FAFAF8', borderColor: '#E7E5E4' }}
    >
      {/* Direct Waste */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#1C1917' }}>
          Direct Waste
        </h4>
        <div className="space-y-0.5">
          <MetricRow label="Total waste" value={directWaste.totalWasteKg} unit="kg" />
          <MetricRow label="Solvent waste" value={directWaste.solventWasteKg} unit="kg" />
          <MetricRow label="Non-solvent waste" value={directWaste.nonSolventWasteKg} unit="kg" />
        </div>
      </div>

      {/* Hazard Segments */}
      {hazardSegments && hazardSegments.length > 0 && (
        <div>
          <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#7C2D36' }}>
            Hazard-Segmented Waste
          </h4>
          <div className="space-y-2">
            {hazardSegments.map((seg) => (
              <div key={seg.category} className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-semibold capitalize" style={{ color: '#1C1917' }}>
                    {seg.category}
                  </span>
                  <span className="text-[10px] ml-1" style={{ color: '#78716C' }}>
                    ({seg.chemicalsCount} chemical{seg.chemicalsCount !== 1 ? 's' : ''})
                  </span>
                  {seg.chemicals.length > 0 && (
                    <p className="text-[10px]" style={{ color: '#A8A29E' }}>
                      {seg.chemicals.slice(0, 5).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-xs font-semibold shrink-0" style={{ color: '#1C1917' }}>
                  {seg.totalKg.toFixed(3)} kg
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liquid Burden */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#1C1917' }}>
          Liquid Burden
        </h4>
        <div className="space-y-0.5">
          <MetricRow label="Liquid handled" value={liquidBurden.totalLiquidHandledKg} unit="kg" />
          <MetricRow label="Liquid discarded (est.)" value={liquidBurden.totalLiquidDiscardedKg} unit="kg" />
        </div>
      </div>

      {/* Process Burden */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#1C1917' }}>
          Process Burden
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-2 rounded bg-white/60">
            <div className="text-lg font-bold">{processBurden.transferCount}</div>
            <div className="text-[9px] uppercase text-stone-500">Transfers</div>
          </div>
          <div className="p-2 rounded bg-white/60">
            <div className="text-lg font-bold">{processBurden.vesselCount}</div>
            <div className="text-[9px] uppercase text-stone-500">Vessels</div>
          </div>
          <div className="p-2 rounded bg-white/60">
            <div className="text-lg font-bold">{processBurden.purificationCount}</div>
            <div className="text-[9px] uppercase text-stone-500">Purifications</div>
          </div>
          <div className="p-2 rounded bg-white/60">
            <div className="text-lg font-bold">{processBurden.washStepCount}</div>
            <div className="text-[9px] uppercase text-stone-500">Wash Steps</div>
          </div>
        </div>
      </div>

      {/* Upstream / LCA */}
      {upstream && (
        <p className="text-[10px] italic" style={{ color: '#A8A29E' }}>
          {upstream.notes}
        </p>
      )}

      {/* Evidence Sources */}
      {evidenceSources && evidenceSources.length > 0 && (
        <div className="pt-2 border-t border-[#E7E5E4]">
          <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: '#78716C' }}>
            Data sources:{' '}
          </span>
          <span className="text-[10px]" style={{ color: '#A8A29E' }}>
            {evidenceSources.join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}
