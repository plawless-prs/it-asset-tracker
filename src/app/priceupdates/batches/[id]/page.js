'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import {
  BATCH_STATUS_META, SOURCE_META, MATCH_META, FLAG_META,
  formatCurrency, formatDate, formatPct, relativeTime,
  costChangePct, computeFlag, normalizePart,
} from '../../../../lib/priceupdates'
import { fetchParsedSheets, applyParse, triggerMatch, generateExport, uploadBatchFiles } from '../../../../lib/priceupdatesParse'
import { useToasts, Toasts } from '../../../../components/Toast'
import VendorModal from '../../../../components/VendorModal'

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

// Apply a tab's filter to a pu_lines query. Flagged = MATCHED lines with
// guardrail hits only — auto-picked ambiguous lines live solely in the
// Ambiguous tab (their pick is skimmed there, guardrail flag and all), never
// mixed into Flagged. Unmatched is the auto-excluded not-in-P21 tail.
function tabFilter(q, tab) {
  if (tab === 'flagged') return q.eq('match_status', 'matched').not('flag', 'in', '(ok,new)')
  if (tab === 'ambiguous') return q.eq('match_status', 'ambiguous')
  if (tab === 'unmatched') return q.eq('match_status', 'unmatched')
  if (tab === 'excluded') return q.eq('include', false)
  return q
}

export default function BatchDetail() {
  const supabase = createClient()
  const { id } = useParams()
  const router = useRouter()
  const { user } = useRole()

  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [exports, setExports] = useState([])
  const [profiles, setProfiles] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  const [tab, setTab] = useState('all')
  const [page, setPage] = useState(0)
  const [lines, setLines] = useState([])
  const [tabTotal, setTabTotal] = useState(0)
  const [counts, setCounts] = useState({ all: 0, flagged: 0, ambiguous: 0, unmatched: 0, excluded: 0, ambiguousUnpicked: 0 })

  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null)          // { lineId, field, value }
  const [searchLine, setSearchLine] = useState(null)    // line being item-searched
  const [busyFile, setBusyFile] = useState(null)
  const [matching, setMatching] = useState(false)
  const [approving, setApproving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [applying, setApplying] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { toasts, toast } = useToasts()
  const [mirrorSyncedAt, setMirrorSyncedAt] = useState(null)
  const [libraryFiles, setLibraryFiles] = useState([])

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
    const { data: ex } = await supabase
      .from('pu_exports')
      .select('id, file_name, storage_path, row_count, created_at, creator:created_by(full_name, email)')
      .eq('batch_id', id).order('created_at', { ascending: false })
    setExports(ex || [])
    const { data: lib } = await supabase
      .from('pu_library_files')
      .select('id, file_name, storage_path, year, created_at')
      .eq('batch_id', id).order('created_at', { ascending: false })
    setLibraryFiles(lib || [])
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
    // How fresh is the mirror for this batch's supplier? (Batch creation
    // queues a supplier-scoped sync on the on-prem worker; this shows whether
    // it has landed.)
    if (b?.vendor?.p21_supplier_id) {
      const { data: m } = await supabase
        .from('p21_item_mirror').select('last_synced_at')
        .eq('supplier_id', String(b.vendor.p21_supplier_id))
        .order('last_synced_at', { ascending: false }).limit(1)
      setMirrorSyncedAt(m?.[0]?.last_synced_at || null)
    } else setMirrorSyncedAt(null)
    setLoading(false)
    return b
  }

  // Tab counts + the approve gate. Auto-picked ambiguous lines don't block
  // approval (approving confirms their pick); only an included ambiguous line
  // with NO pick at all still gates.
  async function loadCounts() {
    const head = { count: 'exact', head: true }
    const base = () => supabase.from('pu_lines').select('id', head).eq('batch_id', id)
    const [all, flagged, ambiguous, unmatched, excluded, amb] = await Promise.all([
      base(),
      tabFilter(base(), 'flagged'),
      tabFilter(base(), 'ambiguous'),
      tabFilter(base(), 'unmatched'),
      tabFilter(base(), 'excluded'),
      base().eq('include', true).eq('match_status', 'ambiguous').is('p21_item_id', null),
    ])
    setCounts({
      all: all.count || 0,
      flagged: flagged.count || 0,
      ambiguous: ambiguous.count || 0,
      unmatched: unmatched.count || 0,
      excluded: excluded.count || 0,
      ambiguousUnpicked: amb.count || 0,
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
    // matched_count = every line carrying a pick (incl. auto-picked ambiguous),
    // same definition as the match route.
    const [m, f] = await Promise.all([
      base().not('p21_item_id', 'is', null),
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

  // Recompute Δ% + flag for a line after a cost/list/match edit. An ambiguous
  // line with an auto-pick carries real guardrail flags like a matched line.
  function derive(line) {
    const pct = costChangePct(line.old_cost, line.new_cost)
    let flag = line.flag
    if (line.match_status === 'matched' || (line.match_status === 'ambiguous' && line.p21_item_id)) {
      flag = computeFlag(line, settings || {})
    } else if (line.match_status === 'ambiguous') flag = 'review'
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

  // Remember (or forget) a manual resolution in pu_item_aliases so the next
  // batch from this vendor matches the same part the same way automatically.
  async function saveAlias(vendorItemNo, p21ItemId) {
    const vendorId = batch.vendor?.id
    const key = normalizePart(vendorItemNo)
    if (!vendorId || !key) return
    if (p21ItemId) {
      await supabase.from('pu_item_aliases').upsert(
        { vendor_id: vendorId, normalized_part: key, p21_item_id: p21ItemId, source: 'manual', created_by: user?.id || null, updated_at: new Date().toISOString() },
        { onConflict: 'vendor_id,normalized_part' },
      )
    } else {
      await supabase.from('pu_item_aliases').delete().eq('vendor_id', vendorId).eq('normalized_part', key)
    }
  }

  // Apply a picked mirror item to a line (the fix-an-unmatched-line flow).
  // Matching a line re-includes it; clearing back to unmatched auto-excludes it
  // (same defaults the match route applies). The pick is remembered for the
  // vendor's next batch; clearing forgets it.
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
    saveAlias(line.vendor_item_no, next.p21_item_id)
    refreshBatchCounts(); loadCounts()
  }

  // ---- approve --------------------------------------------------------------

  async function approve() {
    setError(''); setNotice('')
    setApproving(true)
    try {
      // Re-verify the gate server-side at click time, not from stale state.
      // Only included ambiguous lines with NO pick block — auto-picked ones are
      // confirmed by this very approval.
      const { count: unpicked } = await supabase
        .from('pu_lines').select('id', { count: 'exact', head: true })
        .eq('batch_id', id).eq('include', true).eq('match_status', 'ambiguous').is('p21_item_id', null)
      if (unpicked > 0) {
        setError(`${unpicked} included ambiguous line${unpicked === 1 ? ' has' : 's have'} no pick — resolve or exclude them first.`)
        return
      }

      // Confirm the included auto-picks: remember each in pu_item_aliases (so
      // the vendor's next batch matches them automatically) and promote the
      // lines to matched so they export.
      let confirmed = 0
      if (batch.vendor?.id) {
        const PAGE = 1000
        const picked = []
        for (let from = 0; ; from += PAGE) {
          const { data: rows, error: pErr } = await supabase
            .from('pu_lines').select('id, vendor_item_no, p21_item_id')
            .eq('batch_id', id).eq('include', true).eq('match_status', 'ambiguous').not('p21_item_id', 'is', null)
            .order('id').range(from, from + PAGE - 1)
          if (pErr) throw pErr
          picked.push(...(rows || []))
          if (!rows || rows.length < PAGE) break
        }
        confirmed = picked.length
        const seen = new Set()
        const aliasRows = []
        for (const l of picked) {
          const key = normalizePart(l.vendor_item_no)
          if (!key || seen.has(key)) continue
          seen.add(key)
          aliasRows.push({ vendor_id: batch.vendor.id, normalized_part: key, p21_item_id: l.p21_item_id, source: 'review', created_by: user?.id || null, updated_at: new Date().toISOString() })
        }
        for (let i = 0; i < aliasRows.length; i += 500) {
          const { error: aErr } = await supabase.from('pu_item_aliases')
            .upsert(aliasRows.slice(i, i + 500), { onConflict: 'vendor_id,normalized_part' })
          if (aErr) throw aErr
        }
        if (confirmed > 0) {
          const { error: mErr } = await supabase.from('pu_lines')
            .update({ match_status: 'matched' })
            .eq('batch_id', id).eq('include', true).eq('match_status', 'ambiguous').not('p21_item_id', 'is', null)
          if (mErr) throw mErr
        }
      }

      const head = { count: 'exact', head: true }
      const { count: included } = await supabase
        .from('pu_lines').select('id', head).eq('batch_id', id).eq('include', true)
      const stamp = new Date().toISOString()
      const who = user?.email || 'unknown'
      const confirmedBit = confirmed > 0 ? `, ${confirmed} auto-picked match${confirmed === 1 ? '' : 'es'} confirmed` : ''
      const activity = `[${stamp.slice(0, 16).replace('T', ' ')}] Approved by ${who} — ${included} of ${counts.all} lines included (${counts.flagged} flagged, ${counts.excluded} excluded${confirmedBit}).`
      const { error: e } = await supabase.from('pu_batches').update({
        status: 'approved',
        approved_by: user?.id || null,
        approved_at: stamp,
        reviewed_by: user?.id || null,
        notes: batch.notes ? `${batch.notes}\n${activity}` : activity,
      }).eq('id', id)
      if (e) throw e
      toast(`Approved — ${included} lines ready for export${confirmedBit ? ` (${confirmed} auto-picks confirmed & remembered)` : ''}.`)
      setSelected(new Set()); setEditing(null)
      await loadBatch(); await loadCounts(); await loadLines()
    } catch (e) {
      setError(`Approve failed: ${e.message}`)
    } finally {
      setApproving(false)
    }
  }

  // ---- export / applied (Phase 5) -------------------------------------------

  // Appends an activity line to the batch's notes alongside a field update.
  function withActivity(patch, text) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const activity = `[${stamp}] ${text}`
    return { ...patch, notes: batch.notes ? `${batch.notes}\n${activity}` : activity }
  }

  async function doExport() {
    setError(''); setNotice('')
    setExporting(true)
    try {
      const r = await generateExport(supabase, id)
      if (r.signedUrl) window.open(r.signedUrl, '_blank')
      toast(`Export generated — ${r.file_name}, ${r.row_count.toLocaleString()} lines. Load it into P21's import tool, then mark the batch applied.`)
      await loadBatch()
    } catch (e) {
      setError(`Export failed: ${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  async function downloadExport(exp) {
    const { data, error: e } = await supabase.storage
      .from('price-files').createSignedUrl(exp.storage_path, 60, { download: exp.file_name })
    if (e) return setError(`Download failed: ${e.message}`)
    window.open(data.signedUrl, '_blank')
  }

  async function markApplied() {
    setError(''); setNotice('')
    setApplying(true)
    try {
      const who = user?.email || 'unknown'
      const { error: e } = await supabase.from('pu_batches').update(withActivity({
        status: 'applied',
        applied_at: new Date().toISOString(),
        applied_by: user?.id || null,
      }, `Marked applied in P21 by ${who}.`)).eq('id', id)
      if (e) throw e
      toast('Batch marked applied — the loop is closed.')
      await loadBatch()
    } catch (e) {
      setError(`Update failed: ${e.message}`)
    } finally {
      setApplying(false)
    }
  }

  async function archiveBatch() {
    setError(''); setNotice('')
    const { error: e } = await supabase.from('pu_batches').update(withActivity(
      { status: 'archived' }, `Archived by ${user?.email || 'unknown'}.`
    )).eq('id', id)
    if (e) return setError(`Archive failed: ${e.message}`)
    toast('Batch archived.')
    await loadBatch()
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

  // Vendor assignment/correction — email-intake batches can arrive
  // Unidentified (unknown sender domain) or with an inferred vendor guess.
  // Changing the vendor queues a scoped mirror sync and re-runs matching so
  // lines resolve against the right supplier.
  const [vendorEdit, setVendorEdit] = useState(false)
  const [newVendorOpen, setNewVendorOpen] = useState(false)
  const [allVendors, setAllVendors] = useState([])
  const [savingVendor, setSavingVendor] = useState(false)
  async function openVendorEdit() {
    if (allVendors.length === 0) {
      const { data } = await supabase.from('pu_vendors').select('id, name, p21_supplier_id').order('name')
      setAllVendors(data || [])
    }
    setVendorEdit(true)
  }
  // `vendorObj` covers a vendor created moments ago via "+ New vendor" that
  // isn't in the allVendors state yet.
  async function changeVendor(newId, vendorObj) {
    setSavingVendor(true); setError(''); setNotice('')
    try {
      const newVendor = vendorObj || allVendors.find(v => v.id === newId) || null
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const activity = `[${stamp}] Vendor ${newVendor ? `set to ${newVendor.name}` : 'cleared'} by ${user?.email || 'unknown'}.`
      const { error: e } = await supabase.from('pu_batches')
        .update({
          vendor_id: newId || null,
          notes: batch.notes ? `${batch.notes}\n${activity}` : activity,
        })
        .eq('id', id)
      if (e) throw e
      if (newVendor?.p21_supplier_id) {
        try {
          await supabase.from('pu_sync_requests').insert({
            supplier_id: String(newVendor.p21_supplier_id).trim(),
            reason: 'batch_created',
            requested_by: user?.id || null,
          })
        } catch { /* sync request is best-effort */ }
      }
      setVendorEdit(false)
      await loadBatch()
      if (counts.all > 0) {
        try {
          await triggerMatch(supabase, id)
          await loadBatch(); await loadCounts(); await loadLines()
          setNotice(`Vendor updated — matching re-run against ${newVendor?.name || 'no vendor'}.`)
        } catch { setNotice('Vendor updated. Re-run matching to resolve lines against the new vendor.') }
      } else {
        setNotice('Vendor updated.')
      }
    } catch (e) {
      setError(`Vendor change failed: ${e.message}`)
    } finally {
      setSavingVendor(false)
    }
  }

  // Effective-date editing — email-intake batches arrive with no date, and a
  // vendor notification can shift one. Drives the calendar, urgency pills,
  // and reminders; the export file name year; and future archive folders
  // (already-archived files keep their original folder).
  const [dateEdit, setDateEdit] = useState(false)
  const [savingDate, setSavingDate] = useState(false)
  const dateInputRef = useRef(null)
  async function saveEffectiveDate() {
    const value = dateInputRef.current?.value || ''
    setSavingDate(true); setError(''); setNotice('')
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      const activity = `[${stamp}] Effective date ${value ? `set to ${value}` : 'cleared'} by ${user?.email || 'unknown'}.`
      const { error: e } = await supabase.from('pu_batches')
        .update({
          effective_date: value || null,
          notes: batch.notes ? `${batch.notes}\n${activity}` : activity,
        })
        .eq('id', id)
      if (e) throw e
      setDateEdit(false)
      await loadBatch()
      setNotice(value ? `Effective date set to ${formatDate(value)}.` : 'Effective date cleared.')
    } catch (e) {
      setError(`Effective date change failed: ${e.message}`)
    } finally {
      setSavingDate(false)
    }
  }

  // Late file upload — a batch can be created as a scheduled placeholder
  // before the vendor releases the file ("Add files" on the Files card).
  // Same treatment as creation-time uploads: pu_batch_files rows + library
  // archive under the effective-date folder.
  const addFilesRef = useRef(null)
  const [addingFiles, setAddingFiles] = useState(false)
  async function handleAddFiles(fileList) {
    const picked = Array.from(fileList || [])
    if (picked.length === 0) return
    setAddingFiles(true); setError(''); setNotice('')
    try {
      const n = await uploadBatchFiles(supabase, {
        batchId: id,
        vendor: batch.vendor ? { id: batch.vendor.id, name: batch.vendor.name } : null,
        effectiveDate: batch.effective_date || null,
        files: picked,
        userId: user?.id,
      })
      setNotice(`Added ${n} file${n === 1 ? '' : 's'}.`)
      await loadBatch()
    } catch (e) {
      setError(`Adding files failed: ${e.message}`)
    } finally {
      setAddingFiles(false)
      if (addFilesRef.current) addFilesRef.current.value = ''
    }
  }

  // Delete a batch that shouldn't exist (wrong file uploaded, duplicate, …).
  // Only offered pre-approval (`editable` statuses). Removes: uploaded batch
  // files + any generated exports (rows cascade with the batch; storage
  // objects removed by path), and the library copies auto-archived from this
  // batch (source batch/batch_export). Manually-linked library files survive
  // (their batch_id FK just nulls out).
  const [deleting, setDeleting] = useState(false)
  async function deleteBatch() {
    const msg = `Delete batch #${batch.number}${batch.vendor ? ` (${batch.vendor.name})` : ''}?\n\n` +
      `This permanently removes its ${counts.all.toLocaleString()} parsed lines, ` +
      `${files.length} uploaded file(s), any exports, and the copies auto-archived ` +
      `to the file library. Files you linked to it manually are kept (just unlinked).`
    if (!window.confirm(msg)) return
    setDeleting(true); setError('')
    try {
      const { data: libRows } = await supabase
        .from('pu_library_files').select('id, storage_path')
        .eq('batch_id', id).in('source', ['batch', 'batch_export'])
      const paths = [
        ...files.map(f => f.storage_path),
        ...exports.map(e => e.storage_path),
        ...(libRows || []).map(l => l.storage_path),
      ].filter(Boolean)
      if (paths.length) {
        const { error: sErr } = await supabase.storage.from('price-files').remove(paths)
        if (sErr) throw sErr
      }
      if (libRows?.length) {
        const { error: lErr } = await supabase.from('pu_library_files')
          .delete().in('id', libRows.map(l => l.id))
        if (lErr) throw lErr
      }
      const { error: bErr } = await supabase.from('pu_batches').delete().eq('id', id)
      if (bErr) throw bErr
      router.push('/priceupdates/batches')
    } catch (e) {
      setError(`Delete failed: ${e.message}`)
      setDeleting(false)
    }
  }

  async function rematch() {
    setError(''); setNotice('')
    setMatching(true)
    try {
      const r = await triggerMatch(supabase, id)
      const bits = [`${r.matched}/${r.total} matched`]
      if (r.remembered) bits.push(`${r.remembered} from match memory`)
      if (r.ambiguous) bits.push(`${r.ambiguous} ambiguous (auto-picked)`)
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
  const canApprove = batch.status === 'needs_review' && counts.ambiguousUnpicked === 0 && counts.all > 0

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
          {mirrorSyncedAt && editable && (
            <span title="When this vendor's P21 mirror data was last refreshed (a sync is queued automatically when a batch is created)" style={{ fontSize: '11.5px', color: '#5a6e84', whiteSpace: 'nowrap' }}>
              P21 data synced {relativeTime(mirrorSyncedAt)}
            </span>
          )}
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
              counts.ambiguousUnpicked > 0 ? `${counts.ambiguousUnpicked} included ambiguous line(s) have no pick — resolve or exclude them` :
              counts.ambiguous > 0 ? `Approving confirms the ${counts.ambiguous} auto-picked match(es) and remembers them for this vendor's next batch` : ''
            } style={{
              padding: '11px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '700', border: 'none',
              backgroundColor: canApprove && !approving ? '#16a34a' : '#1a2433',
              color: canApprove && !approving ? '#fff' : '#5a6e84',
              cursor: canApprove && !approving ? 'pointer' : 'not-allowed',
            }}>
              {approving ? 'Approving…' : counts.ambiguousUnpicked > 0 ? `Resolve ${counts.ambiguousUnpicked} ambiguous to approve` : `✓ Approve batch (${counts.all - counts.excluded} lines)`}
            </button>
          )}
          {batch.status === 'approved' && (
            <button onClick={doExport} disabled={exporting} style={{
              padding: '11px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '700', border: 'none',
              backgroundColor: exporting ? '#1a2433' : '#6d28d9',
              color: exporting ? '#5a6e84' : '#fff',
              cursor: exporting ? 'not-allowed' : 'pointer',
            }}>{exporting ? 'Generating…' : '⬇ Generate P21 export'}</button>
          )}
          {batch.status === 'exported' && (
            <>
              <button onClick={markApplied} disabled={applying} style={{
                padding: '11px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '700', border: 'none',
                backgroundColor: applying ? '#1a2433' : '#16a34a',
                color: applying ? '#5a6e84' : '#fff',
                cursor: applying ? 'not-allowed' : 'pointer',
              }}>{applying ? 'Saving…' : '✓ Mark applied in P21'}</button>
              <button onClick={doExport} disabled={exporting} style={{
                padding: '9px', borderRadius: '10px', fontSize: '12.5px', fontWeight: '600',
                backgroundColor: '#131a24', color: exporting ? '#5a6e84' : '#a78bfa',
                border: '1px solid #2a2a4a', cursor: exporting ? 'not-allowed' : 'pointer',
              }}>{exporting ? 'Generating…' : '↻ Regenerate export'}</button>
            </>
          )}
          {batch.status === 'applied' && (
            <>
              <div style={{ padding: '11px', borderRadius: '10px', fontSize: '12.5px', textAlign: 'center', backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #14532d' }}>
                Applied in P21 {formatDate(batch.applied_at)}
              </div>
              <button onClick={archiveBatch} style={{
                padding: '9px', borderRadius: '10px', fontSize: '12.5px', fontWeight: '600',
                backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
              }}>Archive batch</button>
            </>
          )}

          {/* Properties */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '16px' }}>
            {/* Vendor — assignable while editable (email intake can leave it
                Unidentified, or guess wrong from subject/body clues). */}
            <div style={{ marginBottom: '11px' }}>
              <div style={{ fontSize: '10.5px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Vendor</div>
              {!vendorEdit ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontSize: '12.5px', color: batch.vendor ? '#c0cad8' : '#f59e0b' }}>
                    {batch.vendor?.name || 'Unidentified'}
                  </span>
                  {editable && (
                    <button onClick={openVendorEdit} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '11.5px', cursor: 'pointer', padding: 0 }}>
                      {batch.vendor ? 'change' : 'assign'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select
                    autoFocus
                    defaultValue={batch.vendor?.id || ''}
                    disabled={savingVendor}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { setVendorEdit(false); setNewVendorOpen(true) }
                      else changeVendor(e.target.value)
                    }}
                    style={{
                      flex: 1, padding: '6px 8px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
                      borderRadius: '7px', color: '#c0cad8', fontSize: '12px', outline: 'none',
                    }}
                  >
                    <option value="">Unidentified</option>
                    {allVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    <option value="__new__">+ New vendor…</option>
                  </select>
                  <button onClick={() => setVendorEdit(false)} disabled={savingVendor} style={{ background: 'none', border: 'none', color: '#5a6e84', fontSize: '12px', cursor: 'pointer' }}>✕</button>
                </div>
              )}
            </div>
            <SideRow label="Source" value={`${src.icon ? src.icon + ' ' : ''}${src.label || batch.source}`} />
            {/* Effective date — editable pre-approval (drives the calendar,
                urgency pills, and reminders). */}
            <div style={{ marginBottom: '11px' }}>
              <div style={{ fontSize: '10.5px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Effective date</div>
              {!dateEdit ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontSize: '12.5px', color: batch.effective_date ? '#c0cad8' : '#f59e0b' }}>
                    {batch.effective_date ? formatDate(batch.effective_date) : 'Not set'}
                  </span>
                  {editable && (
                    <button onClick={() => setDateEdit(true)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '11.5px', cursor: 'pointer', padding: 0 }}>
                      {batch.effective_date ? 'change' : 'set'}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    ref={dateInputRef}
                    type="date"
                    autoFocus
                    defaultValue={batch.effective_date ? String(batch.effective_date).slice(0, 10) : ''}
                    disabled={savingDate}
                    style={{
                      flex: 1, padding: '5px 8px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
                      borderRadius: '7px', color: '#c0cad8', fontSize: '12px', outline: 'none', colorScheme: 'dark',
                    }}
                  />
                  <button onClick={saveEffectiveDate} disabled={savingDate} style={{ background: 'none', border: 'none', color: '#4ade80', fontSize: '13px', cursor: 'pointer', padding: 0 }}>✓</button>
                  <button onClick={() => setDateEdit(false)} disabled={savingDate} style={{ background: 'none', border: 'none', color: '#5a6e84', fontSize: '12px', cursor: 'pointer', padding: 0 }}>✕</button>
                </div>
              )}
            </div>
            <SideRow label="Received" value={`${formatDate(batch.received_at)} (${relativeTime(batch.received_at)})`} />
            <SideRow label="Lines" value={`${counts.all.toLocaleString()} · ${(batch.matched_count || 0).toLocaleString()} matched`} />
            <SideRow label="Flagged / Excluded" value={`${counts.flagged.toLocaleString()} / ${counts.excluded.toLocaleString()}`} last />
          </div>

          {/* Source email (Phase 6a — batches created from priceupdate@) */}
          {batch.source === 'email' && (batch.email_from || batch.email_subject || batch.email_body) && (
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '8px' }}>Source email</div>
              {batch.email_from && <div style={{ fontSize: '12px', color: '#8aa0b8', marginBottom: '3px' }}>From: <span style={{ color: '#d0d8e4' }}>{batch.email_from}</span></div>}
              {batch.email_subject && <div style={{ fontSize: '12px', color: '#8aa0b8', marginBottom: '6px' }}>Subject: <span style={{ color: '#d0d8e4' }}>{batch.email_subject}</span></div>}
              {batch.email_body && (
                <div style={{ fontSize: '11.5px', color: '#8aa0b8', whiteSpace: 'pre-wrap', maxHeight: '140px', overflowY: 'auto', borderTop: '1px solid #182030', paddingTop: '6px' }}>
                  {batch.email_body}
                </div>
              )}
            </div>
          )}

          {/* Files */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8' }}>Files ({files.length})</div>
              {editable && (
                <button onClick={() => addFilesRef.current?.click()} disabled={addingFiles} style={{
                  background: 'none', border: 'none', color: addingFiles ? '#5a6e84' : '#60a5fa',
                  fontSize: '12px', fontWeight: '600', cursor: addingFiles ? 'not-allowed' : 'pointer', padding: 0,
                }}>{addingFiles ? 'Uploading…' : '+ Add files'}</button>
              )}
            </div>
            <input
              ref={addFilesRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf"
              onChange={(e) => handleAddFiles(e.target.files)} style={{ display: 'none' }}
            />
            {files.length === 0 && (
              <div style={{ fontSize: '12px', color: '#4a5a6e' }}>
                No files yet — awaiting the vendor&apos;s file.{editable ? ' Add it here when it arrives.' : ''}
              </div>
            )}
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
                    {/\.pdf$/i.test(f.file_name) && editable && (
                      <Link href={`/priceupdates/batches/${id}/pdf?file=${f.id}`} style={{ ...miniBtn(parsed ? '#1e2a3a' : '#2563eb', parsed ? '#60a5fa' : '#fff'), textDecoration: 'none', display: 'inline-block' }}>
                        {parsed ? 'Re-enter lines' : 'Enter lines'}
                      </Link>
                    )}
                    <button onClick={() => downloadFile(f)} style={miniBtn('#1e2a3a', '#8aa0b8')}>Download</button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Exports */}
          {exports.length > 0 && (
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Exports ({exports.length})</div>
              {exports.map(e => (
                <div key={e.id} style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', color: '#d0d8e4' }}>{e.file_name}</div>
                  <div style={{ fontSize: '11px', color: '#5a6e84', margin: '2px 0 5px' }}>
                    {e.row_count.toLocaleString()} lines · {relativeTime(e.created_at)}
                    {e.creator ? ` · ${e.creator.full_name || e.creator.email}` : ''}
                  </div>
                  <button onClick={() => downloadExport(e)} style={miniBtn('#1e2a3a', '#8aa0b8')}>Download</button>
                </div>
              ))}
            </div>
          )}

          {/* Library files linked to this batch (Phase 5.5) */}
          {libraryFiles.length > 0 && (
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Library files ({libraryFiles.length})</div>
              {libraryFiles.map(f => (
                <div key={f.id} style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file_name}>{f.file_name}</div>
                  <div style={{ fontSize: '11px', color: '#5a6e84', margin: '2px 0 5px' }}>{f.year || ''}{f.year ? ' · ' : ''}{relativeTime(f.created_at)}</div>
                  <button onClick={() => downloadFile(f)} style={miniBtn('#1e2a3a', '#8aa0b8')}>Download</button>
                </div>
              ))}
            </div>
          )}

          {/* Timeline */}
          <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Timeline</div>
            <TimelineStep done label="Received" detail={formatDate(batch.received_at)} />
            <TimelineStep done={counts.all > 0} label="Parsed" detail={counts.all > 0 ? `${counts.all.toLocaleString()} lines` : 'pending'} />
            <TimelineStep done={!!batch.approved_at} label="Approved" detail={batch.approved_at ? `${formatDate(batch.approved_at)} · ${batch.approver?.full_name || batch.approver?.email || ''}` : 'pending'} />
            <TimelineStep done={!!batch.exported_at} label="Exported" detail={batch.exported_at ? formatDate(batch.exported_at) : 'pending'} />
            <TimelineStep done={!!batch.applied_at} label="Applied in P21" detail={batch.applied_at ? `${formatDate(batch.applied_at)} · ${batch.applier?.full_name || batch.applier?.email || ''}` : 'pending'} last />
          </div>

          {batch.notes && (
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '8px' }}>Activity / notes</div>
              <div style={{ fontSize: '11.5px', color: '#8aa0b8', whiteSpace: 'pre-wrap', maxHeight: '160px', overflowY: 'auto' }}>{batch.notes}</div>
            </div>
          )}

          {/* Danger zone — only before approval; approved/exported/applied batches are history. */}
          {editable && (
            <button onClick={deleteBatch} disabled={deleting} style={{
              padding: '9px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: '600',
              backgroundColor: 'transparent', color: deleting ? '#7a4a4a' : '#f87171',
              border: '1px solid #4a1d1d', cursor: deleting ? 'not-allowed' : 'pointer',
            }}>{deleting ? 'Deleting…' : 'Delete batch'}</button>
          )}
        </div>
      </div>

      {newVendorOpen && (
        <VendorModal
          vendor={null}
          onClose={() => setNewVendorOpen(false)}
          onSaved={(created) => {
            setNewVendorOpen(false)
            if (created?.id) {
              setAllVendors(prev => [...prev.filter(v => v.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)))
              changeVendor(created.id, created)
            }
          }}
        />
      )}

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

      <Toasts toasts={toasts} />
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
