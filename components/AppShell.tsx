'use client'

import Link from 'next/link'
import { NEW_ANALYSIS_HREF } from '@/lib/analysis-session'
import UserMenu from './UserMenu'

export type AppShellTab = 'decisions' | 'atlas'

/** Shared content column — matches Decisions / Atlas page mains. */
const CONTENT_COL = 'mx-auto max-w-6xl px-4 sm:px-6'

export default function AppShell({
  children,
  analysisId,
  activeTab,
  historyHref = '/dashboard',
  historyLabel = 'History',
  onNewAnalysis,
}: {
  children: React.ReactNode
  analysisId?: string
  activeTab?: AppShellTab
  historyHref?: string
  historyLabel?: string
  onNewAnalysis?: () => void
}) {
  const inAnalysis = Boolean(analysisId)
  const decisionsHref = analysisId ? `/analyze/${analysisId}` : '/analyze'
  const atlasHref = analysisId ? `/analyze/${analysisId}/evidence` : undefined

  const chromeLabel =
    'font-[family-name:var(--font-sans)] text-[12px] font-medium tracking-[0.04em]'

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F6F3EB' }}>
      <header className="print:hidden sticky top-0 z-40" style={{ background: '#1C3822', color: '#F6F3EB' }}>
        <div className={`${CONTENT_COL} flex min-h-14 items-center justify-between gap-3`}>
          <Link
            href="/"
            className="flex items-center gap-2.5 min-w-0 shrink-0"
            aria-label="greenchemistry.ai home"
          >
            <img
              src="/logomark-dark.svg"
              alt=""
              width={32}
              height={34}
              className="block shrink-0"
            />
            <span
              className="font-[family-name:var(--font-sans)] font-semibold text-[13px] tracking-wide whitespace-nowrap"
              style={{ color: '#F6F3EB' }}
            >
              greenchemistry.ai
            </span>
          </Link>

          {inAnalysis && (
            <nav
              className="hidden sm:flex items-stretch justify-center gap-1 flex-1 min-w-0"
              aria-label="In this analysis"
            >
              <Link
                href={decisionsHref}
                aria-current={activeTab === 'decisions' ? 'page' : undefined}
                className={`${chromeLabel} uppercase px-3.5 pt-[18px] pb-4 border-b-2`}
                style={{
                  color: activeTab === 'decisions' ? '#ECB815' : '#A8C5A2',
                  borderBottomColor: activeTab === 'decisions' ? '#ECB815' : 'transparent',
                }}
              >
                Decisions
              </Link>
              {atlasHref && (
                <Link
                  href={atlasHref}
                  aria-current={activeTab === 'atlas' ? 'page' : undefined}
                  className={`${chromeLabel} uppercase px-3.5 pt-[18px] pb-4 border-b-2`}
                  style={{
                    color: activeTab === 'atlas' ? '#ECB815' : '#A8C5A2',
                    borderBottomColor: activeTab === 'atlas' ? '#ECB815' : 'transparent',
                  }}
                >
                  Atlas
                </Link>
              )}
            </nav>
          )}

          <div className="flex items-center gap-2.5 sm:gap-3 justify-end shrink-0">
            {onNewAnalysis ? (
              <button
                type="button"
                onClick={onNewAnalysis}
                className={`inline-flex items-center justify-center min-h-9 px-2.5 sm:px-3.5 ${chromeLabel} uppercase cursor-pointer`}
                style={{ background: '#ECB815', color: '#0D1F16' }}
              >
                New Analysis
              </button>
            ) : (
              <Link
                href={NEW_ANALYSIS_HREF}
                className={`inline-flex items-center justify-center min-h-9 px-2.5 sm:px-3.5 ${chromeLabel} uppercase`}
                style={{ background: '#ECB815', color: '#0D1F16' }}
              >
                New Analysis
              </Link>
            )}
            <UserMenu
              historyHref={historyHref}
              historyLabel={historyLabel}
              chrome="dark"
            />
          </div>
        </div>
        <div className="h-0.5 w-full" style={{ background: '#ECB815' }} aria-hidden="true" />
      </header>

      <div className={`flex-1 ${inAnalysis ? 'pb-24 sm:pb-0' : ''}`}>
        {children}
      </div>

      <footer className="print:hidden border-t px-6 py-8 text-center" style={{ borderColor: '#D6D0C4', background: '#F6F3EB' }}>
        <p className="text-sm font-[family-name:var(--font-sans)]" style={{ color: '#78716C' }}>
          Built for{' '}
          <span className="font-semibold" style={{ color: '#1C3822' }}>LabreNew.org</span>
          {' '}&mdash; Green chemistry recommendations require experimental validation before adoption.
        </p>
      </footer>

      {inAnalysis && atlasHref && (
        <nav
          className="sm:hidden fixed left-0 right-0 bottom-0 z-40 grid grid-cols-2 print:hidden"
          style={{ background: '#1C3822', borderTop: '2px solid #ECB815', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
          aria-label="Analysis views"
        >
          <Link
            href={decisionsHref}
            aria-current={activeTab === 'decisions' ? 'page' : undefined}
            className={`flex items-center justify-center min-h-[52px] ${chromeLabel} uppercase`}
            style={{ color: activeTab === 'decisions' ? '#ECB815' : '#A8C5A2' }}
          >
            Decisions
          </Link>
          <Link
            href={atlasHref}
            aria-current={activeTab === 'atlas' ? 'page' : undefined}
            className={`flex items-center justify-center min-h-[52px] ${chromeLabel} uppercase`}
            style={{ color: activeTab === 'atlas' ? '#ECB815' : '#A8C5A2' }}
          >
            Atlas
          </Link>
        </nav>
      )}
    </div>
  )
}
