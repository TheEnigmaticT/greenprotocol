import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculateEquivalencies } from '@/lib/equivalencies'
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

  const cumulative: CumulativeImpact = {
    totalAnalyses: analyses?.length || 0,
    co2eSavedKg: 0,
    hazardousWasteEliminatedKg: 0,
    carcinogensEliminated: [],
    waterSavedL: 0,
    energySavedKwh: 0,
  }

  for (const row of analyses || []) {
    const d = row.impact_delta as ImpactDelta
    cumulative.co2eSavedKg += d.co2eSavedKg || 0
    cumulative.hazardousWasteEliminatedKg += d.hazardousWasteEliminatedKg || 0
    cumulative.waterSavedL += d.waterSavedL || 0
    cumulative.energySavedKwh += d.energySavedKwh || 0
    for (const c of d.carcinogensEliminated || []) {
      if (!cumulative.carcinogensEliminated.includes(c)) {
        cumulative.carcinogensEliminated.push(c)
      }
    }
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

  const stats = [
    { label: 'CO2e Saved', value: `${fmt(cumulative.co2eSavedKg)} kg`, icon: '🌍' },
    { label: 'Haz. Waste Eliminated', value: `${fmt(cumulative.hazardousWasteEliminatedKg)} kg`, icon: '☣️' },
    { label: 'Carcinogens Eliminated', value: `${cumulative.carcinogensEliminated.length}`, icon: '🛡️' },
    { label: 'Water Saved', value: `${fmt(cumulative.waterSavedL)} L`, icon: '💧' },
    { label: 'Energy Saved', value: `${fmt(cumulative.energySavedKwh)} kWh`, icon: '⚡' },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#FAF8F3' }}>
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <Link
          href="/"
          className="font-[family-name:var(--font-mono)] font-medium text-sm tracking-wide hover:opacity-80 transition-opacity"
          style={{ color: '#1B4332' }}
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
                style={{ fontSize: '2.5rem', lineHeight: 1, color: '#1B4332' }}
              >
                {s.value}
              </p>
              <p className="text-sm mt-2" style={{ color: '#78716C' }}>{s.label}</p>
            </div>
          ))}
        </div>

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
          <span className="font-semibold" style={{ color: '#1B4332' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>
    </div>
  )
}
