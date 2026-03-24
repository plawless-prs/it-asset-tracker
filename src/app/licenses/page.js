'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'
import LicenseModal from '../../components/LicenseModal'

export default function LicensesPage() {
  const supabase = createClient()
  const [licenses, setLicenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingLicense, setEditingLicense] = useState(null)

  useEffect(() => {
    loadLicenses()
  }, [])

  async function loadLicenses() {
    const { data } = await supabase
      .from('licenses')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setLicenses(data)
    setLoading(false)
  }

  async function logAction(action, entityId, detail) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action,
      entity_type: 'license',
      entity_id: entityId,
      detail,
      user_id: user?.id,
    })
  }

  async function handleSaved(license, isNew) {
    await logAction(
      isNew ? 'created' : 'updated',
      license.id,
      `License "${license.name}" ${isNew ? 'added' : 'updated'}`
    )
    setShowAddModal(false)
    setEditingLicense(null)
    loadLicenses()
  }

  async function handleDelete(license) {
    const confirmed = confirm(`Are you sure you want to delete the license "${license.name}"?`)
    if (!confirmed) return

    await supabase.from('licenses').delete().eq('id', license.id)
    await logAction('deleted', license.id, `License "${license.name}" deleted`)
    loadLicenses()
  }

  function formatCurrency(n) {
    if (!n) return '—'
    return '$' + Number(n).toLocaleString('en-US', {
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

  // Check expiration status
  function getExpirationStatus(expirationDate) {
    if (!expirationDate) return 'none'
    const now = new Date()
    const expiry = new Date(expirationDate)
    const daysLeft = (expiry - now) / (1000 * 60 * 60 * 24)

    if (daysLeft < 0) return 'expired'
    if (daysLeft <= 30) return 'expiring'
    return 'ok'
  }

  // Calculate totals
  const totalAnnualCost = licenses.reduce((sum, l) => sum + Number(l.annual_cost || 0), 0)
  const totalSeats = licenses.reduce((sum, l) => sum + Number(l.total_seats || 0), 0)
  const usedSeats = licenses.reduce((sum, l) => sum + Number(l.seats_used || 0), 0)
  const expiringCount = licenses.filter(l => getExpirationStatus(l.expiration_date) === 'expiring').length
  const expiredCount = licenses.filter(l => getExpirationStatus(l.expiration_date) === 'expired').length

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          Software Licenses
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
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
          + Add License
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '14px',
        marginBottom: '24px',
      }}>
        {[
          { label: 'Total Licenses', value: licenses.length, color: '#a78bfa' },
          { label: 'Annual Cost', value: formatCurrency(totalAnnualCost), color: '#60a5fa' },
          { label: 'Seats Used', value: `${usedSeats} / ${totalSeats || '—'}`, color: '#4ade80' },
          { label: 'Expiring Soon', value: expiringCount, color: expiringCount > 0 ? '#fbbf24' : '#4a5a6e' },
          { label: 'Expired', value: expiredCount, color: expiredCount > 0 ? '#f87171' : '#4a5a6e' },
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
              fontSize: '22px',
              fontWeight: '800',
              color: card.color,
              lineHeight: 1,
            }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* License List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>
          Loading licenses...
        </div>
      ) : licenses.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          textAlign: 'center',
          padding: '48px',
          color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>⊟</div>
          <div style={{ fontSize: '14px' }}>
            No licenses tracked yet. Click "+ Add License" to get started.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {licenses.map(license => {
            const status = getExpirationStatus(license.expiration_date)
            const isExpired = status === 'expired'
            const isExpiring = status === 'expiring'

            // Seat usage percentage
            const seatPct = license.total_seats
              ? (Number(license.seats_used || 0) / Number(license.total_seats)) * 100
              : 0

            return (
              <div
                key={license.id}
                style={{
                  backgroundColor: '#0f1620',
                  border: `1px solid ${isExpired ? '#991b1b' : isExpiring ? '#854d0e' : '#182030'}`,
                  borderRadius: '14px',
                  padding: '22px',
                }}
              >
                {/* Top row: name, seats, status */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px',
                }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: '600', color: '#d0d8e4' }}>
                      {license.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#4a5a6e', marginTop: '4px' }}>
                      {license.product_key || 'No key stored'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', color: '#8aa0b8' }}>
                      {license.seats_used || 0} / {license.total_seats || '∞'} seats
                    </div>
                    {isExpired && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#f87171',
                        backgroundColor: '#330d0d',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        marginTop: '4px',
                        display: 'inline-block',
                      }}>
                        EXPIRED
                      </span>
                    )}
                    {isExpiring && (
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '600',
                        color: '#fbbf24',
                        backgroundColor: '#332800',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        marginTop: '4px',
                        display: 'inline-block',
                      }}>
                        EXPIRING SOON
                      </span>
                    )}
                  </div>
                </div>

                {/* Seat usage bar */}
                {license.total_seats && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{
                      height: '6px',
                      borderRadius: '3px',
                      backgroundColor: '#131a24',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        borderRadius: '3px',
                        width: `${Math.min(seatPct, 100)}%`,
                        backgroundColor: seatPct > 90 ? '#ef4444' : seatPct > 70 ? '#f59e0b' : '#22c55e',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                )}

                {/* Details row */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}>
                  <div style={{
                    display: 'flex',
                    gap: '20px',
                    fontSize: '12px',
                    color: '#5a6e84',
                  }}>
                    <span>Expires: {formatDate(license.expiration_date)}</span>
                    <span>Cost: {license.annual_cost ? formatCurrency(license.annual_cost) + '/yr' : '—'}</span>
                    <span>Vendor: {license.vendor || '—'}</span>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setEditingLicense(license)}
                      style={{
                        padding: '5px 14px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: '#131a24',
                        color: '#8aa0b8',
                        border: '1px solid #1e2d40',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(license)}
                      style={{
                        padding: '5px 14px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: '#7f1d1d',
                        color: '#fca5a5',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingLicense) && (
        <LicenseModal
          license={editingLicense}
          onSave={handleSaved}
          onClose={() => { setShowAddModal(false); setEditingLicense(null) }}
        />
      )}
    </div>
  )
}