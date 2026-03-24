'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'
import BudgetModal from '../../components/BudgetModal'
import PurchaseModal from '../../components/PurchaseModal'
import SubscriptionModal from '../../components/SubscriptionModal'

export default function BudgetPage() {
  const supabase = createClient()
  const [budgets, setBudgets] = useState([])
  const [purchases, setPurchases] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [showPurchaseModal, setShowPurchaseModal] = useState(false)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false)

  const categories = ['Hardware', 'Software', 'Services', 'Infrastructure', 'Personnel', 'Other']

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [
      { data: budgetData },
      { data: purchaseData },
      { data: subscriptionData },
    ] = await Promise.all([
      supabase.from('budgets').select('*').order('created_at', { ascending: false }),
      supabase.from('purchases').select('*').order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
    ])

    if (budgetData) setBudgets(budgetData)
    if (purchaseData) setPurchases(purchaseData)
    if (subscriptionData) setSubscriptions(subscriptionData)
    setLoading(false)
  }

  async function logAction(action, entityType, entityId, detail) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
      user_id: user?.id,
    })
  }

  async function handleBudgetSaved(budget) {
    await logAction('created', 'budget', budget.id, `Budget set: ${budget.category} — $${budget.amount}`)
    setShowBudgetModal(false)
    loadData()
  }

  async function handlePurchaseSaved(purchase) {
    await logAction('recorded', 'purchase', purchase.id, `$${purchase.amount} — ${purchase.description}`)
    setShowPurchaseModal(false)
    loadData()
  }

  async function handleSubscriptionSaved(subscription) {
    await logAction('created', 'subscription', subscription.id, `Subscription added: ${subscription.name} — $${subscription.monthly_cost}/mo`)
    setShowSubscriptionModal(false)
    loadData()
  }

  async function handleDeleteSubscription(sub) {
    const confirmed = confirm(`Delete subscription "${sub.name}"?`)
    if (!confirmed) return

    await supabase.from('subscriptions').delete().eq('id', sub.id)
    await logAction('deleted', 'subscription', sub.id, `Subscription deleted: ${sub.name}`)
    loadData()
  }

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

  // Calculate totals
  const budgetByCategory = {}
  budgets.forEach(b => {
    budgetByCategory[b.category] = (budgetByCategory[b.category] || 0) + Number(b.amount || 0)
  })

  const spentByCategory = {}
  purchases.forEach(p => {
    spentByCategory[p.category] = (spentByCategory[p.category] || 0) + Number(p.amount || 0)
  })

  const totalBudget = Object.values(budgetByCategory).reduce((a, b) => a + b, 0)
  const totalSpent = Object.values(spentByCategory).reduce((a, b) => a + b, 0)
  const budgetUsed = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0

  const monthlySubCost = subscriptions.reduce((sum, s) => sum + Number(s.monthly_cost || 0), 0)
  const annualSubCost = monthlySubCost * 12

  if (loading) {
    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        Loading budget data...
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '10px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          IT Budget
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowBudgetModal(true)}
            style={{
              padding: '10px 22px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: '500',
              backgroundColor: '#131a24',
              color: '#8aa0b8',
              border: '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            Set Budget
          </button>
          <button
            onClick={() => setShowSubscriptionModal(true)}
            style={{
              padding: '10px 22px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: '500',
              backgroundColor: '#131a24',
              color: '#8aa0b8',
              border: '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            + Subscription
          </button>
          <button
            onClick={() => setShowPurchaseModal(true)}
            style={{
              backgroundColor: '#2563eb',
              color: '#fff',
              padding: '10px 22px',
              borderRadius: '10px',
              fontWeight: '600',
              fontSize: '13.5px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            + Purchase
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '14px',
        marginBottom: '24px',
      }}>
        {[
          { label: 'Total Budget', value: formatCurrency(totalBudget), color: '#60a5fa' },
          { label: 'Total Spent', value: formatCurrency(totalSpent), color: '#a78bfa' },
          {
            label: 'Remaining',
            value: formatCurrency(totalBudget - totalSpent),
            color: budgetUsed > 90 ? '#f87171' : '#4ade80',
          },
          { label: 'Monthly Subscriptions', value: formatCurrency(monthlySubCost), color: '#fbbf24' },
        ].map((card, i) => (
          <div key={i} style={{
            backgroundColor: '#0f1620',
            border: '1px solid #182030',
            borderRadius: '14px',
            padding: '18px',
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: '600',
              color: '#4a5a6e',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '8px',
            }}>
              {card.label}
            </div>
            <div style={{
              fontSize: '24px',
              fontWeight: '800',
              color: card.color,
              lineHeight: 1,
            }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Budget vs Actuals */}
      <div style={{
        backgroundColor: '#0f1620',
        border: '1px solid #182030',
        borderRadius: '14px',
        padding: '22px',
        marginBottom: '20px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#e0e7f0', marginBottom: '16px' }}>
          Budget vs. Actuals by Category
        </div>

        {categories.map(cat => {
          const budgeted = budgetByCategory[cat] || 0
          const spent = spentByCategory[cat] || 0
          const pct = budgeted > 0 ? (spent / budgeted) * 100 : (spent > 0 ? 100 : 0)

          if (budgeted === 0 && spent === 0) return null

          return (
            <div key={cat} style={{ marginBottom: '14px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '12.5px',
                marginBottom: '6px',
              }}>
                <span style={{ color: '#8aa0b8', fontWeight: '500' }}>{cat}</span>
                <span style={{ color: '#5a6e84', fontSize: '12px' }}>
                  {formatCurrency(spent)} / {budgeted > 0 ? formatCurrency(budgeted) : 'no budget'}
                </span>
              </div>
              <div style={{
                height: '8px',
                borderRadius: '4px',
                backgroundColor: '#131a24',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: '4px',
                  width: `${Math.min(pct, 100)}%`,
                  backgroundColor: pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : '#22c55e',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )
        })}

        {totalBudget === 0 && totalSpent === 0 && (
          <div style={{ fontSize: '13px', color: '#3a4a5e', padding: '12px', textAlign: 'center' }}>
            Set a budget and log purchases to see your spending breakdown.
          </div>
        )}

        {(totalBudget > 0 || totalSpent > 0) && (
          <div style={{
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid #182030',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '13px',
          }}>
            <span style={{ fontWeight: '600', color: '#8aa0b8' }}>Total</span>
            <span style={{ color: '#e0e7f0', fontWeight: '600' }}>
              {formatCurrency(totalSpent)} / {formatCurrency(totalBudget)}
            </span>
          </div>
        )}
      </div>

      {/* Subscriptions */}
      <div style={{
        backgroundColor: '#0f1620',
        border: '1px solid #182030',
        borderRadius: '14px',
        padding: '22px',
        marginBottom: '20px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '14px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#e0e7f0' }}>
            Recurring Costs / Subscriptions
          </div>
          {subscriptions.length > 0 && (
            <span style={{ fontSize: '12px', color: '#5a6e84' }}>
              {formatCurrency(monthlySubCost)}/mo · {formatCurrency(annualSubCost)}/yr
            </span>
          )}
        </div>

        {subscriptions.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#3a4a5e', textAlign: 'center', padding: '12px' }}>
            No subscriptions tracked yet.
          </div>
        ) : (
          subscriptions.map(sub => (
            <div key={sub.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid #141d28',
              fontSize: '13px',
            }}>
              <div>
                <span style={{ color: '#c0cad8', fontWeight: '500' }}>{sub.name}</span>
                {sub.vendor && (
                  <span style={{ color: '#4a5a6e', marginLeft: '10px', fontSize: '12px' }}>
                    {sub.vendor}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#8aa0b8' }}>
                  {formatCurrency(sub.monthly_cost)}/mo
                </span>
                {sub.renewal_date && (
                  <span style={{ fontSize: '11px', color: '#5a6e84' }}>
                    Renews {formatDate(sub.renewal_date)}
                  </span>
                )}
                <button
                  onClick={() => handleDeleteSubscription(sub)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: '500',
                    backgroundColor: '#7f1d1d',
                    color: '#fca5a5',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Purchases */}
      <div style={{
        backgroundColor: '#0f1620',
        border: '1px solid #182030',
        borderRadius: '14px',
        padding: '22px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#e0e7f0', marginBottom: '14px' }}>
          Recent Purchases
        </div>

        {purchases.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#3a4a5e', textAlign: 'center', padding: '12px' }}>
            No purchases logged yet.
          </div>
        ) : (
          purchases.slice(0, 15).map(p => (
            <div key={p.id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid #141d28',
              fontSize: '13px',
            }}>
              <div>
                <span style={{ color: '#c0cad8' }}>{p.description}</span>
                <span style={{ color: '#4a5a6e', marginLeft: '10px', fontSize: '12px' }}>
                  {p.category}{p.vendor ? ` · ${p.vendor}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ color: '#8aa0b8' }}>
                  {formatCurrency(p.amount)}
                </span>
                <span style={{ fontSize: '11px', color: '#3a4a5e' }}>
                  {formatDate(p.created_at)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      {showBudgetModal && (
        <BudgetModal onSave={handleBudgetSaved} onClose={() => setShowBudgetModal(false)} />
      )}
      {showPurchaseModal && (
        <PurchaseModal onSave={handlePurchaseSaved} onClose={() => setShowPurchaseModal(false)} />
      )}
      {showSubscriptionModal && (
        <SubscriptionModal onSave={handleSubscriptionSaved} onClose={() => setShowSubscriptionModal(false)} />
      )}
    </div>
  )
}