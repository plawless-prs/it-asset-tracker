// Match a batch's parsed lines against the P21 item mirror and apply guardrail
// flags. Re-runnable. Bearer-auth + priceupdates access (like parse-file).
//
// Matching: normalize vendor_item_no and look it up two ways within the batch
// vendor's P21 supplier scope —
//   (a) mirror.supplier_part_no  (P21's supplier cross-reference), and
//   (b) mirror.p21_item_id with the vendor's p21_item_prefix stripped
//       (P21 item ids are "<prefix><space><vendor part>", e.g. "GAT QD12/…").
// Exactly one distinct P21 item -> matched; more than one -> ambiguous; none ->
// unmatched. Matched lines get old cost/list + cost_change_pct + a flag.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { normalizePart, costChangePct, computeFlag } from '../../../../lib/priceupdates'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req) {
  const accessToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: { user }, error: uErr } = await admin.auth.getUser(accessToken)
  if (uErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: profile } = await admin.from('profiles').select('role, app_access').eq('id', user.id).single()
  const acc = Array.isArray(profile?.app_access) ? profile.app_access : []
  if (!(profile?.role === 'admin' || acc.includes('priceupdates'))) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const batchId = body?.batch_id
  if (!batchId) return Response.json({ error: 'batch_id required' }, { status: 400 })

  const { data: batch } = await admin
    .from('pu_batches')
    .select('id, status, vendor:vendor_id(id, p21_supplier_id, p21_item_prefix)')
    .eq('id', batchId).single()
  if (!batch) return Response.json({ error: 'batch not found' }, { status: 404 })

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
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
      if (!rows || rows.length === 0) break
      lines.push(...rows)
      if (rows.length < PAGE) break
    }
  }
  if (lines.length === 0) {
    return Response.json({ ok: true, total: 0, matched: 0, unmatched: 0, ambiguous: 0, flagged: 0, note: 'no lines to match' })
  }

  // Build the mirror lookup for this supplier (both cross-ref and prefix-bridge).
  const byKey = new Map()   // normalized key -> Map(p21_item_id -> mirrorRow)
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
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
      if (!rows || rows.length === 0) break
      for (const m of rows) {
        addKey(normalizePart(m.supplier_part_no), m)
        let idPart = m.p21_item_id || ''
        if (prefix && idPart.startsWith(prefix)) idPart = idPart.slice(prefix.length)
        addKey(normalizePart(idPart), m)
      }
      mirrorRows += rows.length
      if (rows.length < PAGE) break
    }
  }

  let matched = 0, ambiguous = 0, flagged = 0
  const updates = lines.map(l => {
    const key = normalizePart(l.vendor_item_no)
    const hitMap = key ? byKey.get(key) : null
    const hits = hitMap ? Array.from(hitMap.values()) : []

    if (hits.length === 1) {
      const m = hits[0]
      const pct = costChangePct(m.current_cost, l.new_cost)
      const flag = computeFlag({ new_cost: l.new_cost, new_list: l.new_list, old_cost: m.current_cost }, cfg)
      matched++
      if (flag !== 'ok') flagged++
      return {
        id: l.id, match_status: 'matched', p21_item_id: m.p21_item_id,
        old_cost: m.current_cost, old_list: m.current_list, cost_change_pct: pct, flag,
      }
    }
    if (hits.length > 1) {
      ambiguous++; flagged++
      return { id: l.id, match_status: 'ambiguous', p21_item_id: null, old_cost: null, old_list: null, cost_change_pct: null, flag: 'review' }
    }
    return { id: l.id, match_status: 'unmatched', p21_item_id: null, old_cost: null, old_list: null, cost_change_pct: null, flag: 'new' }
  })

  // Bulk-apply via the migration-defined function (chunked; leaves `include` alone).
  for (let i = 0; i < updates.length; i += 5000) {
    const { error } = await admin.rpc('pu_apply_matches', { _updates: updates.slice(i, i + 5000) })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
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
      if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
  }

  const advance = ['received', 'parsing', 'failed', 'needs_review'].includes(batch.status)
  await admin.from('pu_batches').update({
    matched_count: matched,
    flagged_count: flagged,
    status: advance ? 'needs_review' : batch.status,
  }).eq('id', batchId)

  return Response.json({
    ok: true,
    total: lines.length,
    matched,
    unmatched: lines.length - matched - ambiguous,
    ambiguous,
    flagged,
    auto_excluded: toExclude.length,
    auto_included: toInclude.length,
    mirror_rows: mirrorRows,
    supplier_id: supplierId,
    warning: supplierId ? undefined : 'vendor has no p21_supplier_id — nothing to match against',
  })
}
