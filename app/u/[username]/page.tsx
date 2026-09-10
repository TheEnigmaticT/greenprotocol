import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEquivalencies } from '@/lib/equivalencies'
import { aggregateClaimableImpact } from '@/lib/impact-inventory'
import { CumulativeImpact, ImpactDelta, Equivalency, GpcProfile } from '@/lib/types'
import EquivalencyStory from '@/components/EquivalencyStory'

interface Props {
  params: Promise<{ username: string }>
}

export async function generateMetadata({ params }: Props) {
  const { username } = await params
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('gpc_profiles')
    .select('display_name, username')
    .eq('username', username)
    .single()

  if (!profile) return { title: 'Profile Not Found' }

  const name = profile.display_name || profile.username
  return {
    title: `${name} — GreenChemistry.ai Impact`,
    description: `See ${name}'s cumulative green chemistry impact on GreenChemistry.ai.`,
    openGraph: {
      title: `${name} — GreenChemistry.ai Impact`,
      description: `See ${name}'s cumulative green chemistry impact.`,
      type: 'profile',
    },
  }
}

function fmt(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  if (n >= 10) return Math.round(n).toLocaleString()
  if (n >= 0.1) return n.toFixed(1)
  return n.toFixed(2)
}

async function getProfileData(username: string): Promise<{
  profile: GpcProfile
  cumulative: CumulativeImpact
  equivalencies: Equivalency[]
} | null> {
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('gpc_profiles')
    .select('*')
    .eq('username', username)
    .single()

  if (!profile) return null

  const { data: analyses } = await admin
    .from('gpc_analyses')
    .select('impact_delta')
    .eq('user_id', profile.user_id)

  const aggregate = aggregateClaimableImpact((analyses || []).map((row) => row.impact_delta as ImpactDelta))
  const cumulative: CumulativeImpact = {
    totalAnalyses: analyses?.length || 0,
    ...aggregate,
  }

  const equivalencies = calculateEquivalencies(cumulative)

  return { profile, cumulative, equivalencies }
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params
  const result = await getProfileData(username)

  if (!result) notFound()

  const { profile, cumulative, equivalencies } = result
  const name = profile.display_name || profile.username
  const onlyUnavailableImpact = cumulative.claimedAnalyses === 0 && cumulative.unavailableAnalyses > 0

  const stats = [
    { label: onlyUnavailableImpact ? 'CO2e Impact' : 'CO2e Saved', value: onlyUnavailableImpact ? 'Unavailable' : `${fmt(cumulative.co2eSavedKg)} kg`, icon: '🌍' },
    { label: onlyUnavailableImpact ? 'Haz. Waste Impact' : 'Haz. Waste Eliminated', value: onlyUnavailableImpact ? 'Unavailable' : `${fmt(cumulative.hazardousWasteEliminatedKg)} kg`, icon: '☣️' },
    { label: onlyUnavailableImpact ? 'Carcinogen Impact' : 'Carcinogens Eliminated', value: onlyUnavailableImpact ? 'Unavailable' : `${cumulative.carcinogensEliminated.length}`, icon: '🛡️' },
    { label: onlyUnavailableImpact ? 'Water Impact' : 'Water Saved', value: onlyUnavailableImpact ? 'Unavailable' : `${fmt(cumulative.waterSavedL)} L`, icon: '💧' },
    { label: onlyUnavailableImpact ? 'Energy Impact' : 'Energy Saved', value: onlyUnavailableImpact ? 'Unavailable' : `${fmt(cumulative.energySavedKwh)} kWh`, icon: '⚡' },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1C3822' }}
        >
          greenchemistry.ai
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Profile header */}
        <div className="space-y-2">
          <h1 className="font-[family-name:var(--font-serif)] text-4xl md:text-5xl font-bold" style={{ color: '#1C1917' }}>
            {name}
          </h1>
          <p className="text-sm font-[family-name:var(--font-mono)]" style={{ color: '#78716C' }}>
            @{profile.username}
          </p>
          <p className="text-sm" style={{ color: '#57534E' }}>
            {cumulative.totalAnalyses} protocol{cumulative.totalAnalyses !== 1 ? 's' : ''} analyzed
          </p>
        </div>

        {/* Cumulative stats — oversized numbers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {stats.map((s) => (
            <div key={s.label}>
              <span className="text-2xl">{s.icon}</span>
              <p
                className="font-[family-name:var(--font-mono)] font-semibold mt-1"
                style={{ fontSize: '2.5rem', lineHeight: 1, color: '#1C3822' }}
              >
                {s.value}
              </p>
              <p className="text-sm mt-2" style={{ color: '#78716C' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {cumulative.unavailableAnalyses > 0 && (
          <p className="text-sm" style={{ color: '#78716C' }}>
            Impact comparison is unavailable for {cumulative.unavailableAnalyses} protocol{cumulative.unavailableAnalyses === 1 ? '' : 's'}; those rows are excluded from savings totals.
          </p>
        )}

        {/* Equivalencies */}
        {equivalencies.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-serif)] text-xl font-bold" style={{ color: '#1C1917' }}>
              What does that look like?
            </h2>
            <EquivalencyStory equivalencies={equivalencies} variant="light" />
          </section>
        )}

        {/* CTA */}
        <div className="text-center pt-8 border-t" style={{ borderColor: '#D6D0C4' }}>
          <p className="text-sm mb-4" style={{ color: '#78716C' }}>
            Make your chemistry greener.
          </p>
          <Link
            href="/"
            className="inline-block px-8 py-3 rounded-lg font-semibold text-base"
            style={{ background: '#7C2D36', color: '#FAF8F3' }}
          >
            Join GreenChemistry.ai
          </Link>
        </div>
      </main>

      <footer className="border-t px-6 py-8 text-center" style={{ borderColor: '#D6D0C4' }}>
        <p className="text-sm" style={{ color: '#78716C' }}>
          Built for{' '}
          <span className="font-semibold" style={{ color: '#1C3822' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
