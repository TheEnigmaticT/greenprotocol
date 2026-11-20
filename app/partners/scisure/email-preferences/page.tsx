import { Suspense } from 'react'
import { EmailPreferenceConfirmation } from '@/components/partners/email-preference-confirmation'

export const dynamic = 'force-dynamic'
export default function EmailPreferencesPage() {
  return <Suspense fallback={<main>Loading preference confirmation…</main>}><EmailPreferenceConfirmation /></Suspense>
}
