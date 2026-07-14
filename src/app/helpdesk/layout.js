'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useRole } from '../../lib/useRole'

const RAIL = [
  { href: '/helpdesk',          label: 'Dashboard', icon: '▦', match: (p) => p === '/helpdesk' },
  { href: '/helpdesk/tickets',  label: 'Tickets',   icon: '🎫', match: (p) => p.startsWith('/helpdesk/tickets') },
  { href: '/helpdesk/kb',       label: 'Knowledge', icon: '📘', match: (p) => p.startsWith('/helpdesk/kb') },
]

export default function HelpdeskLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { hasAccess, loading } = useRole()

  useEffect(() => {
    if (!loading && !hasAccess('helpdesk')) router.push('/')
  }, [loading, hasAccess])

  if (loading) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        Loading…
      </div>
    )
  }
  if (!hasAccess('helpdesk')) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        Redirecting…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)', alignItems: 'stretch' }}>
      {/* Left icon rail */}
      <nav style={{
        width: '76px',
        flexShrink: 0,
        backgroundColor: '#0d1219',
        borderRight: '1px solid #151e2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '16px 0',
      }}>
        {RAIL.map(item => {
          const active = item.match(pathname)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                width: '60px',
                padding: '10px 0',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'none',
                fontSize: '10px',
                fontWeight: '500',
                color: active ? '#60a5fa' : '#5a6e84',
                backgroundColor: active ? '#111d2e' : 'transparent',
                border: active ? '1px solid #1e3a5f' : '1px solid transparent',
              }}
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Content area */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}
