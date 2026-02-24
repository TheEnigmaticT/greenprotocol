import UserMenu from '@/components/UserMenu'
import ProtocolInput from '@/components/ProtocolInput'
import PrinciplesStrip from '@/components/PrinciplesStrip'
import ScrollBackground from '@/components/ScrollBackground'

export default function Home() {
  return (
    <ScrollBackground>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide"
          style={{ color: '#1B4332' }}
        >
          greenchemistry.ai
        </div>
        <UserMenu />
      </header>

      {/* Hero */}
      <section className="px-6 pt-20 pb-8 max-w-4xl mx-auto">
        <h1 className="font-[family-name:var(--font-serif)] font-bold mb-6">
          <span
            className="block text-6xl md:text-8xl leading-[0.95]"
            style={{ color: '#1B4332' }}
          >
            Green
          </span>
          <span
            className="block text-6xl md:text-8xl leading-[0.95]"
            style={{ color: '#1B4332' }}
          >
            Chemistry
          </span>
          <span
            className="block font-[family-name:var(--font-mono)] text-base font-normal mt-3 tracking-widest uppercase"
            style={{ color: '#7C2D36' }}
          >
            .ai
          </span>
        </h1>
        <p
          className="text-lg md:text-xl max-w-xl leading-relaxed mt-8"
          style={{ color: '#57534E' }}
        >
          Paste your laboratory protocol. Get instant recommendations
          for greener alternatives, backed by the 12 Principles of
          Green Chemistry and real environmental impact data.
        </p>
      </section>

      {/* Protocol Input */}
      <section className="px-6 pb-16 max-w-4xl mx-auto">
        <ProtocolInput />
      </section>

      {/* 12 Principles — horizontal scroll with oversized numbers */}
      <section className="py-20 border-t" style={{ borderColor: '#D6D0C4' }}>
        <div className="px-6 max-w-4xl mx-auto mb-8">
          <h2
            className="font-[family-name:var(--font-serif)] text-2xl font-bold"
            style={{ color: '#1B4332' }}
          >
            The 12 Principles
          </h2>
          <p className="text-sm mt-2" style={{ color: '#78716C' }}>
            of Green Chemistry
          </p>
        </div>
        <PrinciplesStrip />
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-10 text-center" style={{ borderColor: '#D6D0C4' }}>
        <p className="text-sm" style={{ color: '#78716C' }}>
          Built for{' '}
          <span className="font-semibold" style={{ color: '#1B4332' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
        <p className="text-xs mt-2" style={{ color: '#A8A29E' }}>
          Powered by the{' '}
          <a
            href="https://www.acs.org/greenchemistry/principles/12-principles-of-green-chemistry.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
            style={{ color: '#7C2D36' }}
          >
            12 Principles of Green Chemistry
          </a>
        </p>
      </footer>
    </ScrollBackground>
  )
}
