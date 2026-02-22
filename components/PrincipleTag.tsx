const PRINCIPLE_COLORS: Record<string, { bg: string; text: string }> = {
  // Principles 1-4: greens (prevention, efficiency)
  '1': { bg: '#16a34a20', text: '#22C55E' },
  '2': { bg: '#16a34a20', text: '#4ade80' },
  '3': { bg: '#16a34a20', text: '#86efac' },
  '4': { bg: '#16a34a20', text: '#bbf7d0' },
  // Principles 5-8: blues (materials)
  '5': { bg: '#2563eb20', text: '#60a5fa' },
  '6': { bg: '#2563eb20', text: '#93c5fd' },
  '7': { bg: '#2563eb20', text: '#3b82f6' },
  '8': { bg: '#2563eb20', text: '#818cf8' },
  // Principles 9-12: purples (design)
  '9': { bg: '#7c3aed20', text: '#a78bfa' },
  '10': { bg: '#7c3aed20', text: '#c4b5fd' },
  '11': { bg: '#7c3aed20', text: '#8b5cf6' },
  '12': { bg: '#7c3aed20', text: '#a855f7' },
}

const PRINCIPLE_NAMES: Record<number, string> = {
  1: 'Prevention',
  2: 'Atom Economy',
  3: 'Less Hazardous',
  4: 'Safer Chemicals',
  5: 'Safer Solvents',
  6: 'Energy Efficiency',
  7: 'Renewable Feedstocks',
  8: 'Reduce Derivatives',
  9: 'Catalysis',
  10: 'Degradation',
  11: 'Real-time Analysis',
  12: 'Accident Prevention',
}

export default function PrincipleTag({ number }: { number: number }) {
  const colors = PRINCIPLE_COLORS[String(number)] || { bg: '#52525b20', text: '#a1a1aa' }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: colors.bg, color: colors.text }}
    >
      #{number} {PRINCIPLE_NAMES[number]}
    </span>
  )
}
