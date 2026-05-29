'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AnalysisResult } from '@/lib/types'
import EvidenceAtlas from '@/components/EvidenceAtlas'

interface AnalysisData {
  id: string
  protocolText: string
  analysis: AnalysisResult
}

export default function EvidencePage() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/analyses/${id}`)
        if (res.status === 401) {
          router.push('/login')
          return
        }
        if (res.status === 404) {
          setError('Analysis not found')
          return
        }
        if (!res.ok) {
          setError(`Unable to load analysis (server error ${res.status}). Please try again.`)
          return
        }
        const json = await res.json()
        setData(json)
      } catch {
        setError('Failed to load analysis. Please try again.')
      }
    }
    load()
  }, [id, router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <p className="text-lg" style={{ color: '#EF4444' }}>{error}</p>
          <Link href="/dashboard" className="text-sm underline" style={{ color: '#7C2D36' }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF8F3' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#1C3822', borderTopColor: 'transparent' }} />
          <p style={{ color: '#78716C' }}>Loading evidence...</p>
        </div>
      </div>
    )
  }

  return <EvidenceAtlas analysisId={id} analysis={data.analysis} />
}
