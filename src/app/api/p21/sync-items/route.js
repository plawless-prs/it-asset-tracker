// Sync P21 item + supplier-cost data into the read-only `p21_item_mirror`.
// Called nightly by Vercel Cron (Authorization: Bearer <CRON_SECRET>) and by the
// Settings "Sync now" / "Test connection" buttons (a logged-in priceupdates
// user's Bearer token).
//
// Mirrors Porter's proven P21 report query — a join of two OData views on
// inv_mast_uid, scoped per supplier:
//   p21_view_inventory_supplier: supplier_id, item_id, supplier_part_no,
//                                list_price, cost, inv_mast_uid, delete_flag
//   p21_view_inv_mast:           inv_mast_uid, item_desc,
//                                default_purchasing_unit (UOM), delete_flag
// We pull inventory_supplier filtered per tracked supplier (delete_flag='N') and
// enrich item_desc/UOM from inv_mast (best-effort). Only vendors in pu_vendors
// with a p21_supplier_id are synced.
//
// View + field names default to the confirmed values but stay env-overridable
// (P21_SUPPLIER_VIEW / P21_ITEM_VIEW / P21_F_*) in case the play vs prod
// instances differ.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { p21Configured, p21OData, p21ODataAll } from '../../../../lib/p21'

export const runtime = 'nodejs'
export const maxDuration = 300

const SUPPLIER_VIEW = process.env.P21_SUPPLIER_VIEW || 'p21_view_inventory_supplier'
const ITEM_VIEW     = process.env.P21_ITEM_VIEW     || 'p21_view_inv_mast'
const F = {
  supplier_id:      process.env.P21_F_SUPPLIER_ID      || 'supplier_id',
  item_id:          process.env.P21_F_ITEM_ID          || 'item_id',
  supplier_part_no: process.env.P21_F_SUPPLIER_PART_NO || 'supplier_part_no',
  cost:             process.env.P21_F_COST             || 'cost',
  list:             process.env.P21_F_LIST             || 'list_price',
  inv_mast_uid:     process.env.P21_F_INV_MAST_UID     || 'inv_mast_uid',
  delete_flag:      process.env.P21_F_DELETE_FLAG      || 'delete_flag',
  item_desc:        process.env.P21_F_ITEM_DESC        || 'item_desc',
  uom:              process.env.P21_F_UOM              || 'default_purchasing_unit',
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

// OData literal: bare for all-digit ids, single-quoted (escaped) otherwise.
function odataVal(v) {
  const s = String(v)
  return /^\d+$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`
}

async function authorize(req, admin) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return { ok: true, via: 'cron' }
  if (!bearer) return { ok: false }
  const { data: { user } } = await admin.auth.getUser(bearer)
  if (!user) return { ok: false }
  const { data: profile } = await admin.from('profiles').select('role, app_access').eq('id', user.id).single()
  const acc = Array.isArray(profile?.app_access) ? profile.app_access : []
  if (profile?.role === 'admin' || acc.includes('priceupdates')) return { ok: true, via: 'manual' }
  return { ok: false }
}

async function handler(req) {
  const admin = createAdminClient()
  const auth = await authorize(req, admin)
  if (!auth.ok) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!p21Configured()) return Response.json({ error: 'P21 not configured (P21_BASE_URL/USERNAME/PASSWORD)' }, { status: 503 })

  let body = {}
  try { body = await req.json() } catch { /* GET/empty is fine */ }

  const supplierSelect = [F.supplier_id, F.item_id, F.supplier_part_no, F.cost, F.list, F.inv_mast_uid].join(',')

  // --- Test mode: prove auth + view + field names without writing anything. ---
  if (body?.test) {
    try {
      const j = await p21OData(SUPPLIER_VIEW, { select: supplierSelect, filter: `${F.delete_flag} eq 'N'`, top: 5 })
      const rows = Array.isArray(j) ? j : (j?.value || [])
      return Response.json({
        ok: true, mode: 'test', view: SUPPLIER_VIEW,
        sample_count: rows.length,
        detected_fields: rows[0] ? Object.keys(rows[0]) : [],
        sample: rows.slice(0, 3),
      })
    } catch (e) {
      return Response.json({ ok: false, mode: 'test', view: SUPPLIER_VIEW, error: String(e?.message || e) }, { status: 502 })
    }
  }

  // Which suppliers to sync: tracked vendors with a p21_supplier_id (or one passed in).
  let supplierIds
  if (body?.supplier_id) {
    supplierIds = [String(body.supplier_id)]
  } else {
    const { data: vends } = await admin.from('pu_vendors').select('p21_supplier_id').not('p21_supplier_id', 'is', null)
    supplierIds = [...new Set((vends || []).map(v => String(v.p21_supplier_id).trim()).filter(Boolean))]
  }
  if (supplierIds.length === 0) {
    return Response.json({ ok: true, upserted: 0, note: 'No vendors have a P21 supplier id set — nothing to sync.' })
  }

  const startedAt = new Date().toISOString()

  // Enrichment: item_desc + UOM from inv_mast, keyed by inv_mast_uid. Best-effort
  // — a failure here must not block the matching-critical supplier data.
  const itemMap = new Map()
  let enrichWarning
  try {
    await p21ODataAll(ITEM_VIEW, {
      select: [F.inv_mast_uid, F.item_desc, F.uom].join(','),
      filter: `${F.delete_flag} eq 'N'`,
    }, async (rows) => {
      for (const r of rows) {
        const uid = r[F.inv_mast_uid]
        if (uid != null) itemMap.set(String(uid), { desc: r[F.item_desc] ?? null, uom: r[F.uom] ?? null })
      }
    })
  } catch (e) {
    enrichWarning = `Item-master enrichment skipped (descriptions/UOM will be blank): ${String(e?.message || e)}`
  }

  let upserted = 0
  const perSupplier = []
  try {
    for (const sid of supplierIds) {
      let n = 0
      await p21ODataAll(SUPPLIER_VIEW, {
        select: supplierSelect,
        filter: `${F.supplier_id} eq ${odataVal(sid)} and ${F.delete_flag} eq 'N'`,
      }, async (rows) => {
        const mapped = rows.map(r => {
          const enrich = itemMap.get(String(r[F.inv_mast_uid])) || {}
          return {
            p21_item_id:      r[F.item_id] != null ? String(r[F.item_id]).trim() : '',
            supplier_id:      r[F.supplier_id] != null ? String(r[F.supplier_id]).trim() : null,
            supplier_part_no: r[F.supplier_part_no] != null ? String(r[F.supplier_part_no]).trim() : null,
            item_desc:        enrich.desc ?? null,
            uom:              enrich.uom ?? null,
            current_cost:     num(r[F.cost]),
            current_list:     num(r[F.list]),
            last_synced_at:   startedAt,
          }
        }).filter(x => x.p21_item_id && x.supplier_id)
        if (mapped.length) {
          const { error } = await admin.from('p21_item_mirror').upsert(mapped, { onConflict: 'p21_item_id,supplier_id' })
          if (error) throw error
          n += mapped.length
        }
      })
      perSupplier.push({ supplier_id: sid, rows: n })
      upserted += n
    }
  } catch (e) {
    return Response.json({ ok: false, upserted, perSupplier, error: String(e?.message || e) }, { status: 502 })
  }

  return Response.json({ ok: true, via: auth.via, upserted, suppliers: perSupplier, synced_at: startedAt, warning: enrichWarning })
}

export async function POST(req) { return handler(req) }
export async function GET(req) { return handler(req) }
