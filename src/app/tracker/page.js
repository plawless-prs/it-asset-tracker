'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'

export default function DashboardPage() {
  const supabase = createClient()
  const [stats, setStats] = useState({
    totalAssets: 0,
    deployed: 0,
    totalBudget: 0,
    totalSpent: 0,
    licenseCount: 0,
    expiringLicenses: [],
    warrantyAlerts: [],
    subscriptionCost: 0,
    recentActivity: [],
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    // Fetch all data in parallel for speed
    const [
      { data: assets },
      { data: licenses },
      { data: budgets },
      { data: purchases },
      { data: subscriptions },
      { data: activity },
    ] = await Promise.all([
      supabase.from('assets').select('*'),
      supabase.from('licenses').select('*'),
      supabase.from('budgets').select('*'),
      supabase.from('purchases').select('*'),
      supabase.from('subscriptions').select('*'),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(8),
    ])

    const now = new Date()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    setStats({
      totalAssets: assets?.length || 0,
      deployed: assets?.filter(a => a.status === 'Deployed').length || 0,
      totalBudget: budgets?.reduce((sum, b) => sum + Number(b.amount || 0), 0) || 0,
      totalSpent: purchases?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0,
      licenseCount: licenses?.length || 0,
      expiringLicenses: licenses?.filter(l => {
        if (!l.expiration_date) return false
        const diff = new Date(l.expiration_date) - now
        return diff > 0 && diff <= thirtyDays
      }) || [],
      warrantyAlerts: assets?.filter(a => {
        if (!a.warranty_expiry) return false
        const diff = new Date(a.warranty_expiry) - now
        return diff > 0 && diff <= thirtyDays
      }) || [],
      subscriptionCost: subscriptions?.reduce((sum, s) => sum + Number(s.monthly_cost || 0), 0) || 0,
      recentActivity: activity || [],
    })
    setLoading(false)
  }

  const budgetUsed = stats.totalBudget > 0
    ? (stats.totalSpent / stats.totalBudget) * 100
    : 0

  function formatCurrency(n) {
    return '$' + Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '60px 24px',
        textAlign: 'center',
        color: '#5a6e84',
      }}>
        Loading dashboard...
      </div>
    )
  }

  return (
    <div style={{
      maxWidth: '1100px',
      margin: '0 auto',
      padding: '28px 24px 60px',
    }}>
      <h1 style={{
        fontSize: '22px',
        fontWeight: '700',
        color: '#e0e7f0',
        marginBottom: '24px',
      }}>
        Dashboard
      </h1>

      {/* Stat Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
        marginBottom: '24px',
      }}>
        {[
          {
            label: 'Total Assets',
            value: stats.totalAssets,
            color: '#60a5fa',
            sub: `${stats.deployed} deployed`,
          },
          {
            label: 'Active Licenses',
            value: stats.licenseCount,
            color: '#a78bfa',
            sub: `${stats.expiringLicenses.length} expiring soon`,
          },
          {
            label: 'Budget Remaining',
            value: formatCurrency(stats.totalBudget - stats.totalSpent),
            color: budgetUsed > 90 ? '#f87171' : '#4ade80',
            sub: `${budgetUsed.toFixed(0)}% used`,
          },
          {
            label: 'Monthly Subscriptions',
            value: formatCurrency(stats.subscriptionCost),
            color: '#fbbf24',
            sub: `${formatCurrency(stats.subscriptionCost * 12)}/yr`,
          },
        ].map((card, i) => (
          <div key={i} style={{
            backgroundColor: '#0f1620',
            border: '1px solid #182030',
            borderRadius: '14px',
            padding: '22px',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: '600',
              color: '#4a5a6e',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '10px',
            }}>
              {card.label}
            </div>
            <div style={{
              fontSize: '28px',
              fontWeight: '800',
              color: card.color,
              lineHeight: 1,
            }}>
              {card.value}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#4a5a6e',
              marginTop: '6px',
            }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Budget Bar */}
      {stats.totalBudget > 0 && (
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          padding: '22px',
          marginBottom: '24px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '10px',
          }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#8aa0b8' }}>
              Overall IT Budget
            </span>
            <span style={{ fontSize: '12px', color: '#5a6e84' }}>
              {formatCurrency(stats.totalSpent)} / {formatCurrency(stats.totalBudget)}
            </span>
          </div>
          <div style={{
            height: '10px',
            borderRadius: '5px',
            backgroundColor: '#131a24',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              borderRadius: '5px',
              width: `${Math.min(budgetUsed, 100)}%`,
              backgroundColor: budgetUsed > 90 ? '#ef4444' : budgetUsed > 70 ? '#f59e0b' : '#22c55e',
              transition: 'width 0.8s ease',
            }} />
          </div>
        </div>
      )}

      {/* Alerts and Recent Activity side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '14px',
      }}>
        {/* Alerts */}
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          padding: '22px',
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: '700',
            color: '#e0e7f0',
            marginBottom: '14px',
          }}>
            Alerts
          </div>
          {stats.expiringLicenses.length === 0 && stats.warrantyAlerts.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#3a4a5e', padding: '12px 0' }}>
              No active alerts — everything looks good.
            </div>
          ) : (
            <>
              {stats.expiringLicenses.map((l) => (
                <div key={l.id} style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #141d28',
                  fontSize: '13px',
                  color: '#c0cad8',
                }}>
                  <span style={{ color: '#fbbf24' }}>⊟ </span>
                  License <strong>{l.name}</strong> expires {formatDate(l.expiration_date)}
                </div>
              ))}
              {stats.warrantyAlerts.map((a) => (
                <div key={a.id} style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #141d28',
                  fontSize: '13px',
                  color: '#c0cad8',
                }}>
                  <span style={{ color: '#fb923c' }}>⊞ </span>
                  Warranty for <strong>{a.name}</strong> expires {formatDate(a.warranty_expiry)}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Recent Activity */}
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          padding: '22px',
        }}>
          <div style={{
            fontSize: '13px',
            fontWeight: '700',
            color: '#e0e7f0',
            marginBottom: '14px',
          }}>
            Recent Activity
          </div>
          {stats.recentActivity.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#3a4a5e', padding: '12px 0' }}>
              No activity yet. Start by adding assets or setting a budget.
            </div>
          ) : (
            stats.recentActivity.map((h, i) => (
              <div key={i} style={{
                padding: '7px 0',
                borderBottom: '1px solid #141d28',
                fontSize: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '8px',
              }}>
                <span style={{ color: '#8aa0b8' }}>{h.detail}</span>
                <span style={{ color: '#3a4a5e', fontSize: '11px', flexShrink: 0 }}>
                  {formatDate(h.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}