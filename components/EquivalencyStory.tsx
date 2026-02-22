import { Equivalency } from '@/lib/types'

export default function EquivalencyStory({ equivalencies }: { equivalencies: Equivalency[] }) {
  if (equivalencies.length === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {equivalencies.map((eq, i) => (
        <div
          key={i}
          className="p-4 rounded-lg border border-forest-800 flex items-center gap-4"
          style={{ background: '#14532d20' }}
        >
          <span className="text-3xl flex-shrink-0">{eq.icon}</span>
          <div>
            <span className="text-xl font-bold font-[family-name:var(--font-mono)]" style={{ color: '#F59E0B' }}>
              {eq.value}
            </span>
            <p className="text-sm" style={{ color: '#86efac' }}>{eq.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
