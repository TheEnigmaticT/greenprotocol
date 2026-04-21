'use client'
// GreenChemistry.ai Landing Page
// Grid: 12-col, 80px margins, 24px gutters, 1200px max content
// Aesthetic: 70s Swedish modernism — floods, hairlines, knockouts, oversized type as structure
// No 50/50 hero. No card rows. No triple CTA. Scroll-linked section color shifts.

import { useEffect, useRef, useState } from 'react'

const COLS = `
  .g { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1.5rem; max-width: 1360px; margin: 0 auto; padding: 0 80px; }
  .c1{grid-column:span 1} .c2{grid-column:span 2} .c3{grid-column:span 3}
  .c4{grid-column:span 4} .c5{grid-column:span 5} .c6{grid-column:span 6}
  .c7{grid-column:span 7} .c8{grid-column:span 8} .c9{grid-column:span 9}
  .c10{grid-column:span 10} .c11{grid-column:span 11} .c12{grid-column:span 12}
  .cs2{grid-column-start:2} .cs3{grid-column-start:3} .cs4{grid-column-start:4}
  .cs5{grid-column-start:5} .cs7{grid-column-start:7} .cs8{grid-column-start:8} .cs9{grid-column-start:9}
  @media(max-width:900px){
    .g{padding:0 24px}
    .c3,.c4,.c5,.c6,.c7,.c8,.c9,.c10{grid-column:span 12}
    .cs2,.cs3,.cs4,.cs5,.cs7,.cs8,.cs9{grid-column-start:1}
  }
`

const MONO = "'IBM Plex Mono', monospace"
const SERIF = "'Libre Baskerville', serif"
const C = {
  black: '#0D1F16', forest: '#1C3822', mid: '#2D4A3A',
  vivid: '#006D15', sage: '#A8C5A2', gold: '#ECB815',
  goldDark: '#9D8026', cream: '#F6F3EB', creamDark: '#F0EAD6',
}

// ── Logomark: inlined SVG (gold circle, dark := bars/dots)
const Mark = ({ size = 48 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 616 661" xmlns="http://www.w3.org/2000/svg"
    style={{fillRule:'evenodd',clipRule:'evenodd',strokeLinecap:'round',strokeLinejoin:'round',strokeMiterlimit:1.5}}>
    <g transform="matrix(1,0,0,1,0,-870.112676)">
      <g transform="matrix(0.635047,0,0,1,-360.28207,-148.549277)">
        <g transform="matrix(1.574687,0,0,1,567.331398,148.549277)">
          <circle cx="319.668" cy="1196.73" r="240.317" fill="#ECB815" stroke="#ECB815" strokeWidth="70.83"/>
        </g>
        <g transform="matrix(2.162851,0,0,1.030134,-100.669885,1129.202466)">
          <ellipse cx="449.577" cy="163.662" rx="23.662" ry="31.549" fill="#1C3822" stroke="#006D15" strokeWidth="0.82"/>
        </g>
        <g transform="matrix(2.162851,0,0,1.030134,-100.669885,1231.039573)">
          <ellipse cx="449.577" cy="163.662" rx="23.662" ry="31.549" fill="#1C3822" stroke="#006D15" strokeWidth="0.82"/>
        </g>
        <g transform="matrix(1.574687,0,0,1,727.025369,1039.401901)">
          <path d="M193.326,258.394L353.566,258.394" fill="none" stroke="#1C3822" strokeWidth="70.83"/>
        </g>
        <g transform="matrix(1.574687,0,0,1,727.025369,1139.239008)">
          <path d="M193.326,258.394L353.566,258.394" fill="none" stroke="#1C3822" strokeWidth="70.83"/>
        </g>
      </g>
    </g>
  </svg>
)

// ── Scroll-linked background color transition hook
function useScrollColor(stops: {pct:number, bg:string}[]) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    function lerp(a: string, b: string, t: number) {
      const hex = (h:string) => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]
      const [r1,g1,b1] = hex(a); const [r2,g2,b2] = hex(b)
      const r = Math.round(r1+(r2-r1)*t); const g = Math.round(g1+(g2-g1)*t); const bl = Math.round(b1+(b2-b1)*t)
      return `rgb(${r},${g},${bl})`
    }
    function onScroll() {
      const h = document.documentElement.scrollHeight - window.innerHeight
      const pct = h > 0 ? window.scrollY / h : 0
      for (let i = 0; i < stops.length - 1; i++) {
        if (pct >= stops[i].pct && pct <= stops[i+1].pct) {
          const t = (pct - stops[i].pct) / (stops[i+1].pct - stops[i].pct)
          if(el) el.style.backgroundColor = lerp(stops[i].bg, stops[i+1].bg, t)
          return
        }
      }
    }
    window.addEventListener('scroll', onScroll, {passive:true})
    return () => window.removeEventListener('scroll', onScroll)
  }, [stops])
  return ref
}

export default function LandingPage() {
  // Scroll-linked bg for the body wrapper
  const SHOWCASE_TABS = ['recommendations', 'protocol', 'scorecard'] as const
  type ShowcaseTab = typeof SHOWCASE_TABS[number]
  const [showcaseTab, setShowcaseTab] = useState<ShowcaseTab>('recommendations')
  const [showcasePaused, setShowcasePaused] = useState(false)
  const showcaseTabRef = useRef<ShowcaseTab>('recommendations')
  showcaseTabRef.current = showcaseTab

  useEffect(() => {
    if (showcasePaused) return
    const id = setInterval(() => {
      const cur = showcaseTabRef.current
      const idx = SHOWCASE_TABS.indexOf(cur)
      setShowcaseTab(SHOWCASE_TABS[(idx + 1) % SHOWCASE_TABS.length])
    }, 10000)
    return () => clearInterval(id)
  }, [showcasePaused])

  const bodyRef = useScrollColor([
    {pct:0,    bg:'#1C3822'}, // hero: deep forest
    {pct:0.25, bg:'#ECB815'}, // how it works: gold
    {pct:0.50, bg:'#F6F3EB'}, // principles: cream
    {pct:0.72, bg:'#1C3822'}, // enterprise: back to forest
    {pct:0.88, bg:'#A8C5A2'}, // contact: sage
    {pct:1.0,  bg:'#0D1F16'}, // footer: near-black
  ])

  return (
    <>
      <style>{COLS}</style>
      <style>{`
        @keyframes showcase-progress {
          from { width: 0% }
          to   { width: 100% }
        }
      `}</style>

      {/* ── NAV ── sticky, hairline bottom only, transparent on forest */}
      <nav style={{
        position:'sticky', top:0, zIndex:50,
        background:'#1C3822', borderBottom:`1px solid ${C.mid}`,
      }}>
        <div className="g" style={{maxWidth:'none', padding:'0 80px'}}>
          <div className="c12" style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            paddingTop:'1rem', paddingBottom:'1rem',
          }}>
            <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
              <Mark size={32} />
              <img src="/logo-wide-light.svg" alt="GreenChemistry.ai"
                style={{height:'22px', width:'auto'}} />
            </div>
            <div style={{display:'flex', alignItems:'center', gap:'2.5rem'}}>
              {[['#how-it-works','Process'],['#principles','12 Principles'],['#enterprise','Enterprise']].map(([h,l])=>(
                <a key={h} href={h} style={{
                  fontFamily:MONO, fontSize:'0.7rem', letterSpacing:'0.12em',
                  textTransform:'uppercase', color:C.sage,
                  textDecoration:'none',
                }}>{l}</a>
              ))}
              <a href="/analyze" style={{
                background:C.gold, color:C.black,
                fontFamily:MONO, fontSize:'0.75rem', fontWeight:700,
                letterSpacing:'0.06em', padding:'0.6rem 1.25rem',
                textDecoration:'none', display:'block',
              }}>ANALYZE →</a>
            </div>
          </div>
        </div>
      </nav>

      <div ref={bodyRef} style={{background:C.forest, transition:'background-color 0.1s linear'}}>

      {/* ══════════════════════════════════════════════════════
          HERO — asymmetric: text cols 1-7, giant := cols 7-12
          Not a 50/50. The := bleeds off the right edge.
          Single CTA only.
      ══════════════════════════════════════════════════════ */}
      <section style={{minHeight:'90vh', display:'flex', alignItems:'center', paddingTop:'5rem', paddingBottom:'5rem'}}>
        <div className="g" style={{width:'100%', alignItems:'center', position:'relative'}}>

          {/* Label row — col 1-4 */}
          <div className="c4" style={{alignSelf:'start', paddingTop:'0.5rem'}}>
            <div style={{
              fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
              textTransform:'uppercase', color:C.sage,
              borderTop:`1px solid ${C.mid}`, paddingTop:'0.75rem'
            }}>
              Equivalent Replacement Engine
            </div>
          </div>
          <div className="c8" />

          {/* Headline — cols 1-7, starts new row */}
          <div className="c7" style={{marginTop:'2rem'}}>
            <h1 style={{
              fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(2.6rem, 5.5vw, 4.8rem)',
              lineHeight:0.92, letterSpacing:'-0.025em',
              color:C.cream, margin:0,
            }}>
              Every reaction<br/>
              <span style={{color:C.gold}}>has a greener</span><br/>
              equivalent.
            </h1>
            <div style={{width:'48px', height:'1px', background:C.gold, margin:'2.5rem 0'}} />
            <p style={{
              fontFamily:SERIF, fontSize:'1.05rem', lineHeight:1.75,
              color:C.sage, maxWidth:'38ch', margin:'0 0 3rem',
            }}>
              Paste any lab protocol. Scored against all 12 Principles
              of Green Chemistry. Specific, chemically-validated swaps
              — in seconds.
            </p>
            <a href="/analyze" style={{
              display:'inline-block',
              background:C.gold, color:C.black,
              fontFamily:MONO, fontWeight:700, fontSize:'0.85rem',
              letterSpacing:'0.06em', padding:'1rem 2rem',
              textDecoration:'none',
            }}>
              ANALYZE A PROTOCOL
            </a>
          </div>

          {/* Giant := — cols 7-12, overlaps content intentionally */}
          <div className="c6" style={{
            display:'flex', alignItems:'center', justifyContent:'flex-end',
            overflow:'hidden', position:'relative',
          }}>
            <div aria-hidden="true" style={{
              fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(10rem, 20vw, 18rem)',
              lineHeight:1, letterSpacing:'-0.05em',
              color:'rgba(255,255,255,0.06)',
              userSelect:'none', whiteSpace:'nowrap',
              transform:'translateX(10%)',
            }}>:=</div>
          </div>

          {/* Stat strip — col 1-5, bottom */}
          <div className="c5" style={{
            display:'grid', gridTemplateColumns:'1fr 1fr',
            gap:'0', borderTop:`1px solid ${C.mid}`, paddingTop:'1.5rem',
          }}>
            {[['12','Green Chemistry Principles'],['<0.01¢','Per analysis run']].map(([n,l])=>(
              <div key={n} style={{paddingRight:'1.5rem'}}>
                <div style={{fontFamily:MONO, fontSize:'1.75rem', fontWeight:700,
                  color:C.gold, letterSpacing:'-0.02em'}}>{n}</div>
                <div style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.1em',
                  textTransform:'uppercase', color:C.sage, marginTop:'0.25rem',
                  lineHeight:1.4}}>{l}</div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          HOW IT WORKS — gold flood
          Steps as GIANT numbers (oversized type as structure).
          Not a card row. Not icons. The number IS the section.
          Each step: giant number left, text right.
      ══════════════════════════════════════════════════════ */}
      <section id="how-it-works" style={{background:C.gold, paddingTop:'6rem', paddingBottom:'6rem'}}>
        <div className="g">
          {/* Section label */}
          <div className="c12" style={{borderTop:`2px solid ${C.black}`, paddingTop:'1.5rem', marginBottom:'4rem'}}>
            <span style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
              textTransform:'uppercase', color:C.forest}}>Process</span>
            <h2 style={{fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(2.2rem,4vw,3.5rem)', lineHeight:0.92,
              letterSpacing:'-0.025em', color:C.black, margin:'0.75rem 0 0'}}>
              How It Works
            </h2>
          </div>

          {/* Step 01 — number cols 1-3, text cols 4-8 */}
          {[
            {n:'01', head:'Paste Your Protocol',
             body:'Drop in any lab protocol — synthesis steps, reagents, solvents, conditions. Plain text, PDF-extracted, or directly from ELN.'},
            {n:'02', head:'Scored Against 12 Principles',
             body:'Each step is evaluated across all 12 Green Chemistry principles. Hazard data from PubChem. Solvent data from CHEM21. Atom economy from structure.'},
            {n:'03', head:'Accept or Reject Swaps',
             body:'Specific, chemically-validated substitution proposals — not generic advice. One click to accept; your modified protocol is ready to export.'},
          ].map(({n,head,body},i) => (
            <div key={n} className="c12" style={{
              display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:'1.5rem',
              borderTop:`1px solid ${C.goldDark}`,
              paddingTop:'2.5rem', paddingBottom:'2.5rem',
              marginBottom: i < 2 ? '0' : '0',
            }}>
              {/* Oversized step number — structural type */}
              <div style={{gridColumn:'span 3', display:'flex', alignItems:'flex-start'}}>
                <div aria-hidden="true" style={{
                  fontFamily:MONO, fontWeight:700,
                  fontSize:'clamp(6rem, 12vw, 10rem)',
                  lineHeight:0.85, letterSpacing:'-0.04em',
                  color:C.goldDark,
                }}>{n}</div>
              </div>
              {/* Text — 5 cols, offset from center */}
              <div style={{gridColumn:'span 5', display:'flex', flexDirection:'column', justifyContent:'center'}}>
                <h3 style={{fontFamily:SERIF, fontSize:'1.35rem', fontWeight:700,
                  color:C.black, margin:'0 0 0.75rem'}}>{head}</h3>
                <p style={{fontFamily:SERIF, fontSize:'0.95rem', lineHeight:1.75,
                  color:C.forest, margin:0}}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          12 PRINCIPLES — cream flood
          4×3 grid. Each cell: principle number as knockout,
          label + short description. Hairline gaps = grid lines.
      ══════════════════════════════════════════════════════ */}
      <section id="principles" style={{background:C.cream, paddingTop:'6rem', paddingBottom:'6rem'}}>
        <div className="g">
          <div className="c12" style={{borderBottom:`1px solid ${C.creamDark}`, paddingBottom:'1.5rem', marginBottom:'3rem',
            display:'flex', alignItems:'flex-end', justifyContent:'space-between'}}>
            <div>
              <span style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
                textTransform:'uppercase', color:C.goldDark, display:'block', marginBottom:'0.5rem'}}>Framework</span>
              <h2 style={{fontFamily:MONO, fontWeight:700,
                fontSize:'clamp(1.8rem,3.5vw,3rem)', lineHeight:0.92,
                letterSpacing:'-0.02em', color:C.forest, margin:0}}>
                The 12 Principles<br/>of Green Chemistry
              </h2>
            </div>
            <a href="/analyze" style={{fontFamily:MONO, fontSize:'0.7rem',
              color:C.vivid, letterSpacing:'0.05em',
              textDecoration:'underline', textUnderlineOffset:'3px'}}>
              Score your protocol →
            </a>
          </div>

          {/* Principle grid — 12-col outer, 4 cells per row using gap-as-hairline trick */}
          <div className="c12" style={{
            display:'grid', gridTemplateColumns:'repeat(4,1fr)',
            gap:'1px', background:'#C8C2B0',
          }}>
            {[
              {n:1,l:'Prevention',s:'Waste prevention over treatment'},
              {n:2,l:'Atom Economy',s:'Maximize atom incorporation'},
              {n:3,l:'Less Hazardous',s:'Design safer syntheses'},
              {n:4,l:'Safer Chemicals',s:'Reduce toxicity by design'},
              {n:5,l:'Safer Solvents',s:'Avoid auxiliary substances'},
              {n:6,l:'Energy Efficiency',s:'Minimize energy input'},
              {n:7,l:'Renewable Feedstocks',s:'Use renewable raw materials'},
              {n:8,l:'Reduce Derivatives',s:'Avoid unnecessary steps'},
              {n:9,l:'Catalysis',s:'Use catalytic reagents'},
              {n:10,l:'Design for Degradation',s:'Products should break down'},
              {n:11,l:'Real-time Analysis',s:'Monitor, prevent pollution'},
              {n:12,l:'Accident Prevention',s:'Inherently safer chemistry'},
            ].map(({n,l,s}) => (
              <div key={n} style={{background:C.cream, padding:'1.5rem 1.25rem', position:'relative', overflow:'hidden', minHeight:'130px'}}>
                <div aria-hidden="true" style={{
                  position:'absolute', bottom:'-0.2em', right:'0.1em',
                  fontFamily:MONO, fontWeight:700, fontSize:'5rem',
                  lineHeight:1, color:C.creamDark, userSelect:'none', pointerEvents:'none',
                }}>{n}</div>
                <div style={{position:'relative', zIndex:1}}>
                  <div style={{fontFamily:MONO, fontSize:'0.6rem', letterSpacing:'0.12em',
                    textTransform:'uppercase', color:C.goldDark, marginBottom:'0.4rem'}}>P{n}</div>
                  <div style={{fontFamily:SERIF, fontSize:'0.9rem', fontWeight:700,
                    color:C.forest, marginBottom:'0.3rem'}}>{l}</div>
                  <div style={{fontSize:'0.75rem', color:C.mid, lineHeight:1.5}}>{s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          SHOWCASE — near-black, browser-chrome frame
          Tab switcher: Scorecard / Recommendations / Before & After
          Real data from Triazolo-Peptidomimetics protocol.
      ══════════════════════════════════════════════════════ */}
      <section id="showcase" style={{background:C.black, paddingTop:'6rem', paddingBottom:'6rem'}}
        onMouseEnter={() => setShowcasePaused(true)}
        onMouseLeave={() => setShowcasePaused(false)}
      >
        <div className="g">
          {/* Section label + headline */}
          <div className="c12" style={{borderTop:`1px solid ${C.mid}`, paddingTop:'3rem', marginBottom:'1.5rem'}}>
            <span style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
              textTransform:'uppercase', color:C.sage}}>The Product</span>
          </div>
          <div className="c7" style={{marginBottom:'3rem'}}>
            <h2 style={{fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(2rem,4vw,3rem)', lineHeight:0.92,
              letterSpacing:'-0.025em', color:C.cream, margin:0}}>
              From protocol<br/>to greener lab<br/>in minutes.
            </h2>
          </div>
          <div className="c4 cs9" style={{display:'flex', alignItems:'flex-end', marginBottom:'3rem'}}>
            <p style={{fontFamily:SERIF, fontSize:'0.9rem', lineHeight:1.75,
              color:C.sage, margin:0}}>
              Triazolo-peptidomimetic synthesis — 38 recommendations,
              12 principles scored, full revised protocol. Actual output.
            </p>
          </div>

          {/* Tab switcher — outside the frame, clearly navigational */}
          <div className="c12" style={{
            display:'flex', gap:'0.5rem', marginBottom:'1.5rem', flexWrap:'wrap',
            alignItems:'center',
          }}>
            {([
              ['recommendations', 'Recommendations (38)'],
              ['protocol',        'Before & After'],
              ['scorecard',       'Scorecard'],
            ] as const).map(([id, label]) => {
              const active = showcaseTab === id
              return (
                <button key={id}
                  onClick={() => {
                    setShowcaseTab(id)
                    setShowcasePaused(true)
                  }}
                  style={{
                    position:'relative', overflow:'hidden',
                    fontFamily:MONO, fontSize:'0.75rem', fontWeight:700,
                    letterSpacing:'0.06em', padding:'0.6rem 1.25rem',
                    border: active ? `1px solid ${C.gold}` : `1px solid ${C.mid}`,
                    background: active ? C.gold : 'transparent',
                    color: active ? C.black : C.sage,
                    cursor:'pointer', borderRadius:'2px',
                    transition:'color 0.15s, background 0.15s, border-color 0.15s',
                  }}
                >
                  {label}
                  {/* Progress bar — only on active tab, resets via key, pauses on hover */}
                  {active && (
                    <span
                      key={id + String(showcasePaused)}
                      style={{
                        position:'absolute', bottom:0, left:0, height:'2px',
                        background: C.black, opacity: 0.35,
                        animation: `showcase-progress 10s linear ${showcasePaused ? 'paused' : 'running'}`,
                      }}
                    />
                  )}
                </button>
              )
            })}
            <span style={{
              fontFamily:MONO, fontSize:'0.6rem', color:C.mid,
              letterSpacing:'0.1em', marginLeft:'0.5rem',
            }}>
              {showcasePaused ? 'PAUSED' : 'AUTO'}
            </span>
          </div>

          {/* Browser chrome frame */}
          <div className="c12" style={{
            borderRadius:'8px', overflow:'hidden',
            border:`1px solid ${C.mid}`,
            boxShadow:'0 32px 80px rgba(0,0,0,0.5)',
          }}>
            {/* Chrome bar */}
            <div style={{
              background:'#1A2E21', padding:'0.75rem 1rem',
              display:'flex', alignItems:'center', gap:'0.75rem',
              borderBottom:`1px solid ${C.mid}`,
            }}>
              <div style={{display:'flex', gap:'6px'}}>
                {['#FF5F57','#FFBD2E','#28C840'].map(c => (
                  <div key={c} style={{width:'12px', height:'12px', borderRadius:'50%', background:c}} />
                ))}
              </div>
              <div style={{
                flex:1, maxWidth:'480px', margin:'0 auto',
                background:'#0D1F16', borderRadius:'4px',
                padding:'0.3rem 0.75rem',
                fontFamily:MONO, fontSize:'0.65rem', color:C.sage,
                letterSpacing:'0.03em',
              }}>
                app.greenchemistry.ai/analyze/triazolo-peptidomimetics
              </div>
            </div>

            {/* App content area */}
            <div style={{background:'#F5F0E8', minHeight:'520px'}}>

              {/* ── TAB: SCORECARD ── */}
              {showcaseTab === 'scorecard' && (
                <div style={{padding:'1.5rem 2rem', maxWidth:'680px'}}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem'}}>
                    <h3 style={{fontFamily:SERIF, fontWeight:700, fontSize:'1.05rem', color:'#1C1917', margin:0}}>
                      Green Chemistry Scorecard
                    </h3>
                    <div style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
                      <span style={{fontFamily:MONO, fontSize:'0.75rem', color:'#78716C'}}>56.1 / 120</span>
                      <span style={{fontFamily:MONO, fontWeight:700, fontSize:'1.3rem',
                        padding:'0.2rem 0.6rem', borderRadius:'6px',
                        background:'#FEF3C7', color:'#92400E'}}>C</span>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:'1rem', flexWrap:'wrap',
                    fontFamily:MONO, fontSize:'0.65rem', color:'#A8A29E',
                    marginBottom:'1rem'}}>
                    <span>Lower = greener</span>
                    <span>· ~ = benchmarked</span>
                    <span>· ≈ = AI-estimated</span>
                    <span>· Click for details</span>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:'0.6rem'}}>
                    {[
                      {n:1,  name:'Waste Prevention',       score:6.99, conf:'benchmark'},
                      {n:2,  name:'Atom Economy',           score:4.56, conf:'calculated'},
                      {n:3,  name:'Less Hazardous',         score:5.17, conf:'calculated'},
                      {n:4,  name:'Safer Chemicals',        score:0.00, conf:'partial'},
                      {n:5,  name:'Safer Solvents',         score:6.42, conf:'calculated'},
                      {n:6,  name:'Energy Efficiency',      score:3.78, conf:'calculated'},
                      {n:7,  name:'Renewable Feedstocks',   score:9.51, conf:'calculated'},
                      {n:8,  name:'Reduce Derivatives',     score:6.67, conf:'estimated'},
                      {n:9,  name:'Catalysis',              score:7.14, conf:'calculated'},
                      {n:10, name:'Degradation',            score:1.68, conf:'calculated'},
                      {n:11, name:'Real-Time Analysis',     score:2.00, conf:'estimated'},
                      {n:12, name:'Accident Prevention',    score:2.15, conf:'calculated'},
                    ].map(({n, name, score, conf}) => {
                      const pct = (score / 10) * 100
                      const barColor = pct <= 30 ? '#16a34a' : pct <= 60 ? '#D97706' : '#DC2626'
                      const label = conf === 'benchmark' ? '~' : conf === 'estimated' ? '≈' : ''
                      return (
                        <div key={n}>
                          <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'3px'}}>
                            <span style={{fontFamily:MONO, fontSize:'0.68rem', fontWeight:700,
                              color:'#1C1917', minWidth:'24px'}}>P{n}</span>
                            <span style={{fontFamily:MONO, fontSize:'0.68rem', color:'#57534E', flex:1}}>{name}</span>
                            <span style={{fontFamily:MONO, fontSize:'0.68rem',
                              color: score === 0 ? '#A8A29E' : barColor, minWidth:'36px', textAlign:'right'}}>
                              {score === 0 ? 'N/A' : `${label}${score.toFixed(1)}`}
                            </span>
                          </div>
                          <div style={{height:'6px', borderRadius:'3px', background:'#EAE6D8', overflow:'hidden'}}>
                            <div style={{
                              height:'100%', borderRadius:'3px',
                              width: score === 0 ? '0%' : `${Math.max(pct, 2)}%`,
                              background: score === 0 ? '#D6D0C4' : barColor,
                              transition:'width 0.4s ease',
                            }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    paddingTop:'1rem', marginTop:'1rem',
                    borderTop:'1px solid #D6D0C4',
                    fontFamily:MONO, fontSize:'0.65rem', color:'#78716C',
                  }}>
                    <span>11 of 12 principles scored deterministically · 1 needs additional data</span>
                  </div>
                </div>
              )}

              {/* ── TAB: RECOMMENDATIONS ── */}
              {showcaseTab === 'recommendations' && (
                <div style={{padding:'1.5rem 2rem', display:'flex', flexDirection:'column', gap:'0.875rem', maxWidth:'900px'}}>
                  <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.25rem'}}>
                    <h3 style={{fontFamily:SERIF, fontWeight:700, fontSize:'1.05rem', color:'#1C1917', margin:0}}>
                      Recommendations (38)
                    </h3>
                    <span style={{fontFamily:MONO, fontSize:'0.65rem', fontWeight:700,
                      padding:'0.2rem 0.6rem', borderRadius:'20px',
                      background:'#DCFCE7', color:'#16a34a'}}>1 accepted</span>
                  </div>

                  {/* Rec 1 — ACCEPTED */}
                  {(() => {
                    const isAccepted = true
                    return (
                      <div style={{
                        padding:'1rem', borderRadius:'8px',
                        border: `1px solid #16a34a`,
                        background:'#F0FDF4',
                        boxShadow:'0 0 15px rgba(22,163,74,0.1)',
                        outline: '2px solid #16a34a',
                      }}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem', marginBottom:'0.6rem', flexWrap:'wrap'}}>
                          <div style={{display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                            <span style={{fontFamily:MONO, fontWeight:700, fontSize:'0.8rem', color:'#1C1917'}}>Step 1</span>
                            <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontWeight:700, fontFamily:MONO,
                              textTransform:'uppercase', background:'#FEE2E2', color:'#DC2626'}}>HIGH</span>
                            <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontFamily:MONO,
                              background:'#F0EBE1', color:'#78716C'}}>high confidence</span>
                          </div>
                          <button style={{
                            fontFamily:MONO, fontSize:'0.65rem', fontWeight:700,
                            letterSpacing:'0.06em', padding:'0.35rem 0.8rem',
                            borderRadius:'20px', border:'1px solid #16a34a',
                            background:'#16a34a', color:'white', cursor:'pointer',
                          }}>✓ Accepted</button>
                        </div>
                        <div style={{display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.75rem'}}>
                          {[{n:'#1', label:'Prevention', bg:'#DCFCE7', c:'#15803d'},
                            {n:'#3', label:'Less Hazardous', bg:'#DCFCE7', c:'#2D6A4F'},
                            {n:'#5', label:'Safer Solvents', bg:'#DBEAFE', c:'#1d4ed8'},
                            {n:'#12',label:'Accident Prevention', bg:'#EDE9FE', c:'#7e22ce'},
                          ].map(t => (
                            <span key={t.n} style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:500,
                              padding:'0.15rem 0.5rem', borderRadius:'20px',
                              background:t.bg, color:t.c}}>{t.n} {t.label}</span>
                          ))}
                        </div>
                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem'}}>
                          <div style={{padding:'0.75rem', borderRadius:'6px', background:'#FEF2F2'}}>
                            <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700,
                              color:'#DC2626', marginBottom:'0.3rem'}}>ORIGINAL</div>
                            <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem',
                              color:'#1C1917', marginBottom:'0.3rem'}}>DMF</div>
                            <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#78716C', margin:0, lineHeight:1.5}}>
                              Classified carcinogen (CMR1B). Used as primary solvent across all 9 synthesis steps.
                            </p>
                          </div>
                          <div style={{padding:'0.75rem', borderRadius:'6px', background:'#DCFCE7'}}>
                            <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700,
                              color:'#16a34a', marginBottom:'0.3rem'}}>RECOMMENDED</div>
                            <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem',
                              color:'#1C1917', marginBottom:'0.3rem'}}>DMSO</div>
                            <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#2D6A4F', margin:0, lineHeight:1.5}}>
                              Comparable performance in SPPS. Non-carcinogenic. Eliminates CMR1B exposure across all steps.
                            </p>
                            <p style={{fontFamily:MONO, fontSize:'0.6rem', color:'#78716C', margin:'0.4rem 0 0', lineHeight:1.4}}>
                              <strong>Yield:</strong> Comparable; DMSO&apos;s higher bp may aid microwave steps
                            </p>
                            <p style={{fontFamily:MONO, fontSize:'0.6rem', color:'#A8A29E', margin:'0.2rem 0 0'}}>
                              Source: CHEM21 solvent guide, PubChem
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Rec 2 — PENDING */}
                  <div style={{
                    padding:'1rem', borderRadius:'8px',
                    border:'1px solid #D6D0C4', background:'#FAFAF8',
                  }}>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem', marginBottom:'0.6rem', flexWrap:'wrap'}}>
                      <div style={{display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                        <span style={{fontFamily:MONO, fontWeight:700, fontSize:'0.8rem', color:'#1C1917'}}>Step 2</span>
                        <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontWeight:700, fontFamily:MONO,
                          textTransform:'uppercase', background:'#FEF3C7', color:'#D97706'}}>MEDIUM</span>
                        <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontFamily:MONO,
                          background:'#F0EBE1', color:'#78716C'}}>high confidence</span>
                      </div>
                      <button style={{
                        fontFamily:MONO, fontSize:'0.65rem', fontWeight:700,
                        letterSpacing:'0.06em', padding:'0.35rem 0.8rem',
                        borderRadius:'20px', border:'1px solid #D6D0C4',
                        background:'white', color:'#78716C', cursor:'pointer',
                      }}>Accept Solution</button>
                    </div>
                    <div style={{display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.75rem'}}>
                      {[{n:'#1', label:'Prevention', bg:'#DCFCE7', c:'#15803d'},
                        {n:'#6', label:'Energy Efficiency', bg:'#DBEAFE', c:'#2563eb'},
                      ].map(t => (
                        <span key={t.n} style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:500,
                          padding:'0.15rem 0.5rem', borderRadius:'20px',
                          background:t.bg, color:t.c}}>{t.n} {t.label}</span>
                      ))}
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem'}}>
                      <div style={{padding:'0.75rem', borderRadius:'6px', background:'#FEF2F2'}}>
                        <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700, color:'#DC2626', marginBottom:'0.3rem'}}>ORIGINAL</div>
                        <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem', color:'#1C1917', marginBottom:'0.3rem'}}>5 equiv AA + DIC + HOBt</div>
                        <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#78716C', margin:0, lineHeight:1.5}}>
                          5 equivalents excess generates significant chemical waste without proportional yield benefit.
                        </p>
                      </div>
                      <div style={{padding:'0.75rem', borderRadius:'6px', background:'#F0FDF4'}}>
                        <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700, color:'#16a34a', marginBottom:'0.3rem'}}>RECOMMENDED</div>
                        <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem', color:'#1C1917', marginBottom:'0.3rem'}}>3 equiv with optimized conditions</div>
                        <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#2D6A4F', margin:0, lineHeight:1.5}}>
                          Comparable coupling efficiency (&gt;98%) with 40% less amino acid waste per cycle.
                        </p>
                        <p style={{fontFamily:MONO, fontSize:'0.6rem', color:'#78716C', margin:'0.4rem 0 0'}}>
                          <strong>Yield:</strong> Comparable with optimized coupling time
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Rec 3 — PENDING */}
                  <div style={{
                    padding:'1rem', borderRadius:'8px',
                    border:'1px solid #D6D0C4', background:'#FAFAF8',
                  }}>
                    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem', marginBottom:'0.6rem', flexWrap:'wrap'}}>
                      <div style={{display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap'}}>
                        <span style={{fontFamily:MONO, fontWeight:700, fontSize:'0.8rem', color:'#1C1917'}}>Step 12</span>
                        <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontWeight:700, fontFamily:MONO,
                          textTransform:'uppercase', background:'#FEE2E2', color:'#DC2626'}}>HIGH</span>
                        <span style={{padding:'0.15rem 0.4rem', borderRadius:'4px', fontSize:'0.65rem', fontFamily:MONO,
                          background:'#F0EBE1', color:'#78716C'}}>high confidence</span>
                      </div>
                      <button style={{
                        fontFamily:MONO, fontSize:'0.65rem', fontWeight:700,
                        letterSpacing:'0.06em', padding:'0.35rem 0.8rem',
                        borderRadius:'20px', border:'1px solid #D6D0C4',
                        background:'white', color:'#78716C', cursor:'pointer',
                      }}>Accept Solution</button>
                    </div>
                    <div style={{display:'flex', gap:'0.35rem', flexWrap:'wrap', marginBottom:'0.75rem'}}>
                      {[{n:'#3', label:'Less Hazardous', bg:'#DCFCE7', c:'#2D6A4F'},
                        {n:'#12',label:'Accident Prevention', bg:'#EDE9FE', c:'#7e22ce'},
                      ].map(t => (
                        <span key={t.n} style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:500,
                          padding:'0.15rem 0.5rem', borderRadius:'20px',
                          background:t.bg, color:t.c}}>{t.n} {t.label}</span>
                      ))}
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem'}}>
                      <div style={{padding:'0.75rem', borderRadius:'6px', background:'#FEF2F2'}}>
                        <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700, color:'#DC2626', marginBottom:'0.3rem'}}>ORIGINAL</div>
                        <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem', color:'#1C1917', marginBottom:'0.3rem'}}>95% TFA cleavage cocktail</div>
                        <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#78716C', margin:0, lineHeight:1.5}}>
                          Trifluoroacetic acid is highly corrosive and generates fluorinated waste with long environmental persistence.
                        </p>
                      </div>
                      <div style={{padding:'0.75rem', borderRadius:'6px', background:'#F0FDF4'}}>
                        <div style={{fontFamily:MONO, fontSize:'0.6rem', fontWeight:700, color:'#16a34a', marginBottom:'0.3rem'}}>RECOMMENDED</div>
                        <div style={{fontFamily:MONO, fontWeight:700, fontSize:'0.85rem', color:'#1C1917', marginBottom:'0.3rem'}}>Hydrochloric acid alternative</div>
                        <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#2D6A4F', margin:0, lineHeight:1.5}}>
                          HCl-based cleavage eliminates persistent fluorinated byproducts. Comparable deprotection for standard amino acids.
                        </p>
                        <p style={{fontFamily:MONO, fontSize:'0.6rem', color:'#78716C', margin:'0.4rem 0 0'}}>
                          <strong>Yield:</strong> Verify efficiency for Pbf-protected Arg residues
                        </p>
                      </div>
                    </div>
                  </div>

                  <p style={{fontFamily:MONO, fontSize:'0.65rem', color:'#A8A29E', margin:'0.25rem 0 0', textAlign:'center'}}>
                    + 35 more recommendations across steps 1–14
                  </p>
                </div>
              )}

              {/* ── TAB: BEFORE & AFTER ── */}
              {showcaseTab === 'protocol' && (
                <div style={{padding:'1.5rem 2rem'}}>
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem'}}>
                    {/* Original */}
                    <div>
                      <h3 style={{fontFamily:MONO, fontWeight:700, fontSize:'0.72rem',
                        letterSpacing:'0.08em', textTransform:'uppercase',
                        color:'#DC2626', marginBottom:'0.75rem'}}>Original Protocol</h3>
                      <pre style={{
                        padding:'1rem', borderRadius:'6px',
                        fontFamily:MONO, fontSize:'0.72rem', lineHeight:1.7,
                        whiteSpace:'pre-wrap', margin:0,
                        background:'#FEF2F2', color:'#1C1917',
                        border:'1px solid #FECACA',
                        maxHeight:'480px', overflowY:'auto',
                      }}>{`Step 1 — Resin Swelling
Suspend 0.03 mmol Wang resin in DMF (5 mL).
Heat to 70°C for 30 min with agitation.
Drain and wash 3× with DMF (3 mL each).

Step 2 — First Fmoc Deprotection
Add 20% piperidine in DMF (4 mL).
React at room temperature, 20 min.
Drain. Wash 3× DMF, 3× DCM, 3× DMF.
Repeat deprotection once.

Step 3 — Amino Acid Coupling
Activate Fmoc-AA-OH (5 equiv) with
DIC (5 equiv) + HOBt (5 equiv) in DMF.
Add to resin, 75°C, 5 min (microwave).
Wash 3× with DMF.

Step 12 — Global Deprotection & Cleavage
Add cleavage cocktail: 95% TFA,
2.5% H₂O, 2.5% TIPS (1 mL, 2 h, RT).
Precipitate with cold MTBE (10 mL).
Centrifuge. Decant. Dry under N₂.`}</pre>
                    </div>

                    {/* Revised */}
                    <div>
                      <h3 style={{fontFamily:MONO, fontWeight:700, fontSize:'0.72rem',
                        letterSpacing:'0.08em', textTransform:'uppercase',
                        color:'#16a34a', marginBottom:'0.75rem'}}>Revised Protocol</h3>
                      <pre style={{
                        padding:'1rem', borderRadius:'6px',
                        fontFamily:MONO, fontSize:'0.72rem', lineHeight:1.7,
                        whiteSpace:'pre-wrap', margin:0,
                        background:'#F0FDF4', color:'#1C1917',
                        border:'1px solid #BBF7D0',
                        maxHeight:'480px', overflowY:'auto',
                      }}>{`Step 1 — Resin Swelling  ✓ OPTIMIZED
Suspend 0.03 mmol Wang resin in DMSO (5 mL).
[DMF → DMSO: eliminates CMR1B carcinogen]
Swell at room temperature, 45 min.
[70°C → RT: ~84% energy reduction]
Drain and wash 3× with DMSO (3 mL each).

Step 2 — First Fmoc Deprotection  ✓ OPTIMIZED
Add 20% piperidine in DMSO (4 mL).
React at room temperature, 20 min.
Drain. Wash 3× DMSO, 3× EtOAc, 3× DMSO.
[DCM → EtOAc: removes chlorinated solvent]
Repeat deprotection once.

Step 3 — Amino Acid Coupling  ✓ OPTIMIZED
Activate Fmoc-AA-OH (3 equiv) with
DIC (3 equiv) + HOBt (3 equiv) in DMSO.
[5 equiv → 3 equiv: 40% less AA waste]
Add to resin, 50°C, 8 min (microwave).
[75°C → 50°C: reduces energy, side reactions]
Wash 3× with DMSO.

Step 12 — Global Deprotection & Cleavage  ✓ OPTIMIZED
Add cleavage cocktail: 4M HCl in dioxane
(1 mL, 2 h, RT).
[TFA → HCl: eliminates fluorinated waste]
Precipitate with cold 2-MeTHF (10 mL).
[MTBE → 2-MeTHF: renewable feedstock]
Centrifuge. Decant. Dry under N₂.`}</pre>
                    </div>
                  </div>

                  {/* Impact summary bar */}
                  <div style={{
                    marginTop:'1rem', padding:'0.875rem 1rem',
                    borderRadius:'6px', background:'#ECFDF5',
                    border:'1px solid #BBF7D0',
                    display:'flex', gap:'2rem', flexWrap:'wrap',
                    fontFamily:MONO, fontSize:'0.7rem',
                  }}>
                    <span style={{color:'#16a34a', fontWeight:700}}>Changes accepted: 1 of 38</span>
                    <span style={{color:'#2D6A4F'}}>DMF eliminated from Step 1</span>
                    <span style={{color:'#2D6A4F'}}>Grade: C → projected B with all accepted</span>
                    <span style={{color:'#A8A29E', marginLeft:'auto'}}>Powered by RDKit + PubChem</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          THE STACK — dark forest flood
          Asymmetric: claim cols 1-7, stack facts cols 9-12.
          Giant float-left "R" dropcap on claim paragraph.
          Right col: energy stat chip + research-to-production facts.
      ══════════════════════════════════════════════════════ */}
      <section id="enterprise" style={{background:C.forest, paddingTop:'6rem', paddingBottom:'6rem'}}>
        <div className="g">
          <div className="c12" style={{borderTop:`1px solid ${C.mid}`, paddingTop:'3rem', marginBottom:'4rem'}}>
            <span style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
              textTransform:'uppercase', color:C.sage}}>The Stack</span>
          </div>

          {/* Claim — cols 1-7 */}
          <div className="c7">
            {/* Float-left dropcap R */}
            <div style={{
              float:'left', fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(7rem,13vw,11rem)', lineHeight:0.8,
              color:C.gold, marginRight:'0.12em', marginBottom:0,
            }} aria-hidden="true">R</div>
            <p style={{
              fontFamily:SERIF, fontSize:'clamp(1.2rem,2.2vw,1.7rem)',
              lineHeight:1.55, color:C.cream, margin:0,
            }}>
              DKit and PubChem power every recommendation.
              GreenChemistry.ai is AI as interface — making decades of
              deterministic cheminformatics accessible in a conversation.
            </p>
            <div style={{clear:'both', height:'2rem'}} />
            <div style={{width:'40px', height:'2px', background:C.gold, marginBottom:'1.5rem'}} />
            <p style={{fontFamily:SERIF, fontSize:'0.95rem', lineHeight:1.75,
              color:C.sage, maxWidth:'46ch', margin:0}}>
              Chemistry is solved math. The scoring algorithms are deterministic,
              auditable, and citable — AI handles the interface, not the science.
              The same engine that runs a single research protocol scales to
              production-grade deployment across an entire R&amp;D org.
            </p>
          </div>

          {/* Stack facts — cols 9-12 */}
          <div className="c4 cs9">
            {/* Energy stat chip */}
            <div style={{background:C.black, padding:'1.5rem', marginBottom:'0.1rem'}}>
              <div style={{fontFamily:MONO, fontSize:'0.6rem', letterSpacing:'0.12em',
                textTransform:'uppercase', color:C.goldDark, marginBottom:'1rem'}}>
                Actually Green AI
              </div>
              <div style={{display:'flex', alignItems:'flex-end', gap:'0.75rem', marginBottom:'0.75rem'}}>
                <span style={{fontFamily:MONO, fontWeight:700, fontSize:'2.6rem',
                  color:C.gold, lineHeight:1}}>&lt;0.1%</span>
                <div style={{fontFamily:SERIF, fontSize:'0.8rem', color:C.cream,
                  lineHeight:1.3, paddingBottom:'0.2rem'}}>the energy cost<br/>of a SOTA model</div>
              </div>
              <div style={{fontFamily:MONO, fontSize:'0.65rem', color:C.sage, lineHeight:1.6}}>
                Typical LLM inference: ~10,000W.<br/>
                Ours: one local, high-memory,<br/>
                low-power machine.
              </div>
            </div>

            {/* Stack facts list */}
            {[
              {label:'Cheminformatics', value:'RDKit', sub:'Industry-standard. Auditable. Reproducible.'},
              {label:'Chemistry Database', value:'PubChem', sub:'NCBI\'s public compound database. Citable.'},
              {label:'Deployment Path', value:'Research → Production', sub:'Same engine, lab bench to org-wide.'},
            ].map(({label, value, sub}) => (
              <div key={label} style={{borderBottom:`1px solid ${C.mid}`, padding:'1rem 0'}}>
                <div style={{fontFamily:MONO, fontSize:'0.6rem', letterSpacing:'0.15em',
                  textTransform:'uppercase', color:C.sage, marginBottom:'0.25rem'}}>{label}</div>
                <div style={{fontFamily:SERIF, fontSize:'0.95rem', fontWeight:700,
                  color:C.cream, marginBottom:'0.2rem'}}>{value}</div>
                <div style={{fontFamily:MONO, fontSize:'0.65rem', color:C.sage,
                  lineHeight:1.4}}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          CONTACT — sage flood
          Asymmetric: headline cols 1-5, CTAs cols 7-11.
          Single free CTA + enterprise email.
          No form. No badges. No FAQs.
      ══════════════════════════════════════════════════════ */}
      <section id="contact" style={{background:C.sage, paddingTop:'6rem', paddingBottom:'6rem'}}>
        <div className="g">
          <div className="c12" style={{borderTop:`2px solid ${C.forest}`,
            paddingTop:'3rem', marginBottom:'4rem'}}>
            <span style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.2em',
              textTransform:'uppercase', color:C.forest}}>Enterprise Access</span>
          </div>

          {/* Headline — cols 1-5 */}
          <div className="c5">
            <h2 style={{
              fontFamily:MONO, fontWeight:700,
              fontSize:'clamp(2rem,4vw,3.2rem)',
              lineHeight:0.92, letterSpacing:'-0.025em',
              color:C.forest, margin:0,
            }}>
              Talk to us<br/>before your<br/>next synthesis.
            </h2>
            <div style={{width:'40px', height:'2px', background:C.forest, margin:'2rem 0'}} />
            <p style={{fontFamily:SERIF, color:C.forest, fontSize:'0.95rem',
              lineHeight:1.75, maxWidth:'38ch', margin:0}}>
              Custom integrations, ELN connectors, DOZN export, and team
              dashboards for R&amp;D teams and sustainability officers.
            </p>
          </div>

          {/* CTAs — cols 7-11 */}
          <div className="c5 cs8" style={{display:'flex', flexDirection:'column', justifyContent:'center', gap:'0.875rem'}}>
            <a href="/analyze" style={{
              display:'block', background:C.forest, color:C.cream,
              fontFamily:MONO, fontWeight:700, fontSize:'0.85rem',
              letterSpacing:'0.06em', padding:'1.1rem 2rem',
              textDecoration:'none', textAlign:'center',
            }}>ANALYZE A PROTOCOL — FREE</a>
            <a href="mailto:hello@greenchemistry.ai?subject=Enterprise Demo Request" style={{
              display:'block', background:'transparent', color:C.forest,
              border:`2px solid ${C.forest}`,
              fontFamily:MONO, fontWeight:700, fontSize:'0.85rem',
              letterSpacing:'0.06em', padding:'1.1rem 2rem',
              textDecoration:'none', textAlign:'center',
            }}>REQUEST ENTERPRISE DEMO</a>
            <p style={{fontFamily:MONO, fontSize:'0.65rem', color:C.forest,
              textAlign:'center', margin:'0.5rem 0 0', opacity:0.7,
              letterSpacing:'0.04em'}}>hello@greenchemistry.ai</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════
          FOOTER — near-black
          Light logo. Legal. LabreNew attribution. Hairline top.
      ══════════════════════════════════════════════════════ */}
      <footer style={{background:C.black, borderTop:`1px solid ${C.forest}`}}>
        <div className="g" style={{paddingTop:'2.5rem', paddingBottom:'2.5rem'}}>
          <div className="c6" style={{display:'flex', alignItems:'center', gap:'0.75rem'}}>
            <Mark size={24} />
            <img src="/logo-wide-light.svg" alt="GreenChemistry.ai"
              style={{height:'18px', width:'auto', opacity:0.7}} />
          </div>
          <div className="c6" style={{display:'flex', flexDirection:'column',
            alignItems:'flex-end', justifyContent:'center', gap:'0.3rem'}}>
            <div style={{fontFamily:MONO, fontSize:'0.65rem', color:'#4A6B58', letterSpacing:'0.04em'}}>
              © 2026 GreenChemistry.ai
            </div>
            <div style={{fontFamily:MONO, fontSize:'0.65rem', color:'#4A6B58', letterSpacing:'0.04em'}}>
              Recommendations require experimental validation.
            </div>
            <div style={{fontFamily:MONO, fontSize:'0.65rem', letterSpacing:'0.04em'}}>
              <a href="https://labrenew.org" target="_blank" rel="noopener noreferrer"
                style={{color:C.sage, textDecoration:'underline', textUnderlineOffset:'2px'}}>
                Built with LabreNew.org
              </a>
            </div>
          </div>
        </div>
      </footer>

      </div>{/* end scroll-color wrapper */}
    </>
  )
}
