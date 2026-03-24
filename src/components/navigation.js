'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '../lib/supabase'

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const links = [
    { href: '/', label: 'Dashboard', icon: '◉' },
    { href: '/assets', label: 'Assets', icon: '⊞' },
    { href: '/licenses', label: 'Licenses', icon: '⊟' },
    { href: '/budget', label: 'Budget', icon: '◈' },
    { href: '/history', label: 'History', icon: '◷' },
  ]

  return (
    <nav style={{
      backgroundColor: '#0d1219',
      borderBottom: '1px solid #151e2a',
      padding: '0 24px',
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: '800',
            color: '#fff',
          }}>
            IT
          </div>
          <span style={{
            fontSize: '16px',
            fontWeight: '700',
            color: '#e0e7f0',
          }}>
            AssetTrack
          </span>
        </div>

        {/* Nav Links */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {links.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: '500',
                  textDecoration: 'none',
                  color: isActive ? '#60a5fa' : '#5a6e84',
                  backgroundColor: isActive ? '#111d2e' : 'transparent',
                  border: isActive ? '1px solid #1e3a5f' : '1px solid transparent',
                }}
              >
                <span style={{ fontSize: '14px' }}>{link.icon}</span>
                {link.label}
              </Link>
            )
          })}

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            style={{
              marginLeft: '12px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: '500',
              color: '#5a6e84',
              backgroundColor: 'transparent',
              border: '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  )
}