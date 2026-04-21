'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '../lib/supabase'
import { useRole } from '../lib/useRole'

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [openDropdown, setOpenDropdown] = useState(null)
  const { isAdmin, hasAccess } = useRole()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const tools = [
    {
      id: 'tracker',
      appId: 'tracker',
      label: 'IT Tracker',
      icon: '⊞',
      basePath: '/tracker',
      links: [
        { href: '/tracker', label: 'Dashboard' },
        { href: '/tracker/assets', label: 'Assets' },
        { href: '/tracker/licenses', label: 'Licenses' },
        { href: '/tracker/budget', label: 'Budget' },
        { href: '/tracker/history', label: 'History' },
      ],
    },
    {
      id: 'invoices',
      appId: 'invoices',
      label: 'Invoice Processor',
      icon: '⊡',
      basePath: '/invoices',
      links: [
        { href: '/invoices', label: 'Process Invoices' },
      ],
    },
    {
      id: 'calculator',
      appId: 'calculator',
      label: 'Material Calculator',
      icon: '⊞',
      basePath: '/calculator',
      links: [
        { href: '/calculator', label: 'Calculator' },
      ],
    },
    {
      id: 'wiki',
      appId: 'wiki',
      label: 'Knowledge Base',
      icon: '⊡',
      basePath: '/wiki',
      links: [
        { href: '/wiki', label: 'Coming Soon' },
      ],
    },
  ]

  // Filter tools based on user's app access
  const visibleTools = tools.filter(t => hasAccess(t.appId))

  // Figure out which tool is active
  const activeTool = tools.find(t => pathname.startsWith(t.basePath))

  function toggleDropdown(id) {
    setOpenDropdown(openDropdown === id ? null : id)
  }

  return (
    <nav style={{
      backgroundColor: '#0d1219',
      borderBottom: '1px solid #151e2a',
      padding: '0 24px',
      position: 'relative',
      zIndex: 100,
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px',
      }}>
        {/* Logo — links to home */}
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
            fontWeight: '800',
            color: '#fff',
            letterSpacing: '-0.5px',
          }}>
            PRS
          </div>
          <span style={{
            fontSize: '16px',
            fontWeight: '700',
            color: '#e0e7f0',
          }}>
            PRS Apps
          </span>
        </Link>

        {/* Tool Dropdowns + Sub-nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {visibleTools.map(tool => {
            const isActive = pathname.startsWith(tool.basePath)

            return (
              <div key={tool.id} style={{ position: 'relative' }}>
                {/* Tool button */}
                <button
                  onClick={() => toggleDropdown(tool.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: isActive ? '#60a5fa' : '#5a6e84',
                    backgroundColor: isActive ? '#111d2e' : 'transparent',
                    border: isActive ? '1px solid #1e3a5f' : '1px solid transparent',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>{tool.icon}</span>
                  {tool.label}
                  <span style={{
                    fontSize: '10px',
                    marginLeft: '2px',
                    transition: 'transform 0.2s',
                    transform: openDropdown === tool.id ? 'rotate(180deg)' : 'rotate(0)',
                  }}>
                    ▾
                  </span>
                </button>

                {/* Dropdown */}
                {openDropdown === tool.id && (
                  <>
                    {/* Invisible overlay to close dropdown when clicking away */}
                    <div
                      onClick={() => setOpenDropdown(null)}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 98,
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: '44px',
                      left: '0',
                      backgroundColor: '#0f1620',
                      border: '1px solid #1e2d40',
                      borderRadius: '10px',
                      padding: '6px',
                      minWidth: '180px',
                      zIndex: 99,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}>
                      {tool.links.map(link => (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={() => setOpenDropdown(null)}
                          style={{
                            display: 'block',
                            padding: '8px 14px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: pathname === link.href ? '600' : '400',
                            color: pathname === link.href ? '#60a5fa' : '#8aa0b8',
                            backgroundColor: pathname === link.href ? '#111d2e' : 'transparent',
                            textDecoration: 'none',
                          }}
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {/* Admin link — only visible to admins */}
          {isAdmin && (
            <Link
              href="/admin"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '500',
                color: pathname === '/admin' ? '#f87171' : '#5a6e84',
                backgroundColor: pathname === '/admin' ? '#1a0d0d' : 'transparent',
                border: pathname === '/admin' ? '1px solid #991b1b' : '1px solid transparent',
                textDecoration: 'none',
              }}
            >
              Admin
            </Link>
          )}

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