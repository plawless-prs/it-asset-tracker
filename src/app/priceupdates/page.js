'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import NewBatchModal from '../../components/NewBatchModal'
import {
  BATCH_STATUS_META, SOURCE_META, attentionPill, relativeTime, daysUntil,
} from '../../lib/priceupdates'

function MetricCard({ label, value, accent }) {
  return (
    <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color: accent || '#e0e7f0' }}>{value}</div>
    </div>
  )
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

const GRID = '70px 1fr 110px 150px 130px'

export default function PriceUpdatesDashboard() {
  const supabase = createClient()
  const router = useRouter()
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('pu_batches')
        .select('id, number, source, status, received_at, applied_at, effective_date, line_count, matched_count, flagged_count, vendor:vendor_id(id, name), files:pu_batch_files(count)')
        .order('received_at', { ascending: false })
      setBatches((data || []).map(b => ({ ...b, file_count: b.files?.[0]?.count ?? 0 })))
      setLoading(false)
    }
    load()
  }, [])

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const metrics = {
    // Scheduled batches at/past their effective date and not yet applied.
    dueNow: batches.filter(b =>
      b.effective_date && !['applied', 'archived'].includes(b.status) &&
      daysUntil(b.effective_date) <= 0
    ).length,
    awaitingReview: batches.filter(b => b.status === 'needs_review').length,
    unmatchedLines: batches
      .filter(b => ['needs_review', 'approved'].includes(b.status))
      .reduce((sum, b) => sum + Math.max(0, (b.line_count || 0) - (b.matched_count || 0)), 0),
    approvedNotExported: batches.filter(b => b.status === 'approved').length,
    exportedNotApplied: batches.filter(b => b.status === 'exported').length,
    appliedThisMonth: batches.filter(b => b.status === 'applied' && b.applied_at && new Date(b.applied_at) >= monthStart).length,
  }

  const recent = batches.slice(0, 8)

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Price Updates</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>Dashboard</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{
          backgroundColor: '#2563eb', color: '#fff', padding: '10px 18px', borderRadius: '10px',
          fontWeight: '600', fontSize: '13px', border: 'none', cursor: 'pointer',
        }}>+ New batch</button>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : (
        <>
          {/* Metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <MetricCard label="Due to load in P21" value={metrics.dueNow} accent={metrics.dueNow ? '#f87171' : undefined} />
            <MetricCard label="Awaiting review" value={metrics.awaitingReview} accent={metrics.awaitingReview ? '#fbbf24' : undefined} />
            <MetricCard label="Unmatched lines" value={metrics.unmatchedLines} accent={metrics.unmatchedLines ? '#f87171' : undefined} />
            <MetricCard label="Approved, not exported" value={metrics.approvedNotExported} />
            <MetricCard label="Exported, not applied" value={metrics.exportedNotApplied} accent={metrics.exportedNotApplied ? '#a78bfa' : undefined} />
            <MetricCard label="Applied this month" value={metrics.appliedThisMonth} />
          </div>

          {/* Recent batches */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 18px', borderBottom: '1px solid #182030',
            }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8' }}>Recent batches</div>
              <button onClick={() => router.push('/priceupdates/batches')} style={{
                background: 'none', border: 'none', color: '#60a5fa', fontSize: '12.5px', cursor: 'pointer',
              }}>View all →</button>
            </div>

            <div style={{
              display: 'grid', gridTemplateColumns: GRID, gap: '10px',
              padding: '10px 18px', borderBottom: '1px solid #182030', fontSize: '11px',
              color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              <div>Batch</div><div>Vendor</div><div>Received</div><div>Status</div><div>Attention</div>
            </div>

            {recent.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>
                No batches yet.{' '}
                <button onClick={() => setShowNew(true)} style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '13px' }}>
                  Create one →
                </button>
              </div>
            ) : recent.map(b => {
              const status = BATCH_STATUS_META[b.status] || BATCH_STATUS_META.received
              const attn = attentionPill(b)
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
                  <div style={{ fontSize: '12.5px', color: '#8aa0b8' }}>{relativeTime(b.received_at)}</div>
                  <div><Pill meta={status} /></div>
                  <div>{attn ? <Pill meta={attn} /> : <span style={{ color: '#3a4a5e', fontSize: '12px' }}>—</span>}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {showNew && (
        <NewBatchModal
          onClose={() => setShowNew(false)}
          onCreated={(batch) => { setShowNew(false); router.push(`/priceupdates/batches/${batch.id}`) }}
        />
      )}
    </div>
  )
}
