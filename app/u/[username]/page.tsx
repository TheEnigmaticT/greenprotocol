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
    title: `${name} — GreenProtoCol Impact`,
    description: `See ${name}'s cumulative green chemistry impact on GreenProtoCol.`,
    openGraph: {
      title: `${name} — GreenProtoCol Impact`,
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

  return (
    <div className="min-h-screen" style={{ background: '#0A0F0D' }}>
      <header className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <a
          href="/"
          className="font-[family-name:var(--font-serif)] font-bold text-lg hover:opacity-80 transition-opacity"
          style={{ color: '#22C55E' }}
        >
          GreenProtoCol
        </a>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-10">
        {/* Profile header */}
        <div className="text-center space-y-2">
          <h1 className="font-[family-name:var(--font-serif)] text-3xl font-bold" style={{ color: '#F5F5F4' }}>
            {name}
          </h1>
          <p className="text-sm font-[family-name:var(--font-mono)]" style={{ color: '#a3a3a3' }}>
            @{profile.username}
          </p>
          <p className="text-sm" style={{ color: '#86efac' }}>
            {cumulative.totalAnalyses} protocol{cumulative.totalAnalyses !== 1 ? 's' : ''} analyzed
          </p>
        </div>

        {/* Cumulative stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            label="CO2e Saved"
            value={`${fmt(cumulative.co2eSavedKg)} kg`}
            icon="🌍"
          />
          <StatCard
            label="Haz. Waste Eliminated"
            value={`${fmt(cumulative.hazardousWasteEliminatedKg)} kg`}
            icon="☣️"
          />
          <StatCard
            label="Carcinogens Eliminated"
            value={`${cumulative.carcinogensEliminated.length}`}
            icon="🛡️"
          />
          <StatCard
            label="Water Saved"
            value={`${fmt(cumulative.waterSavedL)} L`}
            icon="💧"
          />
          <StatCard
            label="Energy Saved"
            value={`${fmt(cumulative.energySavedKwh)} kWh`}
            icon="⚡"
          />
        </div>

        {/* Equivalencies */}
        {equivalencies.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-[family-name:var(--font-serif)] text-xl font-bold" style={{ color: '#F5F5F4' }}>
              What does that look like?
            </h2>
            <EquivalencyStory equivalencies={equivalencies} />
          </section>
        )}

        {/* CTA */}
        <div className="text-center pt-8 border-t border-forest-800">
          <p className="text-sm mb-4" style={{ color: '#a3a3a3' }}>
            Make your chemistry greener.
          </p>
          <a
            href="/"
            className="inline-block px-8 py-3 rounded-lg font-semibold text-base"
            style={{ background: '#F59E0B', color: '#0A0F0D' }}
          >
            Join GreenProtoCol
          </a>
        </div>
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

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="p-4 rounded-xl border border-forest-700 text-center" style={{ background: '#14532d20' }}>
      <span className="text-2xl">{icon}</span>
      <p className="text-xl font-bold font-[family-name:var(--font-mono)] mt-1" style={{ color: '#F59E0B' }}>
        {value}
      </p>
      <p className="text-xs mt-1" style={{ color: '#86efac' }}>{label}</p>
    </div>
  )
}
