'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import {
  BATCH_STATUS_META, SOURCE_META, formatDate, relativeTime,
} from '../../../../lib/priceupdates'

// Phase 1: minimal batch detail — header, properties, and the attached files.
// The full two-pane review UI (line grid + inline edit + approve) lands in Phase 4.
export default function BatchDetail() {
  const supabase = createClient()
  const { id } = useParams()
  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: b } = await supabase
        .from('pu_batches')
        .select('*, vendor:vendor_id(id, name)')
        .eq('id', id)
        .single()
      setBatch(b)
      const { data: f } = await supabase
        .from('pu_batch_files')
        .select('id, file_name, file_size, storage_path, parse_status, created_at')
        .eq('batch_id', id)
        .order('created_at')
      setFiles(f || [])
      setLoading(false)
    }
    load()
  }, [id])

  async function downloadFile(f) {
    const { data, error } = await supabase.storage.from('price-files').createSignedUrl(f.storage_path, 60)
    if (error) return alert('Error: ' + error.message)
    window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!batch) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
        Batch not found. <Link href="/priceupdates/batches" style={{ color: '#60a5fa' }}>Back to batches</Link>
      </div>
    )
  }

  const status = BATCH_STATUS_META[batch.status] || BATCH_STATUS_META.received
  const src = SOURCE_META[batch.source] || {}

  const labelStyle = { fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }
  const valueStyle = { fontSize: '13.5px', color: '#c0cad8', marginBottom: '14px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '900px' }}>
      <Link href="/priceupdates/batches" style={{ fontSize: '12.5px', color: '#5a6e84', textDecoration: 'none' }}>
        ← Batches
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0 20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>
            Batch #{batch.number}
          </h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
            {batch.vendor?.name || 'Unidentified vendor'} · received {relativeTime(batch.received_at)}
          </p>
        </div>
        <span style={{
          padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '600',
          backgroundColor: status.pillBg, color: status.pillText,
        }}>{status.label}</span>
      </div>

      <div style={{
        backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
        padding: '20px', marginBottom: '16px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '4px 24px',
      }}>
        <div>
          <div style={labelStyle}>Vendor</div>
          <div style={valueStyle}>{batch.vendor?.name || 'Unidentified'}</div>
        </div>
        <div>
          <div style={labelStyle}>Source</div>
          <div style={valueStyle}>{src.icon ? `${src.icon} ` : ''}{src.label || batch.source}</div>
        </div>
        <div>
          <div style={labelStyle}>Effective date</div>
          <div style={valueStyle}>{formatDate(batch.effective_date)}</div>
        </div>
        <div>
          <div style={labelStyle}>Lines</div>
          <div style={valueStyle}>{batch.line_count || 0} ({batch.matched_count || 0} matched, {batch.flagged_count || 0} flagged)</div>
        </div>
      </div>

      {/* Files */}
      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '20px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '14px' }}>
          Files ({files.length})
        </div>
        {files.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#4a5a6e' }}>No files attached.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {files.map(f => (
              <div key={f.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                padding: '10px 14px', backgroundColor: '#131a24', border: '1px solid #182030', borderRadius: '10px',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.file_name}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#5a6e84' }}>
                    {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB · ` : ''}{f.parse_status}
                  </div>
                </div>
                <button onClick={() => downloadFile(f)} style={{
                  padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '500',
                  backgroundColor: '#1e2a3a', color: '#60a5fa', border: '1px solid #1e40af', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>Download</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '16px', fontSize: '12.5px', color: '#4a5a6e' }}>
        Parsing, matching, and the review grid arrive in later phases.
      </div>
    </div>
  )
}
