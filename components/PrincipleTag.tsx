const PRINCIPLE_COLORS: Record<string, { bg: string; text: string }> = {
  // Principles 1-4: greens (prevention, efficiency)
  '1': { bg: '#DCFCE7', text: '#15803d' },
  '2': { bg: '#DCFCE7', text: '#16a34a' },
  '3': { bg: '#DCFCE7', text: '#2D6A4F' },
  '4': { bg: '#DCFCE7', text: '#1B4332' },
  // Principles 5-8: blues (materials)
  '5': { bg: '#DBEAFE', text: '#1d4ed8' },
  '6': { bg: '#DBEAFE', text: '#2563eb' },
  '7': { bg: '#DBEAFE', text: '#1e40af' },
  '8': { bg: '#DBEAFE', text: '#3730a3' },
  // Principles 9-12: purples (design)
  '9': { bg: '#EDE9FE', text: '#6d28d9' },
  '10': { bg: '#EDE9FE', text: '#7c3aed' },
  '11': { bg: '#EDE9FE', text: '#6d28d9' },
  '12': { bg: '#EDE9FE', text: '#7e22ce' },
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
  const colors = PRINCIPLE_COLORS[String(number)] || { bg: '#F3F4F6', text: '#6B7280' }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: colors.bg, color: colors.text }}
    >
      #{number} {PRINCIPLE_NAMES[number]}
    </span>
  )
}
