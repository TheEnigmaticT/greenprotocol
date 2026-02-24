import { Equivalency } from '@/lib/types'

export default function EquivalencyStory({
  equivalencies,
  variant = 'dark',
}: {
  equivalencies: Equivalency[]
  variant?: 'light' | 'dark'
}) {
  if (equivalencies.length === 0) return null

  const isLight = variant === 'light'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {equivalencies.map((eq, i) => (
        <div
          key={i}
          className="p-4 rounded-lg border flex items-center gap-4"
          style={{
            background: isLight ? '#F5F0E8' : '#14532d20',
            borderColor: isLight ? '#D6D0C4' : '#1B4332',
          }}
        >
          <span className="text-3xl flex-shrink-0">{eq.icon}</span>
          <div>
            <span
              className="text-xl font-bold font-[family-name:var(--font-mono)]"
              style={{ color: isLight ? '#1B4332' : '#F59E0B' }}
            >
              {eq.value}
            </span>
            <p className="text-sm" style={{ color: isLight ? '#57534E' : '#86efac' }}>
              {eq.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
