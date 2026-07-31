'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import {
  BATCH_STATUS_META, SOURCE_META, MATCH_META, FLAG_META,
  formatCurrency, formatDate, formatPct, relativeTime,
  costChangePct, computeFlag,
} from '../../../../lib/priceupdates'
import { fetchParsedSheets, applyParse, triggerMatch } from '../../../../lib/priceupdatesParse'

const SPREADSHEET = /\.(xlsx|xls|csv)$/i
const PAGE_SIZE = 100

// Phase 4: two-pane review & approval screen (Help Desk ticket style).
// Left = the editable line grid (tabs, server-side pagination — batches run to
// tens of thousands of lines, never load them all). Right = properties sidebar
// (vendor, status, counts, files + parse actions, timeline, Approve).
// Editing locks once the batch is approved.
const TABS = [
  { key: 'all',       label: 'All' },
  { key: 'flagged',   label: 'Flagged' },
  { key: 'ambiguous', label: 'Ambiguous' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'excluded',  label: 'Excluded' },
]

// Apply a tab's filter to a pu_lines query. Flagged = guardrail hits (not ok,
// not the plain "new"/unmatched marker). Ambiguous gets its own tab — it's the
// review-priority queue (blocks approval); unmatched is the auto-excluded
// not-in-P21 tail.
function tabFilter(q, tab) {
  if (tab === 'flagged') return q.not('flag', 'in', '(ok,new)')
  if (tab === 'ambiguous') return q.eq('match_status', 'ambiguous')
  if (tab === 'unmatched') return q.eq('match_status', 'unmatched')
  if (tab === 'excluded') return q.eq('include', false)
  return q
}

export default function BatchDetail() {
  const supabase = createClient()
  const { id } = useParams()
  const { user } = useRole()

  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [profiles, setProfiles] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState('all')
  const [page, setPage] = useState(0)
  const [lines, setLines] = useState([])
  const [tabTotal, setTabTotal] = useState(0)
  const [counts, setCounts] = useState({ all: 0, flagged: 0, ambiguous: 0, unmatched: 0, excluded: 0, ambiguousIncluded: 0 })

  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)          // { lineId, field, value }
  const [searchLine, setSearchLine] = useState(null)    // line being item-searched
  const [busyFile, setBusyFile] = useState(null)
  const [matching, setMatching] = useState(false)
  const [approving, setApproving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const editable = batch && ['received', 'parsing', 'needs_review', 'failed'].includes(batch.status)

  async function loadBatch() {
    const { data: b } = await supabase
      .from('pu_batches')
      .select('*, vendor:vendor_id(id, name, p21_supplier_id, p21_item_prefix), approver:approved_by(full_name, email), applier:applied_by(full_name, email)')
      .eq('id', id).single()
    setBatch(b)
    const { data: f } = await supabase
      .from('pu_batch_files')
      .select('id, file_name, file_size, storage_path, parse_status, parsed_rows, parse_profile_id, error, created_at')
      .eq('batch_id', id).order('created_at')
    setFiles(f || [])
    if (b?.vendor_id) {
      const { data: p } = await supabase
        .from('pu_parse_profiles').select('id, label, config, created_at')
        .eq('vendor_id', b.vendor_id).order('created_at', { ascending: false })
      setProfiles(p || [])
    } else setProfiles([])
    if (!settings) {
      const { data: s } = await supabase.from('pu_settings').select('*').eq('id', 1).single()
      setSettings(s || {})
    }
    setLoading(false)
    return b
  }

  // Tab counts + the approve gate (ambiguous lines still included).
  async function loadCounts() {
    const head = { count: 'exact', head: true }
    const base = () => supabase.from('pu_lines').select('id', head).eq('batch_id', id)
    const [all, flagged, ambiguous, unmatched, excluded, amb] = await Promise.all([
      base(),
      tabFilter(base(), 'flagged'),
      tabFilter(base(), 'ambiguous'),
      tabFilter(base(), 'unmatched'),
      tabFilter(base(), 'excluded'),
      base().eq('include', true).eq('match_status', 'ambiguous'),
    ])
    setCounts({
      all: all.count || 0,
      flagged: flagged.count || 0,
      ambiguous: ambiguous.count || 0,
      unmatched: unmatched.count || 0,
      excluded: excluded.count || 0,
      ambiguousIncluded: amb.count || 0,
    })
  }

  async function loadLines(nextTab = tab, nextPage = page) {
    const from = nextPage * PAGE_SIZE
    let q = supabase
      .from('pu_lines')
      .select('id, row_number, vendor_item_no, description, uom, old_cost, old_list, new_cost, new_list, cost_change_pct, match_status, flag, include, p21_item_id', { count: 'exact' })
      .eq('batch_id', id)
    q = tabFilter(q, nextTab).order('row_number').range(from, from + PAGE_SIZE - 1)
    const { data, count } = await q
    setLines(data || [])
    setTabTotal(count || 0)
  }

  useEffect(() => { loadBatch(); loadCounts() }, [id])           // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadLines(tab, page) }, [id, tab, page])     // eslint-disable-line react-hooks/exhaustive-deps

  function switchTab(t) {
    setTab(t); setPage(0); setSelected(new Set()); setEditing(null)
  }

  // Keep the batch's stored matched/flagged counts in sync after edits so the
  // queue pills stay honest. (Derived from the same definitions as the tabs.)
  async function refreshBatchCounts() {
    const head = { count: 'exact', head: true }
    const base = () => supabase.from('pu_lines').select('id', head).eq('batch_id', id)
    const [m, f] = await Promise.all([
      base().eq('match_status', 'matched'),
      tabFilter(base(), 'flagged'),
    ])
    await supabase.from('pu_batches').update({
      matched_count: m.count || 0, flagged_count: f.count || 0,
    }).eq('id', id)
    setBatch(b => b ? { ...b, matched_count: m.count || 0, flagged_count: f.count || 0 } : b)
  }

  // ---- line mutations -------------------------------------------------------

  function patchLocal(lineId, patch) {
    setLines(ls => ls.map(l => (l.id === lineId ? { ...l, ...patch } : l)))
  }

  // Recompute Δ% + flag for a line after a cost/list/match edit.
  function derive(line) {
    const pct = costChangePct(line.old_cost, line.new_cost)
    let flag = line.flag
    if (line.match_status === 'matched') flag = computeFlag(line, settings || {})
    else if (line.match_status === 'ambiguous') flag = 'review'
    else flag = 'new'
    return { cost_change_pct: pct, flag }
  }

  async function saveEdit(lineId, field, value) {
    setEditing(null)
    const line = lines.find(l => l.id === lineId)
    if (!line) return
    const num = value === '' ? null : Number(value)
    if (value !== '' && isNaN(num)) return setError('Not a number.')
    if (num === (line[field] === null ? null : Number(line[field]))) return
    const next = { ...line, [field]: num }
    const derived = derive(next)
    const patch = { [field]: num, ...derived }
    patchLocal(lineId, patch)
    const { error: e } = await supabase.from('pu_lines').update(patch).eq('id', lineId)
    if (e) { setError(`Save failed: ${e.message}`); return loadLines() }
    refreshBatchCounts(); loadCounts()
  }

  async function setInclude(ids, include) {
    const { error: e } = await supabase.from('pu_lines').update({ include }).in('id', ids)
    if (e) return setError(`Update failed: ${e.message}`)
    setLines(ls => ls.map(l => (ids.includes(l.id) ? { ...l, include } : l)))
    setSelected(new Set())
    loadCounts()
    if (tab === 'excluded') loadLines()   // rows leave this view when re-included
  }

  // Apply a picked mirror item to a line (the fix-an-unmatched-line flow).
  // Matching a line re-includes it; clearing back to unmatched auto-excludes it
  // (same defaults the match route applies).
  async function applyMatch(line, mirrorRow) {
    const next = {
      ...line,
      p21_item_id: mirrorRow ? mirrorRow.p21_item_id : null,
      old_cost: mirrorRow ? mirrorRow.current_cost : null,
      old_list: mirrorRow ? mirrorRow.current_list : null,
      match_status: mirrorRow ? 'matched' : 'unmatched',
    }
    const derived = derive(next)
    const patch = {
      p21_item_id: next.p21_item_id, old_cost: next.old_cost, old_list: next.old_list,
      match_status: next.match_status, include: !!mirrorRow, ...derived,
    }
    setSearchLine(null)
    patchLocal(line.id, patch)
    const { error: e } = await supabase.from('pu_lines').update(patch).eq('id', line.id)
    if (e) { setError(`Save failed: ${e.message}`); return loadLines() }
    refreshBatchCounts(); loadCounts()
  }

  // ---- approve --------------------------------------------------------------

  async function approve() {
    setError(''); setNotice('')
    setApproving(true)
    try {
      // Re-verify the gate server-side at click time, not from stale state.
      const { count: amb } = await supabase
        .from('pu_lines').select('id', { count: 'exact', head: true })
        .eq('batch_id', id).eq('include', true).eq('match_status', 'ambiguous')
      if (amb > 0) {
        setError(`${amb} included line${amb === 1 ? ' is' : 's are'} still ambiguous — resolve or exclude them first.`)
        return
      }
      const head = { count: 'exact', head: true }
      const { count: included } = await supabase
        .from('pu_lines').select('id', head).eq('batch_id', id).eq('include', true)
      const stamp = new Date().toISOString()
      const who = user?.email || 'unknown'
      const activity = `[${stamp.slice(0, 16).replace('T', ' ')}] Approved by ${who} — ${included} of ${counts.all} lines included (${counts.flagged} flagged, ${counts.excluded} excluded).`
      const { error: e } = await supabase.from('pu_batches').update({
        status: 'approved',
        approved_by: user?.id || null,
        approved_at: stamp,
        reviewed_by: user?.id || null,
        notes: batch.notes ? `${batch.notes}\n${activity}` : activity,
      }).eq('id', id)
      if (e) throw e
      setNotice(`Approved — ${included} lines ready for export.`)
      setSelected(new Set()); setEditing(null)
      await loadBatch()
    } catch (e) {
      setError(`Approve failed: ${e.message}`)
    } finally {
      setApproving(false)
    }
  }

  // ---- files / parse / rematch (carried over from earlier phases) -----------

  async function downloadFile(f) {
    const { data, error: e } = await supabase.storage.from('price-files').createSignedUrl(f.storage_path, 60)
    if (e) return alert('Error: ' + e.message)
    window.open(data.signedUrl, '_blank')
  }

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
      await loadBatch(); await loadCounts(); await loadLines()
    } catch (e) {
      setError(`Auto-parse failed for ${f.file_name}: ${e.message}. Try mapping the columns manually.`)
    } finally {
      setBusyFile(null)
    }
  }

  async function rematch() {
    setError(''); setNotice('')
    setMatching(true)
    try {
      const r = await triggerMatch(supabase, id)
      const bits = [`${r.matched}/${r.total} matched`]
      if (r.ambiguous) bits.push(`${r.ambiguous} ambiguous`)
      if (r.flagged) bits.push(`${r.flagged} flagged`)
      if (r.auto_excluded) bits.push(`${r.auto_excluded} unmatched auto-excluded`)
      if (r.auto_included) bits.push(`${r.auto_included} re-included`)
      if (r.warning) bits.push(r.warning)
      else if (!r.mirror_rows) bits.push('P21 mirror is empty — sync it in Settings')
      setNotice(bits.join(' · '))
      await loadBatch(); await loadCounts(); await loadLines()
    } catch (e) {
      setError(`Matching failed: ${e.message}`)
    } finally {
      setMatching(false)
    }
  }

  // ---- render ---------------------------------------------------------------

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  if (!batch) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      Batch not found. <Link href="/priceupdates/batches" style={{ color: '#60a5fa' }}>Back to batches</Link>
    </div>
  )

  const status = BATCH_STATUS_META[batch.status] || BATCH_STATUS_META.received
  const src = SOURCE_META[batch.source] || {}
  const pageCount = Math.max(1, Math.ceil(tabTotal / PAGE_SIZE))
  const allOnPageSelected = lines.length > 0 && lines.every(l => selected.has(l.id))
  const canApprove = batch.status === 'needs_review' && counts.ambiguousIncluded === 0 && counts.all > 0

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <Link href="/priceupdates/batches" style={{ fontSize: '12.5px', color: '#5a6e84', textDecoration: 'none' }}>← Batches</Link>
          <h1 style={{ fontSize: '19px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>Batch #{batch.number}</h1>
          <span style={{ fontSize: '13px', color: '#5a6e84' }}>{batch.vendor?.name || 'Unidentified vendor'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {counts.all > 0 && editable && (
            <button onClick={rematch} disabled={matching} style={{
              padding: '6px 13px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
              backgroundColor: matching ? '#1a2433' : '#131a24', color: matching ? '#5a6e84' : '#60a5fa',
              border: '1px solid #1e3a5f', cursor: matching ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}>{matching ? 'Matching…' : '↻ Re-run matching'}</button>
          )}
          <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '600', backgroundColor: status.pillBg, color: status.pillText }}>
            {status.label}
          </span>
        </div>
      </div>

      {notice && <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '10px', fontSize: '12.5px', backgroundColor: '#13202e', color: '#7fb4f5', border: '1px solid #1e3a5f', flexShrink: 0 }}>{notice}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '10px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b', flexShrink: 0 }}>{error}</div>}

      {/* Two panes */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flex: 1, minHeight: 0 }}>

        {/* LEFT — line grid */}
        <div style={{ flex: 1, minWidth: 0, backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 140px)' }}>
          {/* Tabs + bulk actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #182030', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              {TABS.map(t => {
                const active = tab === t.key
                return (
                  <button key={t.key} onClick={() => switchTab(t.key)} style={{
                    padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', border: 'none',
                    backgroundColor: active ? '#1e2a3a' : 'transparent', color: active ? '#e0e7f0' : '#5a6e84', cursor: 'pointer',
                  }}>
                    {t.label} <span style={{ color: active ? '#8aa0b8' : '#3d4c60' }}>{(counts[t.key] ?? 0).toLocaleString()}</span>
                  </button>
                )
              })}
            </div>
            {editable && selected.size > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#8aa0b8' }}>{selected.size} selected</span>
                <button onClick={() => setInclude([...selected], true)} style={miniBtn('#0d3320', '#4ade80')}>Include</button>
                <button onClick={() => setInclude([...selected], false)} style={miniBtn('#330d0d', '#f87171')}>Exclude</button>
              </div>
            )}
          </div>

          {/* Grid header */}
          <div style={{ overflowX: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ minWidth: '1060px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: LINE_GRID, gap: '8px', padding: '8px 14px', borderBottom: '1px solid #182030', fontSize: '10.5px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', alignItems: 'center', flexShrink: 0 }}>
                <div>
                  {editable && (
                    <input type="checkbox" checked={allOnPageSelected} onChange={() => {
                      setSelected(s => {
                        const n = new Set(s)
                        if (allOnPageSelected) lines.forEach(l => n.delete(l.id))
                        else lines.forEach(l => n.add(l.id))
                        return n
                      })
                    }} style={{ cursor: 'pointer' }} />
                  )}
                </div>
                <div>Item #</div><div>Description</div>
                <div style={{ textAlign: 'right' }}>Old cost</div>
                <div style={{ textAlign: 'right' }}>New cost</div>
                <div style={{ textAlign: 'right' }}>New list</div>
                <div style={{ textAlign: 'right' }}>Δ%</div>
                <div>Flag</div><div>Match</div><div>P21 item</div><div>Incl</div>
              </div>

              {/* Rows */}
              <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {lines.length === 0 && (
                  <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: '#4a5a6e' }}>
                    {counts.all === 0 ? 'No lines yet — parse a file (sidebar) to extract price lines.' : 'Nothing in this view.'}
                  </div>
                )}
                {lines.map(l => {
                  const m = MATCH_META[l.match_status] || MATCH_META.unmatched
                  const fl = FLAG_META[l.flag] || FLAG_META.review
                  const up = l.cost_change_pct != null && l.cost_change_pct > 0
                  const down = l.cost_change_pct != null && l.cost_change_pct < 0
                  const dim = !l.include
                  return (
                    <div key={l.id} style={{
                      display: 'grid', gridTemplateColumns: LINE_GRID, gap: '8px', padding: '6px 14px',
                      borderBottom: '1px solid #131c28', alignItems: 'center', fontSize: '12.5px',
                      opacity: dim ? 0.45 : 1, backgroundColor: selected.has(l.id) ? '#131e2d' : 'transparent',
                    }}>
                      <div>
                        {editable && (
                          <input type="checkbox" checked={selected.has(l.id)} onChange={() => {
                            setSelected(s => {
                              const n = new Set(s)
                              if (n.has(l.id)) n.delete(l.id)
                              else n.add(l.id)
                              return n
                            })
                          }} style={{ cursor: 'pointer' }} />
                        )}
                      </div>
                      <div style={{ color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.vendor_item_no || ''}>{l.vendor_item_no || '—'}</div>
                      <div style={{ color: '#8aa0b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description || ''}>{l.description || '—'}</div>
                      <div style={{ color: '#8aa0b8', textAlign: 'right' }}>{formatCurrency(l.old_cost)}</div>
                      <EditableNum line={l} field="new_cost" editing={editing} setEditing={setEditing} save={saveEdit} editable={editable} />
                      <EditableNum line={l} field="new_list" editing={editing} setEditing={setEditing} save={saveEdit} editable={editable} />
                      <div style={{ textAlign: 'right', color: up ? '#f87171' : down ? '#fbbf24' : '#5a6e84', fontWeight: up || down ? '600' : '400' }}>
                        {l.cost_change_pct != null ? formatPct(l.cost_change_pct) : '—'}
                      </div>
                      <div title={fl.label} style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: fl.dot }} />
                      </div>
                      <div>
                        <span style={{ padding: '2px 7px', borderRadius: '999px', fontSize: '10px', fontWeight: '600', backgroundColor: m.pillBg, color: m.pillText }}>{m.label}</span>
                      </div>
                      <div
                        onClick={() => { if (editable) { setSearchLine(l); setError('') } }}
                        title={l.p21_item_id || (editable ? 'Click to search P21 items' : '')}
                        style={{
                          color: l.p21_item_id ? '#d0d8e4' : '#3d4c60', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          cursor: editable ? 'pointer' : 'default', textDecoration: editable ? 'underline dotted #2a3a50' : 'none', textUnderlineOffset: '3px',
                        }}
                      >{l.p21_item_id || (editable ? 'search…' : '—')}</div>
                      <div>
                        <input type="checkbox" checked={!!l.include} disabled={!editable}
                          onChange={() => setInclude([l.id], !l.include)}
                          style={{ cursor: editable ? 'pointer' : 'default' }} />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pager */}
              {tabTotal > PAGE_SIZE && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid #182030', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: '#5a6e84' }}>
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, tabTotal)} of {tabTotal.toLocaleString()}
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pagerBtn(page === 0)}>← Prev</button>
                    <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} style={pagerBtn(page >= pageCount - 1)}>Next →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — properties sidebar */}
        <div style={{ width: '290px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Primary action */}
          {batch.status === 'needs_review' && (
            <button onClick={approve} disabled={!canApprove || approving} title={
              counts.ambiguousIncluded > 0 ? `${counts.ambiguousIncluded} included ambiguous line(s) must be resolved or excluded` : ''
            } style={{
              padding: '11px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '700', border: 'none',
              backgroundColor: canApprove && !approving ? '#16a34a' : '#1a2433',
              color: canApprove && !approving ? '#fff' : '#5a6e84',
              cursor: canApprove && !approving ? 'pointer' : 'not-allowed',
            }}>
              {approving ? 'Approving…' : counts.ambiguousIncluded > 0 ? `Resolve ${counts.ambiguousIncluded} ambiguous to approve` : `✓ Approve batch (${counts.all - counts.excluded} lines)`}
            </button>
          )}
          {batch.status === 'approved' && (
            <div style={{ padding: '11px', borderRadius: '10px', fontSize: '12.5px', textAlign: 'center', backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #14532d' }}>
              Approved — export lands in Phase 5
            </div>
          )}

          {/* Properties */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '16px' }}>
            <SideRow label="Vendor" value={batch.vendor?.name || 'Unidentified'} />
            <SideRow label="Source" value={`${src.icon ? src.icon + ' ' : ''}${src.label || batch.source}`} />
            <SideRow label="Effective date" value={formatDate(batch.effective_date)} />
            <SideRow label="Received" value={`${formatDate(batch.received_at)} (${relativeTime(batch.received_at)})`} />
            <SideRow label="Lines" value={`${counts.all.toLocaleString()} · ${(batch.matched_count || 0).toLocaleString()} matched`} />
            <SideRow label="Flagged / Excluded" value={`${counts.flagged.toLocaleString()} / ${counts.excluded.toLocaleString()}`} last />
          </div>

          {/* Files */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Files ({files.length})</div>
            {files.length === 0 && <div style={{ fontSize: '12px', color: '#4a5a6e' }}>No files attached.</div>}
            {files.map(f => {
              const isSheet = SPREADSHEET.test(f.file_name)
              const parsed = f.parse_status === 'parsed'
              const busy = busyFile === f.id
              return (
                <div key={f.id} style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file_name}>{f.file_name}</div>
                  <div style={{ fontSize: '11px', color: parsed ? '#4ade80' : '#5a6e84', margin: '2px 0 5px' }}>
                    {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB · ` : ''}
                    {parsed ? `parsed · ${f.parsed_rows} lines` : f.parse_status}
                    {f.error ? ` · ${f.error}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {isSheet && !parsed && profiles.length > 0 && editable && (
                      <button onClick={() => autoParse(f)} disabled={busy} style={miniBtn('#2563eb', '#fff', busy)}>
                        {busy ? 'Parsing…' : 'Auto-parse'}
                      </button>
                    )}
                    {isSheet && editable && (
                      <Link href={`/priceupdates/batches/${id}/map?file=${f.id}`} style={{ ...miniBtn('#1e2a3a', '#60a5fa'), textDecoration: 'none', display: 'inline-block' }}>
                        {parsed ? 'Re-map' : 'Map columns'}
                      </Link>
                    )}
                    <button onClick={() => downloadFile(f)} style={miniBtn('#1e2a3a', '#8aa0b8')}>Download</button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Timeline */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Timeline</div>
            <TimelineStep done label="Received" detail={formatDate(batch.received_at)} />
            <TimelineStep done={counts.all > 0} label="Parsed" detail={counts.all > 0 ? `${counts.all.toLocaleString()} lines` : 'pending'} />
            <TimelineStep done={!!batch.approved_at} label="Approved" detail={batch.approved_at ? `${formatDate(batch.approved_at)} · ${batch.approver?.full_name || batch.approver?.email || ''}` : 'pending'} />
            <TimelineStep done={!!batch.exported_at} label="Exported" detail={batch.exported_at ? formatDate(batch.exported_at) : 'Phase 5'} />
            <TimelineStep done={!!batch.applied_at} label="Applied in P21" detail={batch.applied_at ? `${formatDate(batch.applied_at)} · ${batch.applier?.full_name || batch.applier?.email || ''}` : 'Phase 5'} last />
          </div>

          {batch.notes && (
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '8px' }}>Activity / notes</div>
              <div style={{ fontSize: '11.5px', color: '#8aa0b8', whiteSpace: 'pre-wrap', maxHeight: '160px', overflowY: 'auto' }}>{batch.notes}</div>
            </div>
          )}
        </div>
      </div>

      {searchLine && (
        <ItemSearchModal
          supabase={supabase}
          line={searchLine}
          supplierId={batch.vendor?.p21_supplier_id}
          onPick={(row) => applyMatch(searchLine, row)}
          onClear={() => applyMatch(searchLine, null)}
          onClose={() => setSearchLine(null)}
        />
      )}
    </div>
  )
}

// ---- editable numeric cell --------------------------------------------------

function EditableNum({ line, field, editing, setEditing, save, editable }) {
  const active = editing && editing.lineId === line.id && editing.field === field
  if (active) {
    return (
      <NumInput
        initial={line[field] ?? ''}
        onCommit={v => save(line.id, field, v)}
        onCancel={() => setEditing(null)}
      />
    )
  }
  const v = line[field]
  return (
    <div
      onClick={() => { if (editable) setEditing({ lineId: line.id, field }) }}
      title={editable ? 'Click to edit' : ''}
      style={{
        textAlign: 'right', color: field === 'new_cost' ? '#c0cad8' : '#8aa0b8',
        cursor: editable ? 'pointer' : 'default',
        textDecoration: editable ? 'underline dotted #2a3a50' : 'none', textUnderlineOffset: '3px',
      }}
    >{formatCurrency(v)}</div>
  )
}

// Commits exactly once (Enter or blur, whichever comes first; Esc cancels).
function NumInput({ initial, onCommit, onCancel }) {
  const [val, setVal] = useState(String(initial))
  const done = useRef(false)
  const commit = () => {
    if (done.current) return
    done.current = true
    onCommit(val.trim())
  }
  return (
    <input
      autoFocus
      type="number"
      step="0.0001"
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { done.current = true; onCancel() }
      }}
      onBlur={commit}
      style={{
        width: '100%', padding: '3px 6px', borderRadius: '6px', fontSize: '12.5px', textAlign: 'right',
        backgroundColor: '#0a0f16', color: '#e0e7f0', border: '1px solid #2563eb', outline: 'none',
      }}
    />
  )
}

// ---- P21 item search modal (mirror-backed, supplier-scoped) -----------------

function ItemSearchModal({ supabase, line, supplierId, onPick, onClear, onClose }) {
  const [q, setQ] = useState(line.vendor_item_no || '')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const term = q.trim()
      if (!term) return setResults([])
      setSearching(true)
      let query = supabase
        .from('p21_item_mirror')
        .select('p21_item_id, supplier_id, supplier_part_no, item_desc, uom, current_cost, current_list')
        .or(`p21_item_id.ilike.%${term}%,supplier_part_no.ilike.%${term}%`)
        .limit(15)
      if (supplierId) query = query.eq('supplier_id', String(supplierId).trim())
      const { data } = await query
      setResults(data || [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q, supplierId, supabase])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(4,8,14,0.7)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '620px', maxWidth: '92vw', backgroundColor: '#0f1620', border: '1px solid #23304a',
        borderRadius: '14px', overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #182030' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#e0e7f0', marginBottom: '2px' }}>
            Match line to P21 item
          </div>
          <div style={{ fontSize: '11.5px', color: '#5a6e84' }}>
            Line: {line.vendor_item_no || '(no item #)'} {line.description ? `· ${line.description}` : ''}
            {supplierId ? ` · searching supplier ${supplierId}` : ' · searching all suppliers'}
          </div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search P21 item id or supplier part #…"
            style={{
              width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
              backgroundColor: '#0a0f16', color: '#e0e7f0', border: '1px solid #23304a', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {searching && <div style={{ padding: '14px 16px', fontSize: '12.5px', color: '#5a6e84' }}>Searching…</div>}
          {!searching && q.trim() && results.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: '12.5px', color: '#5a6e84' }}>No mirror items match.</div>
          )}
          {results.map(r => (
            <div key={`${r.p21_item_id}|${r.supplier_id}`} onClick={() => onPick(r)} style={{
              padding: '9px 16px', borderBottom: '1px solid #131c28', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center',
            }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#131e2d' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: '#d0d8e4' }}>{r.p21_item_id}</div>
                <div style={{ fontSize: '11px', color: '#5a6e84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.supplier_part_no ? `part ${r.supplier_part_no} · ` : ''}{r.item_desc || ''}{r.uom ? ` · ${r.uom}` : ''}
                </div>
              </div>
              <div style={{ fontSize: '11.5px', color: '#8aa0b8', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {formatCurrency(r.current_cost)}<br />
                <span style={{ color: '#5a6e84' }}>list {formatCurrency(r.current_list)}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #182030' }}>
          {line.p21_item_id
            ? <button onClick={onClear} style={miniBtn('#330d0d', '#f87171')}>Clear match</button>
            : <span />}
          <button onClick={onClose} style={miniBtn('#1e2a3a', '#8aa0b8')}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ---- small shared bits ------------------------------------------------------

function SideRow({ label, value, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : '11px' }}>
      <div style={{ fontSize: '10.5px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '12.5px', color: '#c0cad8' }}>{value}</div>
    </div>
  )
}

function TimelineStep({ done, label, detail, last }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginBottom: last ? 0 : '10px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: done ? '#22c55e' : '#2a3a50', marginTop: '3px', flexShrink: 0 }} />
        {!last && <span style={{ width: '1px', flex: 1, backgroundColor: '#1a2433', marginTop: '3px' }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : '2px' }}>
        <div style={{ fontSize: '12px', color: done ? '#c0cad8' : '#5a6e84', fontWeight: done ? '600' : '400' }}>{label}</div>
        <div style={{ fontSize: '11px', color: '#5a6e84' }}>{detail}</div>
      </div>
    </div>
  )
}

const LINE_GRID = '26px 1.05fr 1.35fr 82px 90px 90px 60px 34px 86px 1.05fr 40px'

function miniBtn(bg, color, busy) {
  return {
    padding: '4px 11px', borderRadius: '7px', fontSize: '11.5px', fontWeight: '600',
    backgroundColor: bg, color, border: 'none', cursor: busy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
    opacity: busy ? 0.6 : 1,
  }
}

function pagerBtn(disabled) {
  return {
    padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: '600',
    backgroundColor: disabled ? '#131a24' : '#1e2a3a', color: disabled ? '#3d4c60' : '#8aa0b8',
    border: '1px solid #182030', cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
