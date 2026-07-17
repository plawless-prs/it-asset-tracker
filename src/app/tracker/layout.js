'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useRole } from '../../lib/useRole'

// Single access guard for every /tracker/* page. Previously only the dashboard
// (/tracker) guarded itself, so /tracker/assets, /licenses, /budget and
// /history were reachable by any logged-in user who knew the URL. Guarding once
// here covers all current and future tracker sub-pages.
export default function TrackerLayout({ children }) {
  const router = useRouter()
  const { hasAccess, loading } = useRole()

  useEffect(() => {
    if (!loading && !hasAccess('tracker')) router.push('/')
  }, [loading, hasAccess])

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        Loading…
      </div>
    )
  }
  if (!hasAccess('tracker')) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        Redirecting…
      </div>
    )
  }

  return children
}
