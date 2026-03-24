'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'

export default function HistoryPage() {
  const supabase = createClient()
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('All')

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadHistory() {
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) setHistory(data)
    setLoading(false)
  }

  function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const actionColors = {
    created: '#4ade80',
    updated: '#60a5fa',
    checked_out: '#a78bfa',
    checked_in: '#22d3ee',
    disposed: '#f87171',
    recorded: '#fbbf24',
    deleted: '#f87171',
  }

  const entityTypes = ['All', ...new Set(history.map(h => h.entity_type).filter(Boolean))]

  const filtered = filterType === 'All'
    ? history
    : history.filter(h => h.entity_type === filterType)

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
        Audit History
      </h1>

      {/* Filters */}
      {entityTypes.length > 1 && (
        <div style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '18px',
          flexWrap: 'wrap',
        }}>
          {entityTypes.map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              style={{
                padding: '6px 16px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '500',
                backgroundColor: filterType === type ? '#111d2e' : 'transparent',
                color: filterType === type ? '#60a5fa' : '#5a6e84',
                border: filterType === type ? '1px solid #1e3a5f' : '1px solid #1e2d40',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {type === 'All' ? 'All' : type + 's'}
            </button>
          ))}
        </div>
      )}

      {/* History List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>
          Loading history...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          textAlign: 'center',
          padding: '48px',
          color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>◷</div>
          <div style={{ fontSize: '14px' }}>
            {history.length === 0
              ? 'No activity recorded yet. Actions like adding assets, logging purchases, and checking out equipment will appear here.'
              : 'No activity matches this filter.'}
          </div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          overflow: 'hidden',
        }}>
          {filtered.map((entry, i) => (
            <div key={entry.id || i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '12px 20px',
              borderBottom: '1px solid #141d28',
              fontSize: '13px',
            }}>
              {/* Color dot */}
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '4px',
                backgroundColor: actionColors[entry.action] || '#4a5a6e',
                flexShrink: 0,
              }} />

              {/* Detail */}
              <div style={{ flex: 1, color: '#c0cad8' }}>
                {entry.detail}
              </div>

              {/* Entity type badge */}
              {entry.entity_type && (
                <span style={{
                  padding: '2px 10px',
                  borderRadius: '100px',
                  fontSize: '11px',
                  fontWeight: '500',
                  backgroundColor: '#131a24',
                  color: '#5a6e84',
                  border: '1px solid #1e2d40',
                  flexShrink: 0,
                  textTransform: 'capitalize',
                }}>
                  {entry.entity_type}
                </span>
              )}

              {/* Timestamp */}
              <div style={{
                fontSize: '11px',
                color: '#3a4a5e',
                flexShrink: 0,
                minWidth: '100px',
                textAlign: 'right',
              }}>
                {formatDate(entry.created_at)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}