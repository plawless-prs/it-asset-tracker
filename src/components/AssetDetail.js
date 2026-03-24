'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

export default function AssetDetail({ asset, onClose, onCheckout, onCheckin, onDispose, onEdit }) {
  const supabase = createClient()
  const [history, setHistory] = useState([])

  useEffect(() => {
    loadHistory()
  }, [asset.id])

  async function loadHistory() {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .eq('entity_type', 'asset')
      .eq('entity_id', asset.id)
      .order('created_at', { ascending: false })

    if (data) setHistory(data)
  }

  // Depreciation calculation
  let depreciationPct = 0
  let currentValue = Number(asset.purchase_cost || 0)

  if (asset.purchase_date && asset.purchase_cost && asset.useful_life_months) {
    const monthsElapsed = (new Date() - new Date(asset.purchase_date)) / (1000 * 60 * 60 * 24 * 30.44)
    depreciationPct = Math.min((monthsElapsed / Number(asset.useful_life_months)) * 100, 100)
    currentValue = Math.max(Number(asset.purchase_cost) * (1 - depreciationPct / 100), 0)
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

  const statusColors = {
    'Ready to Deploy': { bg: '#0d3320', text: '#4ade80', border: '#166534' },
    'Deployed': { bg: '#1e2a3a', text: '#60a5fa', border: '#1e40af' },
    'Pending': { bg: '#332800', text: '#fbbf24', border: '#854d0e' },
    'In Repair': { bg: '#331a00', text: '#fb923c', border: '#9a3412' },
    'Archived': { bg: '#1a1a2e', text: '#a78bfa', border: '#5b21b6' },
    'Lost/Stolen': { bg: '#330d0d', text: '#f87171', border: '#991b1b' },
    'Disposed': { bg: '#1a1a1a', text: '#737373', border: '#404040' },
  }

  const sc = statusColors[asset.status] || statusColors['Pending']

  const btnStyle = {
    padding: '8px 18px',
    borderRadius: '8px',
    fontSize: '12.5px',
    fontWeight: '500',
    cursor: 'pointer',
    border: '1px solid #1e2d40',
    backgroundColor: '#131a24',
    color: '#8aa0b8',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0f1620',
          border: '1px solid #1e2d40',
          borderRadius: '16px',
          padding: '28px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '20px',
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
              {asset.name}
            </h2>
            <div style={{ fontSize: '12px', color: '#4a5a6e', marginTop: '4px' }}>
              ID: #{asset.id} · {asset.serial_number || 'No serial'}
            </div>
          </div>
          <span style={{
            display: 'inline-flex',
            padding: '4px 12px',
            borderRadius: '100px',
            fontSize: '11.5px',
            fontWeight: '600',
            backgroundColor: sc.bg,
            color: sc.text,
            border: `1px solid ${sc.border}`,
          }}>
            {asset.status}
          </span>
        </div>

        {/* Photo */}
        {asset.photo_url && (
          <img
            src={asset.photo_url}
            alt={asset.name}
            style={{
              width: '100%',
              height: '200px',
              objectFit: 'cover',
              borderRadius: '12px',
              marginBottom: '18px',
            }}
          />
        )}

        {/* Details Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 16px',
          marginBottom: '16px',
          fontSize: '13px',
        }}>
          <div><span style={{ color: '#4a5a6e' }}>Category: </span><span style={{ color: '#8aa0b8' }}>{asset.category}</span></div>
          <div><span style={{ color: '#4a5a6e' }}>Make/Model: </span><span style={{ color: '#8aa0b8' }}>{asset.make} {asset.model}</span></div>
          <div><span style={{ color: '#4a5a6e' }}>Assigned To: </span><span style={{ color: '#8aa0b8' }}>{asset.assigned_to || '—'}</span></div>
          <div><span style={{ color: '#4a5a6e' }}>Location: </span><span style={{ color: '#8aa0b8' }}>{asset.location || '—'}</span></div>
          <div><span style={{ color: '#4a5a6e' }}>Purchase Date: </span><span style={{ color: '#8aa0b8' }}>{formatDate(asset.purchase_date)}</span></div>
          <div><span style={{ color: '#4a5a6e' }}>Warranty: </span><span style={{ color: '#8aa0b8' }}>{formatDate(asset.warranty_expiry)}</span></div>
        </div>

        {/* Depreciation */}
        {asset.purchase_cost && (
          <div style={{
            backgroundColor: '#0c1118',
            borderRadius: '10px',
            padding: '16px',
            marginBottom: '16px',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '8px',
              fontSize: '12px',
            }}>
              <span style={{ color: '#5a6e84' }}>
                Depreciation ({depreciationPct.toFixed(0)}%)
              </span>
              <span style={{ color: '#8aa0b8' }}>
                Current value: {formatCurrency(currentValue)}
              </span>
            </div>
            <div style={{
              height: '6px',
              borderRadius: '3px',
              backgroundColor: '#131a24',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                borderRadius: '3px',
                width: `${depreciationPct}%`,
                backgroundColor: depreciationPct > 80 ? '#ef4444' : depreciationPct > 50 ? '#f59e0b' : '#22c55e',
                transition: 'width 0.6s ease',
              }} />
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '6px',
              fontSize: '11px',
              color: '#3a4a5e',
            }}>
              <span>{formatCurrency(asset.purchase_cost)} original</span>
              <span>{asset.useful_life_months}mo useful life</span>
            </div>
          </div>
        )}

        {/* Notes */}
        {asset.notes && (
          <div style={{
            fontSize: '13px',
            color: '#6a7e94',
            marginBottom: '16px',
            lineHeight: '1.6',
          }}>
            📝 {asset.notes}
          </div>
        )}

        {/* Asset History */}
        {history.length > 0 && (
          <div style={{ marginBottom: '18px' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#5a6e84',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '8px',
            }}>
              Asset History
            </div>
            {history.map((h, i) => (
              <div key={i} style={{
                fontSize: '12px',
                padding: '6px 0',
                borderBottom: '1px solid #141d28',
                display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span style={{ color: '#6a7e94' }}>{h.detail}</span>
                <span style={{ color: '#3a4a5e', fontSize: '11px' }}>
                  {formatDate(h.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {asset.status !== 'Disposed' && asset.status !== 'Deployed' && (
            <button style={btnStyle} onClick={() => onCheckout(asset)}>
              Check Out
            </button>
          )}
          {asset.status === 'Deployed' && (
            <button style={btnStyle} onClick={() => onCheckin(asset)}>
              Check In
            </button>
          )}
          <button style={btnStyle} onClick={() => onEdit(asset)}>
            Edit
          </button>
          {asset.status !== 'Disposed' && (
            <button
              onClick={() => onDispose(asset)}
              style={{
                ...btnStyle,
                backgroundColor: '#7f1d1d',
                color: '#fca5a5',
                border: 'none',
              }}
            >
              Dispose
            </button>
          )}
          <button style={btnStyle} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}