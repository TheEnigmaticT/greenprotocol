'use client'

import { useParams } from 'next/navigation'
import AppShell from '@/components/AppShell'
import SavedWorkspace from '@/components/integrations/scisure/SavedWorkspace'

export default function SavedSciSureReviewPage() {
  const id = useParams().id as string
  return (
    <AppShell analysisId={id}>
      <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SavedWorkspace analysisId={id} />
      </main>
    </AppShell>
  )
}
