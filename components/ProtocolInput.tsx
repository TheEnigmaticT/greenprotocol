'use client'

import { stashCompletedAnalysis } from '@/lib/rerun-from-proposal'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { EXAMPLE_PROTOCOLS } from '@/lib/prompts'
import { AnalysisStreamRecovery } from '@/components/AnalysisStreamRecovery'
import { runAnalysis, validateProtocolText, type AnalysisProgressEvent } from '@/lib/run-analysis'
import type { HumanError } from '@/lib/errors/humanize'
import { MAX_PROTOCOL_CHARS } from '@/lib/protocol-limits'
import { PdfImportButton, PdfImportNotice } from '@/components/PdfImport'
import type { PdfImportResult } from '@/lib/pdf-import'

const EXAMPLES = [
  { label: 'Organic Extraction', key: 'organicExtraction' as const },
  { label: 'Suzuki Coupling', key: 'suzukiCoupling' as const },
  { label: 'Acid-Base Titration', key: 'acidBaseTitration' as const },
]

const SCIENCE_QUIPS = [
  'Discovering germ theory...',
  'Visiting the Galapagos Islands...',
  'Dropping balls off the Tower of Pisa...',
  'Observing the double helix...',
  'Debating phlogiston theory...',
  'Politely disagreeing with Aristotle...',
  'Researching that weird glowing rock...',
  'Describing to Boyle what an un-ideal gas is...',
  'Debating color hues with Newton...',
  'What if F=ma plus, like, 2?...',
  'Waiting for a really cold day to mark the thermometer...',
  'Grinding lenses with van Leeuwenhoek...',
  'Asking Mendeleev if he left any gaps...',
  'Helping Lavoisier weigh the air...',
  'Tasting acids with Arrhenius (don\'t try this)...',
  'Spilling something on Goodyear\'s stove...',
  'Leaving a Petri dish out with Fleming...',
  'Forgetting to close Schrodinger\'s box...',
  'Watching Curie glow in the dark...',
  'Convincing Semmelweis to wash his hands...',
  'Arguing with Dalton about colorblindness...',
  'Counting beans with Mendel\'s peas...',
  'Accidentally discovering mauve with Perkin...',
  'Trying to turn lead into gold (for science)...',
  'Holding the kite string for Franklin...',
  'Handing Kekulé a dream journal...',
  'Balancing redox equations by candlelight...',
  'Distilling the essence of green...',
  'Consulting the periodic table...',
  'Recrystallizing our thoughts...',
  'Titrating the solution space...',
  'Pipetting with great precision...',
  'Running a column on your protocol...',
  'Checking the fume hood...',
  'Calibrating the mass spec...',
  'Peer-reviewing our recommendations...',
  'Filtering through the literature...',
  'Refluxing on best practices...',
  'Evaporating unnecessary solvents...',
  'Catalyzing a greener future...',
]

function ProgressLabelRow({ color, labelOpacity, quip, completed, total }: {
  color: string
  labelOpacity: number
  quip: string
  completed: number
  total: number
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-between gap-3 px-4 pointer-events-none">
      <span className="text-sm font-[family-name:var(--font-mono)] truncate transition-opacity duration-300 motion-reduce:transition-none" style={{ color, opacity: labelOpacity }}>
        {quip}
      </span>
      <span className="text-xs font-[family-name:var(--font-mono)] tabular-nums shrink-0" style={{ color }}>
        {completed}/{total}
      </span>
    </div>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const [quipIndex, setQuipIndex] = useState(() => Math.floor(Math.random() * SCIENCE_QUIPS.length))
  const [fade, setFade] = useState(true)
  const [reduceMotion, setReduceMotion] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    intervalRef.current = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setQuipIndex(prev => (prev + 1) % SCIENCE_QUIPS.length)
        setFade(true)
      }, 400)
    }, 6000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [reduceMotion])

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const fillPct = Math.min(100, Math.max(pct, completed > 0 ? 3 : 0))
  const labelOpacity = reduceMotion || fade ? 1 : 0

  return (
    <div className="w-full space-y-2">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Analysis progress ${completed} of ${total}`}
        className="relative w-full h-10 rounded-lg overflow-hidden border"
        style={{
          background: '#F5F0E8',
          borderColor: '#D6D0C4',
          ['--pct' as string]: `${fillPct}%`,
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-lg motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
          style={{
            width: 'var(--pct)',
            background: 'linear-gradient(90deg, #1C3822, #2D6A4F)',
          }}
        />
        {/* Forest on cream track */}
        <ProgressLabelRow color="#1C3822" labelOpacity={labelOpacity} quip={SCIENCE_QUIPS[quipIndex]} completed={completed} total={total} />
        {/* Cream clipped to fill width via clip-path + --pct */}
        <div
          className="absolute inset-0"
          style={{ clipPath: 'inset(0 calc(100% - var(--pct)) 0 0)' }}
          aria-hidden="true"
        >
          <ProgressLabelRow color="#FAF8F3" labelOpacity={labelOpacity} quip={SCIENCE_QUIPS[quipIndex]} completed={completed} total={total} />
        </div>
      </div>
    </div>
  )
}

export default function ProtocolInput() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<HumanError | null>(null)
  const [streamInterrupted, setStreamInterrupted] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [pdfImport, setPdfImport] = useState<PdfImportResult | null>(null)
  const [pdfChecked, setPdfChecked] = useState(false)
  const router = useRouter()

  function handleProgress(event: AnalysisProgressEvent) {
    if (event.type === 'phase') {
      if (event.phase === 2) setCompleted(1)
      else if (event.phase === 3) setCompleted(13)
    } else if (event.type === 'principle') {
      if (event.status === 'complete' || event.status === 'failed') {
        setCompleted(prev => prev + 1)
      }
    }
  }

  async function handleSubmit() {
    const invalid = validateProtocolText(text)
    if (invalid) {
      setError(invalid)
      return
    }

    setLoading(true)
    setError(null)
    setStreamInterrupted(false)
    setCompleted(0)
    setTotal(14)

    const outcome = await runAnalysis({ protocolText: text, onProgress: handleProgress })

    if (outcome.kind === 'unauthorized') {
      router.push('/login')
      return
    }

    if (outcome.kind === 'completed') {
      setCompleted(14)
      stashCompletedAnalysis(outcome, sessionStorage)
      // Let the progress bar visibly reach 100% before leaving the page.
      setTimeout(() => router.push(`/analyze/${outcome.analysisId}`), 400)
      return
    }

    if (outcome.kind === 'failed') setError(outcome.error)
    else setStreamInterrupted(true)
    setLoading(false)
  }

  const overLimit = text.length > MAX_PROTOCOL_CHARS
  const nearLimit = text.length >= MAX_PROTOCOL_CHARS * 0.9

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.key}
            onClick={() => { setText(EXAMPLE_PROTOCOLS[ex.key]); setPdfImport(null); setError(null) }}
            className="px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer font-[family-name:var(--font-mono)]"
            style={{ color: '#1C3822', borderColor: '#D6D0C4' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1C3822')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
          >
            {ex.label}
          </button>
        ))}
        <PdfImportButton
          disabled={loading}
          onImported={(result) => { setText(result.text); setPdfImport(result); setPdfChecked(false); setError(null) }}
          onError={(message) => setError({ code: 'unknown', title: "That PDF couldn't be imported", message, action: 'none' })}
        />
      </div>

      {pdfImport && <PdfImportNotice result={pdfImport} acknowledged={pdfChecked} onAcknowledgedChange={setPdfChecked} />}

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null) }}
        placeholder="Paste your chemistry protocol here...&#10;&#10;Include details like chemicals used, quantities, temperatures, and procedures."
        rows={12}
        className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-colors resize-y font-[family-name:var(--font-mono)] text-sm leading-relaxed"
        style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#1C3822')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
        disabled={loading}
      />

      <p
        className="text-right text-xs font-[family-name:var(--font-mono)] tabular-nums"
        style={{ color: overLimit ? '#B91C1C' : nearLimit ? '#9A3412' : '#78716C' }}
        role={nearLimit ? 'status' : undefined}
      >
        {text.length.toLocaleString('en-US')} / {MAX_PROTOCOL_CHARS.toLocaleString('en-US')} characters
        {overLimit && ` — ${(text.length - MAX_PROTOCOL_CHARS).toLocaleString('en-US')} too many`}
      </p>

      {streamInterrupted && (
        <AnalysisStreamRecovery onOpenDashboard={() => router.push('/dashboard')} />
      )}

      {error && (
        <div role="alert" className="text-sm space-y-1">
          <p className="font-semibold" style={{ color: '#B91C1C' }}>{error.title}</p>
          <p style={{ color: '#7F1D1D' }}>{error.message}</p>
        </div>
      )}

      {pdfImport && !pdfChecked && (
        <p className="text-sm" style={{ color: '#78716C' }}>Tick the box above to confirm you checked the imported text, then analyze.</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !text.trim() || overLimit || (pdfImport !== null && !pdfChecked)}
        className="w-full px-6 py-3 rounded-lg font-semibold text-lg transition-all disabled:opacity-50 cursor-pointer"
        style={{ background: loading ? '#2D4A3A' : '#1C3822', color: '#F6F3EB' }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Analyzing Protocol...
          </span>
        ) : (
          'Analyze Protocol'
        )}
      </button>

      {loading && total > 0 && (
        <ProgressBar completed={completed} total={total} />
      )}
    </div>
  )
}
