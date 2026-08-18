// On-prem P21 mirror sync worker.
//
// Runs on a machine inside the office network (Epicor's SQL replica only
// accepts connections from allowlisted IPs, which Vercel's egress is not).
// Mirrors the logic of src/app/api/p21/sync-items/route.js: one joined query
// per tracked supplier against the replica, upserted into Supabase's
// p21_item_mirror via the service role. Self-contained on purpose — the app's
// src/lib files are Next-flavored ESM this plain Node script can't import.
//
// Modes:
//   node sync-worker.mjs --once    run one full sync and exit (nightly task)
//   node sync-worker.mjs --watch   poll every POLL_SECONDS: heartbeat to
//                                  pu_settings (the UI's online pill) and
//                                  drain the pu_sync_requests queue — the app
//                                  enqueues supplier-scoped requests on batch
//                                  creation and all-supplier requests from
//                                  Settings "Sync now"
//
// Config comes from worker/.env (KEY=VALUE lines; see README.md). Required:
//   P21_SQL_HOST, P21_SQL_DATABASE, P21_SQL_USERNAME, P21_SQL_PASSWORD,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: P21_SQL_PORT (1433), POLL_SECONDS (60), P21_SQL_TRUST_CERT
// (set to true to accept the replica's self-signed certificate), plus the
// same P21_SUPPLIER_VIEW / P21_ITEM_VIEW / P21_F_* overrides the app supports.

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sql from 'mssql'

// --- env ------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
try {
  for (const line of readFileSync(join(here, '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const k = t.slice(0, t.indexOf('=')).trim()
    const v = t.slice(t.indexOf('=') + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* no .env file — rely on process env */ }

const env = process.env
const SUPABASE_URL = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const POLL_SECONDS = Number(env.POLL_SECONDS || 60)

for (const k of ['P21_SQL_HOST', 'P21_SQL_DATABASE', 'P21_SQL_USERNAME', 'P21_SQL_PASSWORD']) {
  if (!env[k]) { console.error(`Missing required env: ${k}`); process.exit(1) }
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const SUPPLIER_VIEW = env.P21_SUPPLIER_VIEW || 'p21_view_inventory_supplier'
const ITEM_VIEW     = env.P21_ITEM_VIEW     || 'p21_view_inv_mast'
// Supplier master (directory of all suppliers, id + name) — mirrored into
// Supabase's p21_supplier_mirror on full syncs for the vendor lookup UI.
const SUPPLIER_MASTER_VIEW = env.P21_SUPPLIER_MASTER_VIEW || 'p21_view_supplier'
const F = {
  supplier_id:      env.P21_F_SUPPLIER_ID      || 'supplier_id',
  item_id:          env.P21_F_ITEM_ID          || 'item_id',
  supplier_part_no: env.P21_F_SUPPLIER_PART_NO || 'supplier_part_no',
  cost:             env.P21_F_COST             || 'cost',
  list:             env.P21_F_LIST             || 'list_price',
  inv_mast_uid:     env.P21_F_INV_MAST_UID     || 'inv_mast_uid',
  delete_flag:      env.P21_F_DELETE_FLAG      || 'delete_flag',
  item_desc:        env.P21_F_ITEM_DESC        || 'item_desc',
  uom:              env.P21_F_UOM              || 'default_purchasing_unit',
}

const SQL_PAGE = 5000
const UPSERT_CHUNK = 1000

// --- Supabase REST helpers (service role) ---------------------------------

async function sb(method, path, body, headers = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${r.status}): ${await r.text()}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

const patchSettings = (patch) => sb('PATCH', 'pu_settings?id=eq.1', patch)

// --- P21 SQL replica -------------------------------------------------------

let _pool = null
async function getPool() {
  if (!_pool) {
    _pool = await sql.connect({
      server: env.P21_SQL_HOST,
      port: Number(env.P21_SQL_PORT || 1433),
      database: env.P21_SQL_DATABASE,
      user: env.P21_SQL_USERNAME,
      password: env.P21_SQL_PASSWORD,
      // P21_SQL_TRUST_CERT=true accepts the replica's certificate without CA
      // validation (Epicor began presenting a self-signed cert in Aug 2026,
      // which broke every sync). Traffic is still TLS-encrypted either way.
      options: { encrypt: true, trustServerCertificate: env.P21_SQL_TRUST_CERT === 'true' },
      connectionTimeout: 30000,
      requestTimeout: 120000,
      pool: { max: 2, min: 0, idleTimeoutMillis: 30000 },
    })
  }
  return _pool
}

function sqlIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`)
  return name
}

function joinQuery() {
  const sv = sqlIdent(SUPPLIER_VIEW), iv = sqlIdent(ITEM_VIEW)
  const f = Object.fromEntries(Object.entries(F).map(([k, v]) => [k, sqlIdent(v)]))
  return `
    SELECT s.${f.supplier_id}, s.${f.item_id}, s.${f.supplier_part_no},
           s.${f.cost}, s.${f.list}, s.${f.inv_mast_uid},
           m.${f.item_desc} AS __desc, m.${f.uom} AS __uom
    FROM dbo.${sv} s
    LEFT JOIN dbo.${iv} m
           ON m.${f.inv_mast_uid} = s.${f.inv_mast_uid} AND m.${f.delete_flag} = 'N'
    WHERE s.${f.supplier_id} = @sid AND s.${f.delete_flag} = 'N'
    ORDER BY s.${f.inv_mast_uid}
    OFFSET @off ROWS FETCH NEXT @page ROWS ONLY`
}

// --- sync ------------------------------------------------------------------

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

function toMirrorRow(r, startedAt) {
  return {
    p21_item_id:      r[F.item_id] != null ? String(r[F.item_id]).trim() : '',
    supplier_id:      r[F.supplier_id] != null ? String(r[F.supplier_id]).trim() : null,
    supplier_part_no: r[F.supplier_part_no] != null ? String(r[F.supplier_part_no]).trim() : null,
    item_desc:        r.__desc ?? null,
    uom:              r.__uom ?? null,
    current_cost:     num(r[F.cost]),
    current_list:     num(r[F.list]),
    last_synced_at:   startedAt,
  }
}

// Dedupe on the PK (a supplier can list the same item per division — last one
// wins) so a single upsert statement never hits the same row twice.
async function upsertMirror(rows) {
  const byKey = new Map()
  for (const x of rows) if (x.p21_item_id && x.supplier_id) byKey.set(`${x.p21_item_id} ${x.supplier_id}`, x)
  const deduped = [...byKey.values()]
  for (let i = 0; i < deduped.length; i += UPSERT_CHUNK) {
    await sb('POST', 'p21_item_mirror?on_conflict=p21_item_id,supplier_id',
      deduped.slice(i, i + UPSERT_CHUNK),
      { Prefer: 'resolution=merge-duplicates,return=minimal' })
  }
  return deduped.length
}

// Mirror the P21 supplier directory (id + name, ~5k rows) into
// p21_supplier_mirror. Runs on full syncs only — it changes rarely and the
// scoped batch-created path should stay seconds-fast.
async function syncSupplierDirectory(startedAt) {
  const view = sqlIdent(SUPPLIER_MASTER_VIEW)
  const pool = await getPool()
  let total = 0
  for (let off = 0; ; off += SQL_PAGE) {
    const req = pool.request()
    req.input('off', off); req.input('page', SQL_PAGE)
    const rows = (await req.query(`
      SELECT supplier_id, supplier_name FROM dbo.${view}
      WHERE delete_flag = 'N'
      ORDER BY supplier_id
      OFFSET @off ROWS FETCH NEXT @page ROWS ONLY`)).recordset || []
    if (rows.length === 0) break
    const mapped = rows
      .filter(r => r.supplier_id != null)
      .map(r => ({
        supplier_id: String(r.supplier_id).trim(),
        supplier_name: r.supplier_name != null ? String(r.supplier_name).trim() : null,
        last_synced_at: startedAt,
      }))
    for (let i = 0; i < mapped.length; i += UPSERT_CHUNK) {
      await sb('POST', 'p21_supplier_mirror?on_conflict=supplier_id',
        mapped.slice(i, i + UPSERT_CHUNK),
        { Prefer: 'resolution=merge-duplicates,return=minimal' })
    }
    total += mapped.length
    if (rows.length < SQL_PAGE) break
  }
  return total
}

// scope: null/undefined = all tracked suppliers; or an array of supplier ids.
async function runSync(via, scope = null) {
  const startedAt = new Date().toISOString()
  console.log(`[${startedAt}] sync starting (${via}${scope ? `, suppliers: ${scope.join(', ')}` : ', all suppliers'})`)

  let supplierIds
  if (scope) {
    supplierIds = [...new Set(scope.map(s => String(s).trim()).filter(Boolean))]
  } else {
    const vends = await sb('GET', 'pu_vendors?select=p21_supplier_id&p21_supplier_id=not.is.null')
    supplierIds = [...new Set((vends || []).map(v => String(v.p21_supplier_id).trim()).filter(Boolean))]
  }
  if (supplierIds.length === 0) {
    const result = { ok: true, via, upserted: 0, note: 'No vendors have a P21 supplier id set — nothing to sync.', started_at: startedAt, finished_at: new Date().toISOString() }
    console.log(result.note)
    return result
  }

  const pool = await getPool()
  const query = joinQuery()
  let upserted = 0
  const perSupplier = []
  for (const sid of supplierIds) {
    let n = 0
    for (let off = 0; ; off += SQL_PAGE) {
      const req = pool.request()
      req.input('sid', sid); req.input('off', off); req.input('page', SQL_PAGE)
      const rows = (await req.query(query)).recordset || []
      if (rows.length === 0) break
      n += await upsertMirror(rows.map(r => toMirrorRow(r, startedAt)))
      if (rows.length < SQL_PAGE) break
    }
    perSupplier.push({ supplier_id: sid, rows: n })
    upserted += n
    console.log(`  supplier ${sid}: ${n.toLocaleString()} rows`)
  }

  // Full syncs also refresh the supplier directory (vendor-lookup UI).
  // Best-effort: a directory failure must not fail the item sync. Missing-
  // table errors (migration 19 not run yet) are expected until it's applied.
  let supplierDirectory
  if (!scope) {
    try {
      supplierDirectory = await syncSupplierDirectory(startedAt)
      console.log(`  supplier directory: ${supplierDirectory.toLocaleString()} rows`)
    } catch (e) {
      supplierDirectory = `failed: ${String(e?.message || e).slice(0, 160)}`
      console.error(`  supplier directory sync failed: ${String(e?.message || e)}`)
    }
  }

  const result = { ok: true, via, upserted, suppliers: perSupplier, supplier_directory: supplierDirectory, started_at: startedAt, finished_at: new Date().toISOString() }
  console.log(`[${result.finished_at}] sync done — ${upserted.toLocaleString()} rows`)
  return result
}

async function syncAndRecord(via, scope = null) {
  let result
  try {
    result = await runSync(via, scope)
  } catch (e) {
    result = { ok: false, via, error: String(e?.message || e), finished_at: new Date().toISOString() }
    console.error(`sync failed: ${result.error}`)
  }
  try {
    await patchSettings({ worker_last_result: result, worker_heartbeat_at: new Date().toISOString() })
  } catch (e) {
    console.error(`could not record result in pu_settings: ${String(e?.message || e)}`)
  }
  return result
}

// Drain pu_sync_requests: claim everything pending, then run the minimum set
// of syncs that covers it — one full sync if any request is unscoped,
// otherwise one scoped sync over the distinct supplier ids. Every claimed
// request gets the shared result.
const STALE_RUNNING_MINUTES = 10

async function drainQueue() {
  // Crash recovery: a request claimed by a worker that died mid-sync stays
  // 'running' forever (only 'pending' rows get claimed). Requeue any that are
  // implausibly old — syncs are idempotent, so re-running is safe.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MINUTES * 60000).toISOString()
  const requeued = await sb('PATCH',
    `pu_sync_requests?status=eq.running&started_at=lt.${staleBefore}`,
    { status: 'pending', started_at: null },
    { Prefer: 'return=representation' })
  if (requeued?.length) console.log(`requeued ${requeued.length} request(s) stranded by an earlier crash`)

  const pending = await sb('GET', 'pu_sync_requests?status=eq.pending&select=id,supplier_id,reason&order=requested_at.asc')
  if (!pending?.length) return false

  const ids = pending.map(r => r.id)
  const idFilter = `id=in.(${ids.join(',')})`
  await sb('PATCH', `pu_sync_requests?${idFilter}&status=eq.pending`,
    { status: 'running', started_at: new Date().toISOString() })

  const wantsAll = pending.some(r => !r.supplier_id)
  const scope = wantsAll ? null : [...new Set(pending.map(r => r.supplier_id))]
  console.log(`picked up ${pending.length} request(s) (${pending.map(r => r.reason).join(', ')})`)

  const result = await syncAndRecord(wantsAll ? 'worker-manual' : 'worker-batch', scope)
  await sb('PATCH', `pu_sync_requests?${idFilter}`,
    { status: result.ok ? 'done' : 'failed', finished_at: new Date().toISOString(), result })
  return true
}

// --- modes -----------------------------------------------------------------

const mode = process.argv.includes('--watch') ? 'watch' : process.argv.includes('--once') ? 'once' : null
if (!mode) {
  console.error('Usage: node sync-worker.mjs --once | --watch')
  process.exit(1)
}

if (mode === 'once') {
  const result = await syncAndRecord('worker-scheduled')
  await sql.close().catch(() => {})
  process.exit(result.ok ? 0 : 1)
}

// watch: heartbeat every poll; drain any queued sync requests.
console.log(`watching for sync requests (every ${POLL_SECONDS}s)…`)
while (true) {
  try {
    const ranSync = await drainQueue()
    if (!ranSync) await patchSettings({ worker_heartbeat_at: new Date().toISOString() })
  } catch (e) {
    console.error(`poll error: ${String(e?.message || e)}`)
  }
  await new Promise(res => setTimeout(res, POLL_SECONDS * 1000))
}
