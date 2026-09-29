import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Pilot Volunteer Sign-up | GreenChemistry.ai',
  description: 'Volunteer for a GreenChemistry.ai pilot and help shape an evidence-first chemistry tool.',
}

const FORM_URL = 'https://api.leadconnectorhq.com/widget/form/vB0KKEeuoXkLxL4yqb2r'

export default function PilotSignupPage() {
  return (
    <main className="pilot-page">
      <style>{`
        .pilot-page { min-height: 100vh; background: #1C3822; color: #F6F3EB; }
        .pilot-nav { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem clamp(1.25rem, 5vw, 5rem); border-bottom: 1px solid #2D4A3A; }
        .pilot-wordmark { color: #F6F3EB; font-family: var(--font-mono), monospace; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-decoration: none; }
        .pilot-back { color: #A8C5A2; font-family: var(--font-mono), monospace; font-size: 0.68rem; letter-spacing: 0.06em; text-decoration: none; }
        .pilot-layout { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(420px, 1.2fr); gap: clamp(2rem, 6vw, 7rem); align-items: start; width: min(1180px, calc(100% - 3rem)); margin: 0 auto; padding: clamp(4rem, 9vw, 8rem) 0; }
        .pilot-kicker { margin: 0 0 1.25rem; color: #ECB815; font-family: var(--font-mono), monospace; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; }
        .pilot-heading { max-width: 10ch; margin: 0; color: #F6F3EB; font-family: var(--font-mono), monospace; font-size: clamp(2.8rem, 6vw, 5.8rem); font-weight: 600; letter-spacing: -0.055em; line-height: 0.94; }
        .pilot-heading span { color: #ECB815; }
        .pilot-rule { width: 4rem; height: 1px; margin: 2rem 0; background: #ECB815; }
        .pilot-copy { max-width: 42ch; margin: 0; color: #A8C5A2; font-family: var(--font-serif), serif; font-size: 1rem; line-height: 1.8; }
        .pilot-points { display: grid; gap: 0.9rem; max-width: 42ch; margin: 2rem 0 0; padding: 1.25rem 0 0; border-top: 1px solid #2D4A3A; color: #F6F3EB; font-family: var(--font-mono), monospace; font-size: 0.72rem; line-height: 1.55; list-style: none; }
        .pilot-points li::before { content: '→'; display: inline-block; margin-right: 0.7rem; color: #ECB815; }
        .pilot-form-shell { overflow: hidden; min-height: 760px; background: #F6F3EB; border: 1px solid #A8C5A2; box-shadow: 1.25rem 1.25rem 0 rgba(13, 31, 22, 0.35); }
        .pilot-form { display: block; width: 100%; min-height: 760px; border: 0; }
        @media (max-width: 800px) { .pilot-layout { grid-template-columns: 1fr; width: min(100% - 2rem, 620px); padding: 3.5rem 0 4rem; } .pilot-heading { max-width: 12ch; } .pilot-form-shell, .pilot-form { min-height: 900px; } }
        @media (max-width: 480px) { .pilot-nav { padding-inline: 1rem; } .pilot-back { font-size: 0.6rem; } .pilot-form-shell { box-shadow: 0.6rem 0.6rem 0 rgba(13, 31, 22, 0.35); } }
      `}</style>

      <nav className="pilot-nav" aria-label="Primary navigation">
        <Link className="pilot-wordmark" href="/">GREENCHEMISTRY.AI</Link>
        <Link className="pilot-back" href="/careers">← BACK TO GET INVOLVED</Link>
      </nav>

      <div className="pilot-layout">
        <section aria-labelledby="pilot-heading">
          <p className="pilot-kicker">Pilot volunteer sign-up</p>
          <h1 id="pilot-heading" className="pilot-heading">Help make chemistry <span>greener.</span></h1>
          <div className="pilot-rule" aria-hidden="true" />
          <p className="pilot-copy">Volunteer for a GreenChemistry.ai pilot. Tell us a little about your work and we will follow up to arrange a pilot kickoff.</p>
          <ul className="pilot-points">
            <li>Try GreenChemistry.ai on the work you already do</li>
            <li>Share what is useful, confusing, or missing</li>
            <li>Help shape the product before wider release</li>
          </ul>
        </section>

        <section className="pilot-form-shell" aria-label="Pilot volunteer sign-up form">
          <iframe className="pilot-form" src={FORM_URL} title="GreenChemistry.ai pilot volunteer sign-up form" loading="eager" />
        </section>
      </div>
    </main>
  )
}
