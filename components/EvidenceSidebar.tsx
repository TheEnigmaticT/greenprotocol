'use client'

import { useState, useEffect } from 'react'

export interface SidebarSection {
  id: string            // anchor id, e.g. 'p1', 'process'
  label: string         // display label, e.g. 'P1: Prevention'
  hasRecommendations: boolean
}

export default function EvidenceSidebar({
  sections,
}: {
  sections: SidebarSection[]
}) {
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : true
  )
  const [activeId, setActiveId] = useState<string>('')

  // Scroll-spy: track which section is currently in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    for (const section of sections) {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [sections])

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg border bg-white shadow-sm print:hidden"
        style={{ borderColor: '#D6D0C4' }}
        aria-label="Toggle navigation"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1C1917" strokeWidth="1.5">
          {collapsed ? (
            <>
              <line x1="3" y1="4" x2="15" y2="4" />
              <line x1="3" y1="9" x2="15" y2="9" />
              <line x1="3" y1="14" x2="15" y2="14" />
            </>
          ) : (
            <>
              <line x1="4" y1="4" x2="14" y2="14" />
              <line x1="14" y1="4" x2="4" y2="14" />
            </>
          )}
        </svg>
      </button>

      {/* Sidebar */}
      <nav
        className={`print:hidden fixed top-0 left-0 h-full z-40 bg-white border-r transition-all duration-200 overflow-y-auto ${
          collapsed ? '-translate-x-full lg:-translate-x-full' : 'translate-x-0'
        }`}
        style={{ borderColor: '#E7E5E4', width: '220px' }}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: '#78716C' }}
            >
              Evidence Atlas
            </span>
            <button
              onClick={() => setCollapsed(true)}
              className="p-1 rounded hover:bg-stone-100 transition-colors"
              aria-label="Collapse sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#78716C" strokeWidth="1.5">
                <polyline points="9,2 4,7 9,12" />
              </svg>
            </button>
          </div>

          <ul className="space-y-0.5">
            {sections.map((section) => {
              const isActive = activeId === section.id
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    onClick={() => {
                      // On mobile, close sidebar after clicking
                      if (window.innerWidth < 1024) setCollapsed(true)
                    }}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      isActive
                        ? 'bg-green-50 font-semibold'
                        : 'hover:bg-stone-50'
                    }`}
                    style={{ color: isActive ? '#166534' : '#57534E' }}
                  >
                    <span className="truncate">{section.label}</span>
                    {section.hasRecommendations && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: '#16a34a' }}
                      />
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      {/* Collapsed expand button (desktop) */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="print:hidden hidden lg:block fixed top-4 left-4 z-50 p-2 rounded-lg border bg-white shadow-sm"
          style={{ borderColor: '#D6D0C4' }}
          aria-label="Expand navigation"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1C1917" strokeWidth="1.5">
            <line x1="3" y1="4" x2="15" y2="4" />
            <line x1="3" y1="9" x2="15" y2="9" />
            <line x1="3" y1="14" x2="15" y2="14" />
          </svg>
        </button>
      )}

      {/* Overlay for mobile when sidebar is open */}
      {!collapsed && (
        <div
          className="lg:hidden fixed inset-0 z-30 print:hidden"
          style={{ background: 'rgba(28, 56, 34, 0.5)' }}
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  )
}
