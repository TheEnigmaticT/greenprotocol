import UserMenu from '@/components/UserMenu'
import ProtocolInput from '@/components/ProtocolInput'

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

export default function Home() {
  return (
    <div className="min-h-screen" style={{ background: '#0A0F0D' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="font-[family-name:var(--font-serif)] font-bold text-lg" style={{ color: '#22C55E' }}>
          GreenChemistry.ai
        </div>
        <UserMenu />
      </header>

      {/* Hero */}
      <section className="text-center px-6 pt-16 pb-12 max-w-4xl mx-auto">
        <h1
          className="text-5xl md:text-6xl font-bold font-[family-name:var(--font-serif)] mb-4"
          style={{ color: '#F5F5F4' }}
        >
          Green<span style={{ color: '#22C55E' }}>Chemistry</span><span style={{ color: '#F59E0B' }}>.ai</span>
        </h1>
        <p className="text-xl md:text-2xl mb-2" style={{ color: '#86efac' }}>
          AI-Powered Green Chemistry Protocol Optimizer
        </p>
        <p className="text-base max-w-2xl mx-auto mb-12" style={{ color: '#a3a3a3' }}>
          Paste your laboratory protocol and get instant recommendations for greener alternatives,
          backed by the 12 Principles of Green Chemistry and real environmental impact data.
        </p>

        <ProtocolInput />
      </section>

      {/* 12 Principles Grid */}
      <section className="px-6 py-16 max-w-6xl mx-auto">
        <h2
          className="text-2xl font-bold font-[family-name:var(--font-serif)] text-center mb-8"
          style={{ color: '#F5F5F4' }}
        >
          The 12 Principles of Green Chemistry
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {PRINCIPLES.map((p) => (
            <div
              key={p.num}
              className="p-3 rounded-lg border border-forest-800 hover:border-forest-600 transition-colors"
              style={{ background: '#14532d20' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ background: '#1B4332', color: '#22C55E' }}
                >
                  {p.num}
                </span>
                <span className="text-sm font-semibold" style={{ color: '#F5F5F4' }}>
                  {p.name}
                </span>
              </div>
              <p className="text-xs" style={{ color: '#86efac' }}>{p.short}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-forest-800 px-6 py-8 text-center">
        <p className="text-sm" style={{ color: '#a3a3a3' }}>
          Built for{' '}
          <span style={{ color: '#22C55E' }}>LabreNew.org</span>
          {' '}— Green chemistry recommendations require experimental validation before adoption.
        </p>
        <p className="text-xs mt-2" style={{ color: '#737373' }}>
          Powered by the{' '}
          <a
            href="https://www.acs.org/greenchemistry/principles/12-principles-of-green-chemistry.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
            style={{ color: '#86efac' }}
          >
            12 Principles of Green Chemistry
          </a>
        </p>
      </footer>
    </div>
  )
}
