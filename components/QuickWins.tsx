'use client'

import React from 'react'
import { Recommendation } from '@/lib/types'

interface QuickWinProps {
  recommendations: Recommendation[]
}

export default function QuickWins({ recommendations }: QuickWinProps) {
  // Sort recommendations by severity (high first) and take top 3
  const quickWins = recommendations
    .filter(r => r.severity === 'high' || r.severity === 'medium')
    .slice(0, 3)

  if (quickWins.length === 0) {
    return (
      <div className="p-6 rounded-lg text-center" style={{ background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
        <p className="text-lg font-semibold" style={{ color: '#16a34a' }}>
          No high-impact chemical swaps found. Your protocol is already optimized for purchasing!
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[#16a34a] pl-4 py-1">
        <h3 className="text-xl font-bold text-[#1C1917] font-[family-name:var(--font-serif)]">
          Purchasing Accelerator
        </h3>
        <p className="text-sm text-[#78716C]">
          Direct drop-in replacements available from Millipore Sigma
        </p>
      </div>

      <div className="grid gap-4">
        {quickWins.map((win, idx) => (
          <div 
            key={idx}
            className="bg-white border border-[#D6D0C4] rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center gap-6">
              {/* Original */}
              <div className="flex-1">
                <div className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Current Chemical</div>
                <div className="text-lg font-mono font-bold text-[#1C1917] break-words">
                  {win.original.chemical}
                </div>
              </div>

              {/* Arrow */}
              <div className="hidden md:block text-[#16a34a] flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14m-7-7 7 7-7 7"/>
                </svg>
              </div>
              <div className="md:hidden flex items-center gap-2 text-[#16a34a]">
                <span className="text-[10px] font-bold uppercase">Switch to</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m7 10 5 5 5-5"/>
                </svg>
              </div>

              {/* Swap */}
              <div className="flex-1">
                <div className="text-[10px] font-bold text-[#16a34a] uppercase tracking-wider mb-1">Recommended Swap</div>
                <div className="text-lg font-mono font-bold text-[#1C1917] break-words">
                  {win.alternative.chemical}
                </div>
              </div>

              {/* CTA */}
              <div className="flex-shrink-0 pt-2 md:pt-0">
                <a 
                  href={`https://www.sigmaaldrich.com/search/${encodeURIComponent(win.alternative.chemical)}?focus=products&page=1&perPage=30&sort=relevance&term=${encodeURIComponent(win.alternative.chemical)}&type=product_search`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-[#16a34a] text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-[#15803d] transition-colors w-full md:w-auto"
                >
                  View on Sigma-Aldrich
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
            </div>
            
            <div className="bg-[#F0FDF4] px-4 py-3 border-t border-[#D6D0C4] flex items-start gap-2">
              <div className="text-[#16a34a] mt-0.5 flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
                </svg>
              </div>
              <p className="text-xs text-[#1C1917] leading-relaxed">
                <span className="font-bold">Drop-in Instruction:</span> {win.alternative.rationale} {win.alternative.yieldImpact !== 'no impact' && `Expected yield impact: ${win.alternative.yieldImpact}.`}
              </p>
            </div>
          </div>
        ))}
      </div>
      
      <div className="p-4 rounded-lg bg-[#FDFCFB] border border-[#D6D0C4] text-[11px] text-[#78716C]">
        <p>
          <strong>Note:</strong> &ldquo;Purchasing Accelerator&rdquo; results are limited to the highest-impact chemical swaps that have direct green alternatives. For a comprehensive analysis of all 12 Green Chemistry principles, switch to the Full Analysis view.
        </p>
      </div>
    </div>
  )
}
