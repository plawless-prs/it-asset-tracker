'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import {
  BATCH_STATUS_META, SOURCE_META, MATCH_META, FLAG_META,
  formatCurrency, formatDate, formatPct, relativeTime,
} from '../../../../lib/priceupdates'
import { fetchParsedSheets, applyParse, triggerMatch } from '../../../../lib/priceupdatesParse'

const SPREADSHEET = /\.(xlsx|xls|csv)$/i

// Phase 1: header + files. Phase 2 adds the parse actions (map / auto-parse)
// and a read-only preview of the parsed lines. The full two-pane editable
// review grid + approve flow lands in Phase 4.
export default function BatchDetail() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()
  const { user } = useRole()
  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [lines, setLines] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyFile, setBusyFile] = useState(null)
  const [matching, setMatching] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data: b } = await supabase
      .from('pu_batches').select('*, vendor:vendor_id(id, name)').eq('id', id).single()
    setBatch(b)
    const { data: f } = await supabase
      .from('pu_batch_files')
      .select('id, file_name, file_size, storage_path, parse_status, parsed_rows, parse_profile_id, error, created_at')
      .eq('batch_id', id).order('created_at')
    setFiles(f || [])
    const { data: l } = await supabase
      .from('pu_lines')
      .select('id, vendor_item_no, description, uom, old_cost, new_cost, new_list, cost_change_pct, effective_date, match_status, flag')
      .eq('batch_id', id).order('row_number').limit(500)
    setLines(l || [])
    if (b?.vendor_id) {
      const { data: p } = await supabase
        .from('pu_parse_profiles').select('id, label, config, created_at')
        .eq('vendor_id', b.vendor_id).order('created_at', { ascending: false })
      setProfiles(p || [])
    } else {
      setProfiles([])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  async function downloadFile(f) {
    const { data, error: e } = await supabase.storage.from('price-files').createSignedUrl(f.storage_path, 60)
    if (e) return alert('Error: ' + e.message)
    window.open(data.signedUrl, '_blank')
  }

  // One-click auto-parse using the vendor's most recent saved profile.
  async function autoParse(f) {
    setError('')
    setBusyFile(f.id)
    try {
      const res = await fetchParsedSheets(supabase, f.id)
      await applyParse(supabase, {
        batch, file: f, sheets: res.sheets, config: profiles[0].config,
        userId: user?.id, saveProfile: null,
      })
      try { await triggerMatch(supabase, batch.id) } catch { /* matching is best-effort */ }
      await load()
    } catch (e) {
      setError(`Auto-parse failed for ${f.file_name}: ${e.message}. Try mapping the columns manually.`)
    } finally {
      setBusyFile(null)
    }
  }

  // Re-run the P21 matching pass (re-runnable, non-destructive to include flags).
  async function rematch() {
    setError(''); setNotice('')
    setMatching(true)
    try {
      const r = await triggerMatch(supabase, id)
      const bits = [`${r.matched}/${r.total} matched`]
      if (r.ambiguous) bits.push(`${r.ambiguous} ambiguous`)
      if (r.flagged) bits.push(`${r.flagged} flagged`)
      if (r.warning) bits.push(r.warning)
      else if (!r.mirror_rows) bits.push('P21 mirror is empty — sync it in Settings')
      setNotice(bits.join(' · '))
      await load()
    } catch (e) {
      setError(`Matching failed: ${e.message}`)
    } finally {
      setMatching(false)
    }
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  if (!batch) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      Batch not found. <Link href="/priceupdates/batches" style={{ color: '#60a5fa' }}>Back to batches</Link>
    </div>
  )

  const status = BATCH_STATUS_META[batch.status] || BATCH_STATUS_META.received
  const src = SOURCE_META[batch.source] || {}

  const labelStyle = { fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }
  const valueStyle = { fontSize: '13.5px', color: '#c0cad8', marginBottom: '14px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1000px' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lines.length > 0 && (
            <button onClick={rematch} disabled={matching} style={{
              padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '600',
              backgroundColor: matching ? '#1a2433' : '#131a24', color: matching ? '#5a6e84' : '#60a5fa',
              border: '1px solid #1e3a5f', cursor: matching ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}>{matching ? 'Matching…' : '↻ Re-run matching'}</button>
          )}
          <span style={{
            padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '600',
            backgroundColor: status.pillBg, color: status.pillText,
          }}>{status.label}</span>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', fontSize: '12.5px', backgroundColor: '#13202e', color: '#7fb4f5', border: '1px solid #1e3a5f' }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding: '12px 16px', borderRadius: '10px', marginBottom: '16px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>
          {error}
        </div>
      )}

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

      {/* Files + parse actions */}
      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '14px' }}>
          Files ({files.length})
        </div>
        {files.length === 0 ? (
          <div style={{ fontSize: '13px', color: '#4a5a6e' }}>No files attached.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {files.map(f => {
              const isSheet = SPREADSHEET.test(f.file_name)
              const parsed = f.parse_status === 'parsed'
              const busy = busyFile === f.id
              return (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '12px 14px', backgroundColor: '#131a24', border: '1px solid #182030', borderRadius: '10px',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.file_name}
                    </div>
                    <div style={{ fontSize: '11.5px', color: parsed ? '#4ade80' : '#5a6e84' }}>
                      {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB · ` : ''}
                      {parsed ? `parsed · ${f.parsed_rows} lines` : f.parse_status}
                      {f.error ? ` · ${f.error}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                    {isSheet && !parsed && profiles.length > 0 && (
                      <button onClick={() => autoParse(f)} disabled={busy} style={btnPrimary(busy)}>
                        {busy ? 'Parsing…' : `Auto-parse (${profiles[0].label})`}
                      </button>
                    )}
                    {isSheet && (
                      <Link href={`/priceupdates/batches/${id}/map?file=${f.id}`} style={btnGhostLink}>
                        {parsed ? 'Re-map' : 'Map columns →'}
                      </Link>
                    )}
                    {!isSheet && (
                      <span style={{ fontSize: '11.5px', color: '#5a6e84' }}>Manual entry (later phase)</span>
                    )}
                    <button onClick={() => downloadFile(f)} style={btnGhost}>Download</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Parsed lines preview (read-only; editable grid comes in Phase 4) */}
      {lines.length > 0 && (
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #182030' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8' }}>Parsed lines</div>
            <div style={{ fontSize: '12px', color: '#5a6e84' }}>{batch.line_count || lines.length} total{lines.length >= 500 ? ' · showing first 500' : ''}</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: LINE_GRID, gap: '10px', minWidth: '760px',
            padding: '10px 18px', borderBottom: '1px solid #182030', fontSize: '11px',
            color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            <div>Item #</div><div>Description</div><div>Old cost</div><div>New cost</div><div>Δ%</div><div>Flag</div><div>Match</div>
          </div>
          <div style={{ maxHeight: '440px', overflowY: 'auto' }}>
            {lines.map(l => {
              const m = MATCH_META[l.match_status] || MATCH_META.unmatched
              const fl = FLAG_META[l.flag] || FLAG_META.review
              const up = l.cost_change_pct != null && l.cost_change_pct > 0
              const down = l.cost_change_pct != null && l.cost_change_pct < 0
              return (
                <div key={l.id} style={{
                  display: 'grid', gridTemplateColumns: LINE_GRID, gap: '10px', minWidth: '760px',
                  padding: '9px 18px', borderBottom: '1px solid #131c28', alignItems: 'center', fontSize: '12.5px',
                }}>
                  <div style={{ color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.vendor_item_no || '—'}</div>
                  <div style={{ color: '#8aa0b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description || '—'}</div>
                  <div style={{ color: '#8aa0b8' }}>{formatCurrency(l.old_cost)}</div>
                  <div style={{ color: '#c0cad8' }}>{formatCurrency(l.new_cost)}</div>
                  <div style={{ color: up ? '#f87171' : down ? '#fbbf24' : '#5a6e84', fontWeight: up || down ? '600' : '400' }}>
                    {l.cost_change_pct != null ? formatPct(l.cost_change_pct) : '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8aa0b8', fontSize: '11.5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: fl.dot, flexShrink: 0 }} />
                    {fl.label}
                  </div>
                  <div>
                    <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: m.pillBg, color: m.pillText }}>{m.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>
      )}

      {lines.length === 0 && files.some(f => SPREADSHEET.test(f.file_name)) && (
        <div style={{ fontSize: '12.5px', color: '#4a5a6e' }}>
          No lines yet — parse a file above to extract price lines. Matching against P21 comes in a later phase.
        </div>
      )}
    </div>
  )
}

const LINE_GRID = '1.2fr 1.8fr 90px 90px 70px 100px 96px'

function btnPrimary(busy) {
  return {
    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
    backgroundColor: busy ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
    cursor: busy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
  }
}
const btnGhost = {
  padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '500',
  backgroundColor: '#1e2a3a', color: '#60a5fa', border: '1px solid #1e40af', cursor: 'pointer', whiteSpace: 'nowrap',
}
const btnGhostLink = { ...btnGhost, textDecoration: 'none', display: 'inline-block' }
