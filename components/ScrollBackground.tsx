'use client'

import { useEffect, useRef, ReactNode } from 'react'

export default function ScrollBackground({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function onScroll() {
      if (!el) return
      const scrollPct = window.scrollY / (document.body.scrollHeight - window.innerHeight || 1)
      // Cream → soft sage → cream
      const mid = Math.sin(scrollPct * Math.PI)
      const r = Math.round(250 - mid * 18)
      const g = Math.round(248 - mid * 8)
      const b = Math.round(243 - mid * 15)
      el.style.backgroundColor = `rgb(${r},${g},${b})`
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div ref={ref} className="min-h-screen" style={{ backgroundColor: '#FAF8F3' }}>
      {children}
    </div>
  )
}
