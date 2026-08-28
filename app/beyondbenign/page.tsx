import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Beyond Benign Open Beta | GreenChemistry.ai',
  description: 'Join the GreenChemistry.ai open beta and help shape a more useful green chemistry resource.',
}

const FORM_URL = 'https://api.leadconnectorhq.com/widget/form/GOLKRz17ezpTf1oeN1Ln'

export default function BeyondBenignPage() {
  return (
    <main className="beta-page">
      <style>{`
        .beta-page {
          min-height: 100vh;
          background: #1C3822;
          color: #F6F3EB;
        }
        .beta-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem clamp(1.25rem, 5vw, 5rem);
          border-bottom: 1px solid #2D4A3A;
        }
        .beta-wordmark {
          color: #F6F3EB;
          font-family: var(--font-mono), monospace;
          font-size: 0.78rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-decoration: none;
        }
        .beta-back {
          color: #A8C5A2;
          font-family: var(--font-mono), monospace;
          font-size: 0.68rem;
          letter-spacing: 0.06em;
          text-decoration: none;
        }
        .beta-layout {
          display: grid;
          grid-template-columns: minmax(0, 0.8fr) minmax(420px, 1.2fr);
          gap: clamp(2rem, 6vw, 7rem);
          align-items: start;
          width: min(1180px, calc(100% - 3rem));
          margin: 0 auto;
          padding: clamp(4rem, 9vw, 8rem) 0;
        }
        .beta-kicker {
          margin: 0 0 1.25rem;
          color: #ECB815;
          font-family: var(--font-mono), monospace;
          font-size: 0.68rem;
          font-weight: 600;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .beta-heading {
          max-width: 10ch;
          margin: 0;
          color: #F6F3EB;
          font-family: var(--font-mono), monospace;
          font-size: clamp(2.8rem, 6vw, 5.8rem);
          font-weight: 600;
          letter-spacing: -0.055em;
          line-height: 0.94;
        }
        .beta-heading span { color: #ECB815; }
        .beta-rule {
          width: 4rem;
          height: 1px;
          margin: 2rem 0;
          background: #ECB815;
        }
        .beta-copy {
          max-width: 42ch;
          margin: 0;
          color: #A8C5A2;
          font-family: var(--font-serif), serif;
          font-size: 1rem;
          line-height: 1.8;
        }
        .beta-points {
          display: grid;
          gap: 0.9rem;
          max-width: 42ch;
          margin: 2rem 0 0;
          padding: 1.25rem 0 0;
          border-top: 1px solid #2D4A3A;
          color: #F6F3EB;
          font-family: var(--font-mono), monospace;
          font-size: 0.72rem;
          line-height: 1.55;
          list-style: none;
        }
        .beta-points li::before {
          content: '→';
          display: inline-block;
          margin-right: 0.7rem;
          color: #ECB815;
        }
        .beta-form-shell {
          overflow: hidden;
          min-height: 760px;
          background: #F6F3EB;
          border: 1px solid #A8C5A2;
          box-shadow: 1.25rem 1.25rem 0 rgba(13, 31, 22, 0.35);
        }
        .beta-form {
          display: block;
          width: 100%;
          min-height: 760px;
          border: 0;
        }
        @media (max-width: 800px) {
          .beta-layout {
            grid-template-columns: 1fr;
            width: min(100% - 2rem, 620px);
            padding: 3.5rem 0 4rem;
          }
          .beta-heading { max-width: 12ch; }
          .beta-form-shell, .beta-form { min-height: 900px; }
        }
        @media (max-width: 480px) {
          .beta-nav { padding-inline: 1rem; }
          .beta-back { font-size: 0.6rem; }
          .beta-form-shell { box-shadow: 0.6rem 0.6rem 0 rgba(13, 31, 22, 0.35); }
        }
      `}</style>

      <nav className="beta-nav" aria-label="Primary navigation">
        <Link className="beta-wordmark" href="/">GREENCHEMISTRY.AI</Link>
        <Link className="beta-back" href="/">← BACK TO SITE</Link>
      </nav>

      <div className="beta-layout">
        <section aria-labelledby="beta-heading">
          <p className="beta-kicker">Beyond Benign community invitation</p>
          <h1 id="beta-heading" className="beta-heading">
            Help us build a <span>greener</span> lab.
          </h1>
          <div className="beta-rule" aria-hidden="true" />
          <p className="beta-copy">
            GreenChemistry.ai is opening its website to beta testers from the Beyond Benign community. Try it out, tell us what works, and help us make the experience more useful for people working in green chemistry.
          </p>
          <ul className="beta-points">
            <li>Explore the website while it is still being developed</li>
            <li>Share what is useful, confusing, or missing</li>
            <li>Help shape future improvements</li>
          </ul>
        </section>

        <section className="beta-form-shell" aria-label="Open beta registration form">
          <iframe
            className="beta-form"
            src={FORM_URL}
            title="GreenChemistry.ai open beta registration form"
            loading="eager"
          />
        </section>
      </div>
    </main>
  )
}
