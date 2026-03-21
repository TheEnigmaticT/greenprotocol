'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { EXAMPLE_PROTOCOLS } from '@/lib/prompts'
import { ProgressEvent } from '@/lib/types'

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

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const [quipIndex, setQuipIndex] = useState(() => Math.floor(Math.random() * SCIENCE_QUIPS.length))
  const [fade, setFade] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setQuipIndex(prev => (prev + 1) % SCIENCE_QUIPS.length)
        setFade(true)
      }, 400)
    }, 6000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="w-full space-y-2">
      <div
        className="relative w-full h-10 rounded-lg overflow-hidden border"
        style={{ background: '#F5F0E8', borderColor: '#D6D0C4' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
          style={{
            width: `${Math.max(pct, 3)}%`,
            background: 'linear-gradient(90deg, #1B4332, #2D6A4F)',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <span
            className="text-sm font-[family-name:var(--font-mono)] transition-opacity duration-300"
            style={{
              color: '#57534E',
              opacity: fade ? 1 : 0,
            }}
          >
            {SCIENCE_QUIPS[quipIndex]}
          </span>
        </div>
        <div className="absolute inset-y-0 right-3 flex items-center">
          <span
            className="text-xs font-[family-name:var(--font-mono)] tabular-nums"
            style={{ color: '#A8A29E' }}
          >
            {completed}/{total}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ProtocolInput() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const router = useRouter()

  async function handleSubmit() {
    if (!text.trim() || text.trim().length < 20) {
      setError('Please enter a chemistry protocol (at least a few sentences).')
      return
    }

    setLoading(true)
    setError(null)
    setCompleted(0)
    setTotal(14)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolText: text }),
      })

      if (res.status === 401) {
        router.push('/login')
        return
      }

      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json()
        if (data.error === 'not_chemistry') {
          setError("This doesn't look like a chemistry protocol. Try one of our examples!")
        } else if (data.error === 'run_limit_reached') {
          setError(`You've used all ${data.limit} of your available analyses. Contact us at hello@greenchemistry.ai to unlock more.`)
        } else {
          setError(data.error || 'Analysis failed. Please try again.')
        }
        setLoading(false)
        return
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: ProgressEvent
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === 'phase') {
            if (event.phase === 2) setCompleted(1)
            else if (event.phase === 3) setCompleted(13)
          } else if (event.type === 'principle') {
            if (event.status === 'complete' || event.status === 'failed') {
              setCompleted(prev => prev + 1)
            }
          } else if (event.type === 'result') {
            setCompleted(14)
            sessionStorage.setItem('gpc_analysis', JSON.stringify(event.data))
            sessionStorage.setItem('gpc_protocol', text)
            await new Promise(r => setTimeout(r, 400))
            if (event.data.id) {
              router.push(`/analyze/${event.data.id}`)
            } else {
              router.push('/analyze')
            }
            return
          } else if (event.type === 'error') {
            if (event.code === 'not_chemistry') {
              setError("This doesn't look like a chemistry protocol. Try one of our examples!")
            } else {
              setError(event.error)
            }
            setLoading(false)
            return
          }
        }
      }

      setError('Analysis stream ended unexpectedly. Please try again.')
      setLoading(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(`Request failed: ${msg}`)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.key}
            onClick={() => { setText(EXAMPLE_PROTOCOLS[ex.key]); setError(null) }}
            className="px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer font-[family-name:var(--font-mono)]"
            style={{ color: '#1B4332', borderColor: '#D6D0C4' }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#7C2D36')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
          >
            {ex.label}
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null) }}
        placeholder="Paste your chemistry protocol here...&#10;&#10;Include details like chemicals used, quantities, temperatures, and procedures."
        rows={12}
        className="w-full px-4 py-3 rounded-lg border focus:outline-none transition-colors resize-y font-[family-name:var(--font-mono)] text-sm leading-relaxed"
        style={{ background: '#F5F0E8', color: '#1C1917', borderColor: '#D6D0C4' }}
        onFocus={(e) => (e.currentTarget.style.borderColor = '#1B4332')}
        onBlur={(e) => (e.currentTarget.style.borderColor = '#D6D0C4')}
        disabled={loading}
      />

      {error && (
        <p className="text-sm" style={{ color: '#EF4444' }}>{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !text.trim()}
        className="w-full px-6 py-3 rounded-lg font-semibold text-lg transition-all disabled:opacity-50 cursor-pointer"
        style={{ background: loading ? '#5A2028' : '#7C2D36', color: '#FAF8F3' }}
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
