import Link from 'next/link'
import { SciSurePartnerContactForm } from '@/components/partners/scisure-partner-contact-form'

export const metadata = { title: 'SciSure pilot | GreenChemistry.ai', description: 'Planned SciSure pilot preview and partnership contact.' }

export default function SciSurePartnerPage() {
  return <main style={{ minHeight: '100vh', background: '#f6f3eb', color: '#0d1f16' }}>
    <header style={{ background: '#1c3822', color: '#f6f3eb', padding: '1rem clamp(1.25rem, 6vw, 6rem)', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
      <Link href="/" style={{ color: 'inherit', fontFamily: 'var(--font-mono)', fontWeight: 800, textDecoration: 'none' }}>GreenChemistry.ai</Link>
      <Link href="/analyze" style={{ color: '#ecb815', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>Analyze a protocol</Link>
    </header>
    <section style={{ background: '#1c3822', color: '#f6f3eb', padding: 'clamp(4rem, 12vw, 8rem) clamp(1.25rem, 11vw, 12rem)' }}>
      <p style={{ color: '#a8c5a2', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>SciSure integration preview</p>
      <h1 style={{ maxWidth: '14ch', margin: '1rem 0', fontFamily: 'var(--font-mono)', fontSize: 'clamp(2.7rem, 7vw, 5.75rem)', letterSpacing: '-0.05em', lineHeight: 0.92 }}>Make greener choices visible where work already happens.</h1>
      <p style={{ maxWidth: '58ch', color: '#a8c5a2', fontSize: '1.15rem', lineHeight: 1.7 }}>We are planning a limited SciSure pilot. The preview is not a SciSure endorsement, Marketplace certification, or a live product claim. It is a proposed workflow for reviewing GreenChemistry.ai recommendations alongside protocol work.</p>
    </section>
    <section style={{ maxWidth: 1080, margin: '0 auto', padding: '4rem 1.25rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '3rem' }}>
      <div><p style={{ color: '#006d15', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>WHAT THE PILOT IS PLANNED TO DO</p><h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem' }}>Review, not automatic changes.</h2><p style={{ lineHeight: 1.7 }}>A researcher would select limited protocol text, review evidence-backed improvement candidates, and make the scientific decision. Nothing is changed in SciSure automatically. No account requirement is planned for the preview path; availability and admission controls will be confirmed before launch.</p></div>
      <div><p style={{ color: '#006d15', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>START WITH THE CORE PRODUCT</p><h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem' }}>Ten free analyses for new accounts.</h2><p style={{ lineHeight: 1.7 }}>You can submit a protocol directly in GreenChemistry.ai. Partnership contact is optional and never required to submit a protocol. Free accounts include 10 analyses.</p><Link href="/analyze" style={{ display: 'inline-block', marginTop: '0.8rem', background: '#ecb815', color: '#0d1f16', padding: '0.8rem 1rem', fontWeight: 800, textDecoration: 'none' }}>Start an analysis</Link></div>
    </section>
    <section style={{ background: '#a8c5a2', padding: '4rem 1.25rem' }}><div style={{ maxWidth: 720, margin: '0 auto' }}><p style={{ color: '#1c3822', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>PARTNERSHIP CONTACT</p><h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1 }}>Help us define a useful pilot.</h2><p style={{ lineHeight: 1.7 }}>Tell us about integration goals, review points, and deployment constraints. Please do not include protocol text, attachments, or confidential procedures.</p><SciSurePartnerContactForm /></div></section>
  </main>
}
