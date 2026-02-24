'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GpcProfile, AnalysisSummary } from '@/lib/types'
import UserMenu from '@/components/UserMenu'
import UsernameSetup from '@/components/UsernameSetup'
import AnalysisCard from '@/components/AnalysisCard'

export default function DashboardPage() {
  const [profile, setProfile] = useState<GpcProfile | null | undefined>(undefined)
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    async function load() {
      const [profileRes, analysesRes] = await Promise.all([
        fetch('/api/profile'),
        fetch('/api/analyses'),
      ])

      if (profileRes.status === 401 || analysesRes.status === 401) {
        router.push('/login')
        return
      }

      const profileData = await profileRes.json()
      setProfile(profileData.profile || null)

      if (analysesRes.ok) {
        setAnalyses(await analysesRes.json())
      }

      setLoading(false)
    }
    load()
  }, [router])

  if (loading || profile === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0A0F0D' }}>
        <div className="text-center space-y-4">
          <div className="animate-spin h-8 w-8 border-2 border-t-transparent rounded-full mx-auto" style={{ borderColor: '#22C55E', borderTopColor: 'transparent' }} />
          <p style={{ color: '#86efac' }}>Loading dashboard...</p>
        </div>
      </div>
    )
  }

  const filtered = analyses.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const title = a.analysis_result.protocolTitle?.toLowerCase() || ''
    const subdomain = a.analysis_result.chemistrySubdomain?.toLowerCase() || ''
    return title.includes(q) || subdomain.includes(q)
  })

  return (
    <div className="min-h-screen" style={{ background: '#0A0F0D' }}>
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <a
          href="/"
          className="font-[family-name:var(--font-serif)] font-bold text-lg hover:opacity-80 transition-opacity"
          style={{ color: '#22C55E' }}
        >
          GreenChemistry.ai
        </a>
        <div className="flex items-center gap-4">
          <a
            href="/"
            className="text-sm px-3 py-1.5 rounded-lg border border-forest-700 hover:border-amber-500 transition-colors"
            style={{ color: '#86efac' }}
          >
            New Analysis
          </a>
          <UserMenu />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="font-[family-name:var(--font-serif)] text-2xl font-bold" style={{ color: '#F5F5F4' }}>
            Dashboard
          </h1>
          {profile && (
            <a
              href={`/u/${profile.username}`}
              className="text-sm px-3 py-1.5 rounded-lg border border-forest-700 hover:border-amber-500 transition-colors"
              style={{ color: '#86efac' }}
            >
              Public Profile &rarr;
            </a>
          )}
        </div>

        {/* Username setup if no profile */}
        {profile === null && (
          <UsernameSetup onComplete={(p) => setProfile(p)} />
        )}

        {/* Search */}
        {analyses.length > 0 && (
          <div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search protocols..."
              className="w-full max-w-md px-4 py-2 rounded-lg border border-forest-700 bg-transparent text-sm focus:outline-none focus:border-amber-500"
              style={{ color: '#F5F5F4', background: '#14532d' }}
            />
          </div>
        )}

        {/* Analysis cards */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(a => (
              <AnalysisCard key={a.id} analysis={a} />
            ))}
          </div>
        ) : analyses.length > 0 ? (
          <p className="text-sm" style={{ color: '#a3a3a3' }}>No protocols match your search.</p>
        ) : (
          <div className="text-center py-16 space-y-4">
            <p className="text-lg" style={{ color: '#a3a3a3' }}>No analyses yet.</p>
            <a
              href="/"
              className="inline-block px-6 py-3 rounded-lg font-semibold text-sm"
              style={{ background: '#F59E0B', color: '#0A0F0D' }}
            >
              Analyze Your First Protocol
            </a>
          </div>
        )}
      </main>

      <footer className="border-t border-forest-800 px-6 py-8 text-center">
        <p className="text-sm" style={{ color: '#a3a3a3' }}>
          Built for{' '}
          <span style={{ color: '#22C55E' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
