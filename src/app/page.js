'use client'

import Link from 'next/link'

export default function HomePage() {
  const tools = [
    {
      name: 'IT Asset & Budget Tracker',
      description: 'Track hardware, software licenses, budgets, and purchases. Manage the full lifecycle of IT assets with photo uploads, depreciation, and audit logging.',
      href: '/tracker',
      icon: '⊞',
      color: '#2563eb',
      status: 'Active',
    },
    {
      name: 'Knowledge Base',
      description: 'Create and organize internal documentation, guides, and company knowledge for your team.',
      href: '/wiki',
      icon: '⊡',
      color: '#7c3aed',
      status: 'Coming Soon',
    },
  ]

  return (
    <div style={{
      maxWidth: '900px',
      margin: '0 auto',
      padding: '60px 24px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '48px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '800',
          color: '#e0e7f0',
          margin: '0 0 8px',
        }}>
          Welcome to PRS Apps
        </h1>
        <p style={{
          fontSize: '15px',
          color: '#5a6e84',
          margin: 0,
          lineHeight: '1.6',
        }}>
          Your company tools, all in one place. Choose an app below to get started.
        </p>
      </div>

      {/* App Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '20px',
      }}>
        {tools.map(tool => {
          const isActive = tool.status === 'Active'

          return isActive ? (
            <Link
              key={tool.name}
              href={tool.href}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  backgroundColor: '#0f1620',
                  border: '1px solid #182030',
                  borderRadius: '16px',
                  padding: '28px',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s, transform 0.2s',
                  height: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = tool.color
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#182030'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px',
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: tool.color + '18',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '22px',
                    color: tool.color,
                    border: `1px solid ${tool.color}33`,
                  }}>
                    {tool.icon}
                  </div>
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: '100px',
                    fontSize: '11px',
                    fontWeight: '600',
                    backgroundColor: '#0d3320',
                    color: '#4ade80',
                    border: '1px solid #166534',
                  }}>
                    {tool.status}
                  </span>
                </div>

                <h2 style={{
                  fontSize: '17px',
                  fontWeight: '700',
                  color: '#e0e7f0',
                  margin: '0 0 8px',
                }}>
                  {tool.name}
                </h2>
                <p style={{
                  fontSize: '13.5px',
                  color: '#5a6e84',
                  margin: 0,
                  lineHeight: '1.6',
                }}>
                  {tool.description}
                </p>
              </div>
            </Link>
          ) : (
            <div
              key={tool.name}
              style={{
                backgroundColor: '#0f1620',
                border: '1px solid #182030',
                borderRadius: '16px',
                padding: '28px',
                opacity: 0.6,
                height: '100%',
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: '#131a24',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px',
                  color: '#4a5a6e',
                }}>
                  {tool.icon}
                </div>
                <span style={{
                  padding: '4px 12px',
                  borderRadius: '100px',
                  fontSize: '11px',
                  fontWeight: '600',
                  backgroundColor: '#1a1a2e',
                  color: '#a78bfa',
                  border: '1px solid #5b21b6',
                }}>
                  {tool.status}
                </span>
              </div>

              <h2 style={{
                fontSize: '17px',
                fontWeight: '700',
                color: '#8aa0b8',
                margin: '0 0 8px',
              }}>
                {tool.name}
              </h2>
              <p style={{
                fontSize: '13.5px',
                color: '#3a4a5e',
                margin: 0,
                lineHeight: '1.6',
              }}>
                {tool.description}
              </p>
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <div style={{
        marginTop: '48px',
        textAlign: 'center',
        fontSize: '13px',
        color: '#3a4a5e',
      }}>
        More tools coming soon. Reach out to your admin to request new features.
      </div>
    </div>
  )
}