import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Careers — GreenChemistry.ai',
  description:
    'Help build the evidence-first tools that make greener chemistry easier to practice.',
}

const C = {
  black: '#0D1F16',
  forest: '#1C3822',
  mid: '#2D4A3A',
  vivid: '#006D15',
  sage: '#A8C5A2',
  gold: '#ECB815',
  goldDark: '#9D8026',
  cream: '#F6F3EB',
  creamDark: '#F0EAD6',
}

const MONO = "'IBM Plex Mono', monospace"
const SERIF = "'Libre Baskerville', serif"

function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 616 661"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="matrix(1,0,0,1,0,-870.112676)">
        <g transform="matrix(0.635047,0,0,1,-360.28207,-148.549277)">
          <g transform="matrix(1.574687,0,0,1,567.331398,148.549277)">
            <circle cx="319.668" cy="1196.73" r="240.317" fill={C.gold} stroke={C.gold} strokeWidth="70.83" />
          </g>
          <g transform="matrix(2.162851,0,0,1.030134,-100.669885,1129.202466)">
            <ellipse cx="449.577" cy="163.662" rx="23.662" ry="31.549" fill={C.forest} />
          </g>
          <g transform="matrix(2.162851,0,0,1.030134,-100.669885,1231.039573)">
            <ellipse cx="449.577" cy="163.662" rx="23.662" ry="31.549" fill={C.forest} />
          </g>
          <g transform="matrix(1.574687,0,0,1,727.025369,1039.401901)">
            <path d="M193.326,258.394L353.566,258.394" fill="none" stroke={C.forest} strokeWidth="70.83" />
          </g>
          <g transform="matrix(1.574687,0,0,1,727.025369,1139.239008)">
            <path d="M193.326,258.394L353.566,258.394" fill="none" stroke={C.forest} strokeWidth="70.83" />
          </g>
        </g>
      </g>
    </svg>
  )
}

const disciplines = [
  {
    number: '01',
    title: 'Chemistry & scientific data',
    body: 'You care about methods, evidence quality, and what makes a recommendation defensible at the bench.',
  },
  {
    number: '02',
    title: 'Product engineering',
    body: 'You can turn complex scientific work into durable, legible software without hiding uncertainty.',
  },
  {
    number: '03',
    title: 'Design & research workflows',
    body: 'You make technical tools easier to trust, learn, and use in the middle of real research work.',
  },
  {
    number: '04',
    title: 'Lab & industry partnerships',
    body: 'You know how to connect a useful tool to the people and institutions doing consequential chemistry.',
  },
]

const principles = [
  ['Evidence before assertion', 'We show what supports an answer and name what still needs experimental validation.'],
  ['Chemistry stays accountable', 'AI can make the interface better. It does not replace chemical judgment.'],
  ['Build for the bench', 'The useful unit of work is a protocol, a decision, and a next experiment.'],
]

export default function CareersPage() {
  return (
    <main>
      <style>{`
        .careers-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 1.5rem; width: 100%; max-width: 1360px; margin: 0 auto; padding: 0 80px; box-sizing: border-box; }
        .careers-grid > * { min-width: 0; }
        .career-hero { min-height: calc(100vh - 61px); display: flex; align-items: center; }
        .career-statement { grid-column: span 8; }
        .career-side { grid-column: 10 / span 3; align-self: end; margin-bottom: 1rem; }
        .career-section-heading { grid-column: span 4; }
        .career-section-content { grid-column: 6 / span 7; }
        .career-discipline { grid-column: span 6; }
        .career-apply-copy { grid-column: span 5; }
        .career-apply-action { grid-column: 8 / span 5; }
        @media (max-width: 900px) {
          .careers-grid { padding: 0 24px; }
          .career-hero { min-height: auto; padding: 6rem 0 5rem; }
          .career-statement, .career-side, .career-section-heading, .career-section-content, .career-discipline, .career-apply-copy, .career-apply-action { grid-column: 1 / -1; }
          .career-side { margin-top: 2rem; margin-bottom: 0; }
          .career-section-content { margin-top: 1rem; }
          .career-apply-action { margin-top: 2rem; }
        }
      `}</style>

      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: C.forest, borderBottom: `1px solid ${C.mid}` }}>
        <div className="careers-grid" style={{ maxWidth: 'none', padding: '0 24px' }}>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 0' }}>
            <Link href="/" aria-label="GreenChemistry.ai home" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Mark size={24} />
              <Image src="/wordmark-light.svg" alt="GreenChemistry.ai" width={120} height={18} style={{ height: '18px', width: 'auto' }} />
            </Link>
            <Link href="/analyze" style={{ background: C.gold, color: C.black, fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em', padding: '0.5rem 0.8rem', textDecoration: 'none' }}>
              ANALYZE →
            </Link>
          </div>
        </div>
      </nav>

      <section className="career-hero" style={{ background: C.forest, color: C.cream }}>
        <div className="careers-grid" style={{ alignItems: 'end' }}>
          <div style={{ gridColumn: 'span 4', borderTop: `1px solid ${C.mid}`, paddingTop: '0.75rem', fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: C.sage }}>
            Join GreenChemistry.ai
          </div>
          <div style={{ gridColumn: 'span 8' }} />
          <div className="career-statement" style={{ marginTop: '2.5rem' }}>
            <h1 style={{ fontFamily: MONO, fontSize: 'clamp(2.9rem, 6.1vw, 5.6rem)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.04em', margin: 0 }}>
              Better tools for<br />
              <span style={{ color: C.gold }}>better chemistry.</span>
            </h1>
            <p style={{ fontFamily: SERIF, color: C.sage, fontSize: 'clamp(1.05rem, 1.7vw, 1.3rem)', lineHeight: 1.7, maxWidth: '43ch', margin: '2.25rem 0 0' }}>
              We are building evidence-first software that helps scientists make greener, more defensible choices before the next experiment.
            </p>
          </div>
          <aside className="career-side" style={{ borderTop: `1px solid ${C.mid}`, paddingTop: '1.25rem' }}>
            <div style={{ fontFamily: MONO, color: C.gold, fontSize: '2.25rem', fontWeight: 700, lineHeight: 1 }}>12</div>
            <p style={{ fontFamily: MONO, color: C.sage, fontSize: '0.65rem', letterSpacing: '0.1em', lineHeight: 1.5, margin: '0.5rem 0 0', textTransform: 'uppercase' }}>Principles, made usable</p>
          </aside>
        </div>
      </section>

      <section style={{ background: C.gold, padding: '6rem 0' }}>
        <div className="careers-grid">
          <div className="career-section-heading" style={{ borderTop: `2px solid ${C.black}`, paddingTop: '1rem' }}>
            <div style={{ fontFamily: MONO, color: C.forest, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>The work</div>
          </div>
          <div className="career-section-content" style={{ borderTop: `2px solid ${C.black}`, paddingTop: '1rem' }}>
            <h2 style={{ fontFamily: MONO, color: C.black, fontSize: 'clamp(2rem, 4vw, 3.6rem)', fontWeight: 700, lineHeight: 0.93, letterSpacing: '-0.03em', margin: 0 }}>Scientific rigor should not be a usability problem.</h2>
            <p style={{ fontFamily: SERIF, color: C.forest, fontSize: '1.05rem', lineHeight: 1.75, maxWidth: '48ch', margin: '2rem 0 0' }}>
              GreenChemistry.ai brings deterministic chemistry, public evidence, and thoughtful AI interaction together around the work scientists already do: reviewing protocols, weighing alternatives, and deciding what to test next.
            </p>
          </div>
        </div>
      </section>

      <section style={{ background: C.cream, padding: '6rem 0' }}>
        <div className="careers-grid">
          <div className="career-section-heading" style={{ borderTop: `1px solid ${C.creamDark}`, paddingTop: '1rem' }}>
            <div style={{ fontFamily: MONO, color: C.goldDark, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Where you fit</div>
            <h2 style={{ fontFamily: MONO, color: C.forest, fontSize: 'clamp(1.8rem, 3.3vw, 3rem)', fontWeight: 700, lineHeight: 0.93, letterSpacing: '-0.03em', margin: '0.75rem 0 0' }}>We hire for the work, not a narrow template.</h2>
          </div>
          <div className="career-section-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1px', background: '#C8C2B0' }}>
            {disciplines.map(({ number, title, body }) => (
              <article key={number} style={{ background: C.cream, padding: '1.5rem', minHeight: '185px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: MONO, color: C.goldDark, fontSize: '0.7rem', fontWeight: 700 }}>{number}</span>
                <div>
                  <h3 style={{ fontFamily: SERIF, color: C.forest, fontSize: '1.05rem', margin: '0 0 0.7rem' }}>{title}</h3>
                  <p style={{ color: C.mid, fontSize: '0.88rem', lineHeight: 1.65, margin: 0 }}>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: C.black, padding: '6rem 0' }}>
        <div className="careers-grid">
          <div className="career-section-heading" style={{ borderTop: `1px solid ${C.mid}`, paddingTop: '1rem' }}>
            <div style={{ fontFamily: MONO, color: C.sage, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>How we work</div>
          </div>
          <div className="career-section-content" style={{ borderTop: `1px solid ${C.mid}` }}>
            {principles.map(([title, body], index) => (
              <article key={title} style={{ padding: '1.5rem 0', borderBottom: `1px solid ${C.mid}`, display: 'grid', gridTemplateColumns: 'minmax(52px, 0.6fr) minmax(0, 2fr)', gap: '1rem' }}>
                <span style={{ fontFamily: MONO, color: C.gold, fontSize: '0.8rem', fontWeight: 700 }}>0{index + 1}</span>
                <div>
                  <h3 style={{ fontFamily: SERIF, color: C.cream, fontSize: '1.1rem', margin: 0 }}>{title}</h3>
                  <p style={{ color: C.sage, fontFamily: SERIF, fontSize: '0.95rem', lineHeight: 1.7, margin: '0.6rem 0 0' }}>{body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: C.sage, padding: '6rem 0' }}>
        <div className="careers-grid" style={{ alignItems: 'center' }}>
          <div className="career-apply-copy" style={{ borderTop: `2px solid ${C.forest}`, paddingTop: '1.5rem' }}>
            <div style={{ fontFamily: MONO, color: C.forest, fontSize: '0.65rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Start a conversation</div>
            <h2 style={{ fontFamily: MONO, color: C.forest, fontSize: 'clamp(2rem, 4vw, 3.6rem)', fontWeight: 700, lineHeight: 0.92, letterSpacing: '-0.035em', margin: '1rem 0 0' }}>Tell us what you would make possible.</h2>
          </div>
          <div className="career-apply-action">
            <p style={{ fontFamily: SERIF, color: C.forest, fontSize: '1rem', lineHeight: 1.75, margin: 0, maxWidth: '39ch' }}>Send a note with your background, the problem you are drawn to, and work that shows how you think. We read every thoughtful application.</p>
            <a href="mailto:hello@greenchemistry.ai?subject=Joining%20GreenChemistry.ai" style={{ display: 'inline-block', marginTop: '2rem', background: C.forest, color: C.cream, fontFamily: MONO, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em', padding: '1rem 1.35rem', textDecoration: 'none' }}>INTRODUCE YOURSELF →</a>
            <p style={{ fontFamily: MONO, color: C.forest, fontSize: '0.65rem', letterSpacing: '0.05em', margin: '0.9rem 0 0', opacity: 0.8 }}>hello@greenchemistry.ai</p>
          </div>
        </div>
      </section>

      <footer style={{ background: C.black, borderTop: `1px solid ${C.forest}` }}>
        <div className="careers-grid" style={{ paddingTop: '2.5rem', paddingBottom: '2.5rem', alignItems: 'center' }}>
          <div style={{ gridColumn: 'span 6', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Mark size={24} />
            <Image src="/wordmark-light.svg" alt="GreenChemistry.ai" width={123} height={18} style={{ height: '18px', width: 'auto', opacity: 0.7 }} />
          </div>
          <div style={{ gridColumn: 'span 6', textAlign: 'right', fontFamily: MONO, fontSize: '0.65rem', color: '#4A6B58', letterSpacing: '0.04em' }}>© 2026 GreenChemistry.ai</div>
        </div>
      </footer>
    </main>
  )
}
