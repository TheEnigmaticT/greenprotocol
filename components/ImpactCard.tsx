export default function ImpactCard({
  icon,
  value,
  unit,
  description,
  color = '#22C55E',
}: {
  icon: string
  value: string
  unit?: string
  description: string
  color?: string
}) {
  return (
    <div
      className="p-4 rounded-lg border border-forest-800"
      style={{ background: '#14532d20' }}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold font-[family-name:var(--font-mono)]" style={{ color }}>
          {value}
        </span>
        {unit && <span className="text-sm" style={{ color: '#a3a3a3' }}>{unit}</span>}
      </div>
      <p className="text-sm mt-1" style={{ color: '#86efac' }}>{description}</p>
    </div>
  )
}
