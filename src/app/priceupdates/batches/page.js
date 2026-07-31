'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import NewBatchModal from '../../../components/NewBatchModal'
import {
  BATCH_STATUS_META, BATCH_STATUS_ORDER, SOURCE_META,
  attentionPill, relativeTime,
} from '../../../lib/priceupdates'

const selectStyle = {
  padding: '7px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '12.5px', outline: 'none',
}

function Pill({ meta }) {
  if (!meta) return null
  return (
    <span style={{
      padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '600',
      backgroundColor: meta.pillBg, color: meta.pillText, whiteSpace: 'nowrap',
    }}>{meta.label}</span>
  )
}

const GRID = '70px 1fr 90px 130px 150px 130px 130px'

export default function BatchQueue() {
  const supabase = createClient()
  const router = useRouter()
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [fStatus, setFStatus] = useState('open')
  const [fVendor, setFVendor] = useState('all')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('pu_batches')
        .select('id, number, source, status, received_at, line_count, matched_count, flagged_count, vendor:vendor_id(id, name)')
        .order('received_at', { ascending: false })
      setBatches(data || [])
      setLoading(false)
    }
    load()
  }, [])

  // Vendor options come from the batches actually present.
  const vendorOptions = Array.from(
    new Map(batches.filter(b => b.vendor).map(b => [b.vendor.id, b.vendor.name])).entries()
  ).map(([id, name]) => ({ id, name }))

  const filtered = batches.filter(b => {
    if (fStatus === 'open' && !['received', 'parsing', 'needs_review', 'approved', 'exported'].includes(b.status)) return false
    if (fStatus === 'history' && !['applied', 'archived'].includes(b.status)) return false
    if (!['open', 'history', 'all'].includes(fStatus) && b.status !== fStatus) return false
    if (fVendor !== 'all' && (b.vendor?.id || 'none') !== fVendor) return false
    return true
  })

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Batches</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>{filtered.length} shown</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{
          backgroundColor: '#2563eb', color: '#fff', padding: '10px 18px', borderRadius: '10px',
          fontWeight: '600', fontSize: '13px', border: 'none', cursor: 'pointer',
        }}>+ New batch</button>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <select style={selectStyle} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="history">History (applied + archived)</option>
          <option value="all">All statuses</option>
          {BATCH_STATUS_ORDER.map(s => <option key={s} value={s}>{BATCH_STATUS_META[s].label}</option>)}
        </select>
        <select style={selectStyle} value={fVendor} onChange={e => setFVendor(e.target.value)}>
          <option value="all">All vendors</option>
          {vendorOptions.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: GRID, gap: '10px',
          padding: '11px 18px', borderBottom: '1px solid #182030', fontSize: '11px',
          color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <div>Batch</div><div>Vendor</div><div>Source</div><div>Received</div>
          <div>Lines</div><div>Status</div><div>Attention</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>
            No batches match.{' '}
            <button onClick={() => setShowNew(true)} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '13px' }}>
              Create one →
            </button>
          </div>
        ) : filtered.map(b => {
          const status = BATCH_STATUS_META[b.status] || BATCH_STATUS_META.received
          const src = SOURCE_META[b.source] || {}
          const attn = attentionPill(b)
          const unmatched = (b.line_count || 0) - (b.matched_count || 0)
          return (
            <div
              key={b.id}
              onClick={() => router.push(`/priceupdates/batches/${b.id}`)}
              style={{
                display: 'grid', gridTemplateColumns: GRID, gap: '10px',
                padding: '13px 18px', borderBottom: '1px solid #131c28', alignItems: 'center', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#111b27'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#60a5fa' }}>#{b.number}</div>
              <div style={{ fontSize: '13.5px', color: b.vendor ? '#d0d8e4' : '#4a5a6e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.vendor?.name || 'Unidentified'}
              </div>
              <div style={{ fontSize: '12.5px', color: '#8aa0b8' }}>
                {src.icon ? `${src.icon} ` : ''}{src.label || b.source}
              </div>
              <div style={{ fontSize: '12.5px', color: '#8aa0b8' }}>{relativeTime(b.received_at)}</div>
              <div style={{ fontSize: '12.5px', color: '#8aa0b8' }}>
                {b.line_count || 0}
                {b.line_count > 0 && (
                  <span style={{ color: unmatched > 0 ? '#f87171' : '#4ade80' }}>
                    {' '}· {b.matched_count || 0} matched
                  </span>
                )}
              </div>
              <div><Pill meta={status} /></div>
              <div>{attn ? <Pill meta={attn} /> : <span style={{ color: '#3a4a5e', fontSize: '12px' }}>—</span>}</div>
            </div>
          )
        })}
      </div>

      {showNew && (
        <NewBatchModal
          onClose={() => setShowNew(false)}
          onCreated={(batch) => { setShowNew(false); router.push(`/priceupdates/batches/${batch.id}`) }}
        />
      )}
    </div>
  )
}
