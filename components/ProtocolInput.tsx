'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EXAMPLE_PROTOCOLS } from '@/lib/prompts'

const EXAMPLES = [
  { label: 'Organic Extraction', key: 'organicExtraction' as const },
  { label: 'Suzuki Coupling', key: 'suzukiCoupling' as const },
  { label: 'Acid-Base Titration', key: 'acidBaseTitration' as const },
]

export default function ProtocolInput() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit() {
    if (!text.trim() || text.trim().length < 20) {
      setError('Please enter a chemistry protocol (at least a few sentences).')
      return
    }

    setLoading(true)
    setError(null)

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

      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'not_chemistry') {
          setError("This doesn't look like a chemistry protocol. Try one of our examples!")
        } else {
          setError(data.error || 'Analysis failed. Please try again.')
        }
        setLoading(false)
        return
      }

      // Store result and navigate
      sessionStorage.setItem('gpc_analysis', JSON.stringify(data))
      sessionStorage.setItem('gpc_protocol', text)
      router.push('/analyze')
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.key}
            onClick={() => { setText(EXAMPLE_PROTOCOLS[ex.key]); setError(null) }}
            className="px-3 py-1.5 text-sm rounded-lg border border-forest-700 hover:border-amber-500 transition-colors cursor-pointer"
            style={{ color: '#86efac' }}
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
        className="w-full px-4 py-3 rounded-lg border border-forest-700 focus:border-amber-500 focus:outline-none transition-colors resize-y font-[family-name:var(--font-mono)] text-sm leading-relaxed"
        style={{ background: '#14532d', color: '#F5F5F4' }}
        disabled={loading}
      />

      {error && (
        <p className="text-sm" style={{ color: '#EF4444' }}>{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !text.trim()}
        className="w-full px-6 py-3 rounded-lg font-semibold text-lg transition-all disabled:opacity-50 cursor-pointer"
        style={{ background: loading ? '#D97706' : '#F59E0B', color: '#0A0F0D' }}
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
    </div>
  )
}
