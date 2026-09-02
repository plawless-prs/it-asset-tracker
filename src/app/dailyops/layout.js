'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useRole } from '../../lib/useRole'

// Daily Ops shell — Help Desk-style icon rail; access guarded once here.
const RAIL = [
  { href: '/dailyops',           label: 'Today',     icon: '✓', match: (p) => p === '/dailyops' },
  { href: '/dailyops/tasks',     label: 'Tasks',     icon: '☰', match: (p) => p.startsWith('/dailyops/tasks') },
  { href: '/dailyops/templates', label: 'Templates', icon: '⚙', match: (p) => p.startsWith('/dailyops/templates') },
]

export default function DailyOpsLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { hasAccess, loading } = useRole()

  useEffect(() => {
    if (!loading && !hasAccess('dailyops')) router.push('/')
  }, [loading, hasAccess])   // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!hasAccess('dailyops')) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Redirecting…</div>
  }

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', alignItems: 'stretch' }}>
      <nav style={{
        width: '76px', flexShrink: 0, backgroundColor: '#0d1219', borderRight: '1px solid #151e2a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '16px 0',
      }}>
        {RAIL.map(item => {
          const active = item.match(pathname)
          return (
            <Link key={item.href} href={item.href} style={{
              width: '60px', padding: '10px 0', borderRadius: '10px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
              textDecoration: 'none', fontSize: '10px', fontWeight: '500',
              color: active ? '#60a5fa' : '#5a6e84',
              backgroundColor: active ? '#111d2e' : 'transparent',
              border: active ? '1px solid #1e3a5f' : '1px solid transparent',
            }}>
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}
