// Bot API — IT Tracker assets.
//   GET (assets:read) ?q=<text>         (name / serial / asset tag / hostname / assigned name)
//       &status=Deployed,In Repair       (default: everything except Disposed)
//       &type=Laptop,Desktop &employee_id=<uuid> &location_id=<uuid>
//       &limit=25 (max 100) &offset=0
//       Ordered by id (stable paging).
//   POST (assets:write) create an asset; Idempotency-Key required; ?dry_run=1.
// Cost fields and photos are never returned or accepted. See docs/bot-api.md.
import {
  requireBotScope, botJson, botFail, requireBotWrite, requireIdempotencyKey, botWriteJson, runWrite,
} from '../../../../../../lib/botAuth'
import { intParam, isUuid, searchTerm } from '../../../../../../lib/botHelpdesk'
import { withValidation, readBody } from '../../../../../../lib/botWrite'
import { ASSET_STATUSES, ASSET_TYPE_VALUES } from '../../../../../../lib/tracker'
import {
  ASSET_LIST_COLUMNS, ASSET_DETAIL_COLUMNS, shapeAsset, shapeAssetDetail, readAssetFields, checkTypeRules,
  checkLocationRoom, checkDuplicateSerial, botActorLabel, logAssetHistory,
} from '../../../../../../lib/botTracker'

export const runtime = 'nodejs'

// Comma list → canonical values (case-insensitive), or { bad } for the first unknown one.
function listParam(raw, allowed) {
  const out = []
  for (const part of String(raw).split(',').map(s => s.trim()).filter(Boolean)) {
    const hit = allowed.find(v => v.toLowerCase() === part.toLowerCase())
    if (!hit) return { bad: part }
    if (!out.includes(hit)) out.push(hit)
  }
  return { values: out }
}

export async function GET(req) {
  const auth = await requireBotScope(req, 'assets:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  let statuses = null
  if (sp.get('status')?.trim()) {
    const r = listParam(sp.get('status'), ASSET_STATUSES)
    if (r.bad) {
      return botFail(auth, req, 400, 'invalid_param',
        `Unknown status '${r.bad}'. Use one or more of ${ASSET_STATUSES.join(', ')} (comma-separated).`)
    }
    statuses = r.values
  }
  let types = null
  if (sp.get('type')?.trim()) {
    const r = listParam(sp.get('type'), ASSET_TYPE_VALUES)
    if (r.bad) {
      return botFail(auth, req, 400, 'invalid_param',
        `Unknown type '${r.bad}'. Use one or more of ${ASSET_TYPE_VALUES.join(', ')} (comma-separated).`)
    }
    types = r.values
  }
  const employeeId = sp.get('employee_id')?.trim() || null
  const locationId = sp.get('location_id')?.trim() || null
  if (employeeId && !isUuid(employeeId)) return botFail(auth, req, 400, 'invalid_param', "'employee_id' must be a uuid.")
  if (locationId && !isUuid(locationId)) return botFail(auth, req, 400, 'invalid_param', "'location_id' must be a uuid.")
  const q = searchTerm(sp)
  const limit = intParam(sp, 'limit', 25, 1, 100)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)

  let query = admin
    .from('assets')
    .select(ASSET_LIST_COLUMNS, { count: 'exact' })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (statuses) query = query.in('status', statuses)
  else query = query.neq('status', 'Disposed')
  if (types) query = query.in('type', types)
  if (employeeId) query = query.eq('assigned_employee_id', employeeId)
  if (locationId) query = query.eq('location_id', locationId)
  if (q) {
    query = query.or(['name', 'serial_number', 'asset_tag', 'hostname', 'assigned_to']
      .map(c => `${c}.ilike.*${q}*`).join(','))
  }

  const { data, count, error } = await query
  if (error) {
    console.error('bot assets list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load assets.')
  }

  const assets = (data || []).map(shapeAsset)
  return botJson(auth, req, {
    data: assets,
    pagination: { limit, offset, total: count ?? null },
    filters: {
      status: statuses || 'all except Disposed', type: types, employee_id: employeeId, location_id: locationId, q: q || null,
    },
  }, { count: assets.length })
}

export async function POST(req) {
  const auth = await requireBotWrite(req, 'assets:write', { targetType: 'asset' })
  if (auth.error) return auth.error
  const { admin, actor } = auth

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    const { fields, allowDuplicateSerial } = readAssetFields(body, { create: true })
    checkTypeRules(fields)
    const { location, room } = await checkLocationRoom(admin, fields)
    await checkDuplicateSerial(admin, fields.serial_number, { allow: allowDuplicateSerial })

    const idem = await requireIdempotencyKey(auth, req)
    if (idem.error) return idem.error

    // Every allow-listed column is written (absent → null), like AssetModal's
    // record. asset_tag comes from the column default; rack fields stay off.
    const row = {
      name: fields.name,
      category: fields.category,
      type: fields.type ?? null,
      status: fields.status ?? 'Pending',
      serial_number: fields.serial_number ?? null,
      make: fields.make ?? null,
      model: fields.model ?? null,
      purchase_date: fields.purchase_date ?? null,
      warranty_expiry: fields.warranty_expiry ?? null,
      location_id: fields.location_id ?? null,
      room_id: fields.room_id ?? null,
      hostname: fields.hostname ?? null,
      ip_address: fields.ip_address ?? null,
      os: fields.os ?? null,
      cpu: fields.cpu ?? null,
      ram: fields.ram ?? null,
      storage: fields.storage ?? null,
      management_url: fields.management_url ?? null,
      rack_mountable: false,
      notes: fields.notes ?? null,
      updated_at: new Date().toISOString(),
    }

    if (auth.dryRun) {
      const wouldBe = shapeAssetDetail({ ...row, id: null, asset_tag: null, location_obj: location, room })
      return botWriteJson(auth, req, { data: wouldBe, dry_run: true }, { summary: ctx.summary })
    }

    return runWrite(auth, req, { route: 'POST /tracker/assets', body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: asset, error } = await admin.from('assets').insert(row).select(ASSET_DETAIL_COLUMNS).single()
      if (error) {
        console.error('bot asset create:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not create the asset.' } }
      }
      await logAssetHistory(admin, actor, asset.id, 'created', `Asset "${asset.name}" added by ${botActorLabel(actor)}`)
      return { status: 201, body: { data: shapeAssetDetail(asset) }, targetIds: [String(asset.id)] }
    })
  })
}
