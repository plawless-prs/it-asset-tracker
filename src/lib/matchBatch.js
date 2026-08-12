// Core matching pass for a Price Update Processor batch — match parsed lines
// against the P21 item mirror and apply guardrail flags. Re-runnable.
// Extracted from /api/priceupdates/match (Phase 6b) so server-side flows with
// no user session (on-arrival auto-parse) can match too; the route keeps its
// Bearer auth and delegates here. Callers supply a service-role client.
//
// Matching: normalize vendor_item_no and look it up within the batch vendor's
// P21 supplier scope —
//   (0) pu_item_aliases (match memory): a resolution a reviewer confirmed on a
//       previous batch wins outright -> matched.
//   (a) mirror.supplier_part_no  (P21's supplier cross-reference), and
//   (b) mirror.p21_item_id with the vendor's p21_item_prefix stripped
//       (P21 item ids are "<prefix><space><vendor part>", e.g. "GAT QD12/…").
// Exactly one distinct P21 item -> matched; none -> unmatched. More than one ->
// ambiguous, but the CLOSEST candidate is auto-picked (pickBestCandidate) and
// written to the line with real old cost/list + Δ% + guardrail flag, included
// by default — the reviewer skims the Ambiguous tab instead of resolving each
// line by hand, and approval confirms the picks into pu_item_aliases.
import { normalizePart, costChangePct, computeFlag, pickBestCandidate } from './priceupdates'

// Throws Error (with .status where meaningful) on failure; returns the stats
// object on success.
export async function matchBatch(admin, batchId) {
  const fail = (message, status = 500) => {
    const e = new Error(message)
    e.status = status
    throw e
  }

  const { data: batch } = await admin
    .from('pu_batches')
    .select('id, status, vendor:vendor_id(id, p21_supplier_id, p21_item_prefix)')
    .eq('id', batchId).single()
  if (!batch) fail('batch not found', 404)

  const supplierId = batch.vendor?.p21_supplier_id ? String(batch.vendor.p21_supplier_id).trim() : null
  const prefix = batch.vendor?.p21_item_prefix || ''

  const { data: settings } = await admin.from('pu_settings').select('*').eq('id', 1).single()
  const cfg = settings || { large_increase_pct: 20, flag_decreases: true, flag_cost_over_list: true }

  // Page the lines fetch — PostgREST caps un-ranged selects at 1000 rows, and
  // real vendor files run to tens of thousands of lines.
  const lines = []
  {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await admin
        .from('pu_lines').select('id, vendor_item_no, new_cost, new_list, match_status, include')
        .eq('batch_id', batchId).order('id').range(from, from + PAGE - 1)
      if (error) fail(error.message)
      if (!rows || rows.length === 0) break
      lines.push(...rows)
      if (rows.length < PAGE) break
    }
  }
  if (lines.length === 0) {
    return { ok: true, total: 0, matched: 0, unmatched: 0, ambiguous: 0, flagged: 0, note: 'no lines to match' }
  }

  // Build the mirror lookup for this supplier (both cross-ref and prefix-bridge).
  const byKey = new Map()      // normalized key -> Map(p21_item_id -> mirrorRow)
  const byItemId = new Map()   // p21_item_id -> mirrorRow (for alias resolution)
  const addKey = (key, m) => {
    if (!key) return
    if (!byKey.has(key)) byKey.set(key, new Map())
    byKey.get(key).set(m.p21_item_id, m)
  }
  let mirrorRows = 0
  if (supplierId) {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await admin
        .from('p21_item_mirror')
        .select('p21_item_id, supplier_part_no, current_cost, current_list')
        .eq('supplier_id', supplierId).range(from, from + PAGE - 1)
      if (error) fail(error.message)
      if (!rows || rows.length === 0) break
      for (const m of rows) {
        if (!byItemId.has(m.p21_item_id)) byItemId.set(m.p21_item_id, m)
        addKey(normalizePart(m.supplier_part_no), m)
        let idPart = m.p21_item_id || ''
        if (prefix && idPart.startsWith(prefix)) idPart = idPart.slice(prefix.length)
        addKey(normalizePart(idPart), m)
      }
      mirrorRows += rows.length
      if (rows.length < PAGE) break
    }
  }

  // Match memory: resolutions confirmed on this vendor's previous batches.
  const aliases = new Map()    // normalized_part -> p21_item_id
  if (batch.vendor?.id) {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await admin
        .from('pu_item_aliases').select('normalized_part, p21_item_id')
        .eq('vendor_id', batch.vendor.id).range(from, from + PAGE - 1)
      if (error) fail(error.message)
      if (!rows || rows.length === 0) break
      for (const a of rows) aliases.set(a.normalized_part, a.p21_item_id)
      if (rows.length < PAGE) break
    }
  }

  let matched = 0, ambiguous = 0, flagged = 0, remembered = 0
  const matchedLine = (l, m, status = 'matched') => {
    const pct = costChangePct(m.current_cost, l.new_cost)
    const flag = computeFlag({ new_cost: l.new_cost, new_list: l.new_list, old_cost: m.current_cost }, cfg)
    return {
      id: l.id, match_status: status, p21_item_id: m.p21_item_id,
      old_cost: m.current_cost, old_list: m.current_list, cost_change_pct: pct, flag,
    }
  }
  const updates = lines.map(l => {
    const key = normalizePart(l.vendor_item_no)

    // (0) a previously confirmed resolution wins outright.
    const aliasRow = key && aliases.has(key) ? byItemId.get(aliases.get(key)) : null
    if (aliasRow) {
      const u = matchedLine(l, aliasRow)
      matched++; remembered++
      if (u.flag !== 'ok') flagged++
      return u
    }

    const hitMap = key ? byKey.get(key) : null
    const hits = hitMap ? Array.from(hitMap.values()) : []

    if (hits.length === 1) {
      const u = matchedLine(l, hits[0])
      matched++
      if (u.flag !== 'ok') flagged++
      return u
    }
    if (hits.length > 1) {
      // Auto-pick the closest candidate; stays 'ambiguous' so it lands in its
      // own review tab, but carries a real pick + Δ% + guardrail flag and no
      // longer blocks approval. Approving the batch confirms it into aliases.
      ambiguous++
      return matchedLine(l, pickBestCandidate(hits, { normalizedPart: key, prefix }), 'ambiguous')
    }
    return { id: l.id, match_status: 'unmatched', p21_item_id: null, old_cost: null, old_list: null, cost_change_pct: null, flag: 'new' }
  })

  // Bulk-apply via the migration-defined function (chunked; leaves `include` alone).
  for (let i = 0; i < updates.length; i += 5000) {
    const { error } = await admin.rpc('pu_apply_matches', { _updates: updates.slice(i, i + 5000) })
    if (error) fail(error.message)
  }

  // Include/exclude defaults driven by the match outcome. Unmatched lines are
  // auto-excluded (reviewers spend their time on ambiguous/flagged lines, not
  // the not-in-P21 tail). A line that just transitioned unmatched -> matched/
  // ambiguous while excluded is re-included (the sync-mirror-then-rematch
  // rescue). Reviewed lines whose status didn't change keep the reviewer's
  // manual include/exclude choice — re-running stays non-destructive there.
  const byId = new Map(lines.map(l => [l.id, l]))
  const toExclude = [], toInclude = []
  for (const u of updates) {
    const prev = byId.get(u.id)
    if (!prev) continue
    if (u.match_status === 'unmatched' && prev.include) toExclude.push(u.id)
    else if (u.match_status !== 'unmatched' && prev.match_status === 'unmatched' && !prev.include) toInclude.push(u.id)
  }
  for (const [ids, include] of [[toExclude, false], [toInclude, true]]) {
    for (let i = 0; i < ids.length; i += 500) {
      const { error } = await admin.from('pu_lines')
        .update({ include }).in('id', ids.slice(i, i + 500))
      if (error) fail(error.message)
    }
  }

  // matched_count includes auto-picked ambiguous lines (they carry a pick and
  // export after approval) so the queue's "unmatched" pill = the true
  // not-in-P21 tail. flagged_count mirrors the Flagged tab: matched-only.
  const advance = ['received', 'parsing', 'failed', 'needs_review'].includes(batch.status)
  await admin.from('pu_batches').update({
    matched_count: matched + ambiguous,
    flagged_count: flagged,
    status: advance ? 'needs_review' : batch.status,
  }).eq('id', batchId)

  return {
    ok: true,
    total: lines.length,
    matched,
    remembered,
    unmatched: lines.length - matched - ambiguous,
    ambiguous,
    flagged,
    auto_excluded: toExclude.length,
    auto_included: toInclude.length,
    mirror_rows: mirrorRows,
    supplier_id: supplierId,
    warning: supplierId ? undefined : 'vendor has no p21_supplier_id — nothing to match against',
  }
}
