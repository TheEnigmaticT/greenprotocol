'use client'

const PRINCIPLES = [
  { num: 1, name: 'Prevention', short: 'Prevent waste, don\'t treat it' },
  { num: 2, name: 'Atom Economy', short: 'Maximize material incorporation' },
  { num: 3, name: 'Less Hazardous Syntheses', short: 'Use less toxic substances' },
  { num: 4, name: 'Safer Chemicals', short: 'Reduce toxicity, keep efficacy' },
  { num: 5, name: 'Safer Solvents', short: 'Minimize auxiliary substances' },
  { num: 6, name: 'Energy Efficiency', short: 'Minimize energy requirements' },
  { num: 7, name: 'Renewable Feedstocks', short: 'Use renewable raw materials' },
  { num: 8, name: 'Reduce Derivatives', short: 'Avoid unnecessary derivatization' },
  { num: 9, name: 'Catalysis', short: 'Catalytic over stoichiometric' },
  { num: 10, name: 'Design for Degradation', short: 'Products break down after use' },
  { num: 11, name: 'Real-time Analysis', short: 'Monitor to prevent pollution' },
  { num: 12, name: 'Accident Prevention', short: 'Inherently safer chemistry' },
]

function PrincipleItem({ num, name, short }: { num: number; name: string; short: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="font-[family-name:var(--font-mono)] font-semibold leading-none select-none flex-shrink-0"
        style={{
          fontSize: '3.5rem',
          color: '#D6D0C4',
        }}
      >
        {String(num).padStart(2, '0')}
      </span>
      <div className="pt-1 min-w-0">
        <h3
          className="font-[family-name:var(--font-serif)] font-bold text-base mb-0.5"
          style={{ color: '#1B4332' }}
        >
          {name}
        </h3>
        <p className="text-sm leading-snug" style={{ color: '#78716C' }}>
          {short}
        </p>
      </div>
    </div>
  )
}

export default function PrinciplesStrip() {
  return (
    <div className="px-6 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-8">
        {PRINCIPLES.map((p) => (
          <PrincipleItem key={p.num} num={p.num} name={p.name} short={p.short} />
        ))}
      </div>
    </div>
  )
}
