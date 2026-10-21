// Shared pieces for the IT Tracker bot routes (src/app/api/bot/v1/tracker/*):
// column lists, lookups, response shaping, and write-side validation.
//
// The bot API reads through the service role (RLS bypassed), so every select
// names exactly what may leave the building. Never exposed: cost/budget data
// (purchase_cost, useful_life_months, depreciation/book value, and nothing from
// purchases/budgets/licenses/subscriptions), photo_url, and employee notes /
// manager_id / profile_id. No email is ever sent from tracker routes.
import { ASSET_CATEGORIES, ASSET_STATUSES, ASSET_TYPE_VALUES, isComputerType } from './tracker'
import { cleanId, isUuid } from './botHelpdesk'
import {
  allowKeys, boolField, dateField, dbFail, enumField, has, invalid, reject, strField, uuidField,
} from './botWrite'

// ---- Columns ---------------------------------------------------------------

export const ASSET_LIST_COLUMNS = [
  'id', 'asset_tag', 'name', 'category', 'type', 'status', 'serial_number', 'make', 'model',
  'purchase_date', 'warranty_expiry', 'hostname', 'ip_address', 'os',
  'assigned_employee_id', 'assigned_to', 'assigned_date', 'location_id', 'room_id', 'rack_id',
  'rack_mountable', 'created_at', 'updated_at',
  'employee:employees(id, full_name)', 'location_obj:locations(id, name)',
  'room:rooms(id, name)', 'rack:racks(id, name)',
].join(', ')

export const ASSET_DETAIL_COLUMNS = [
  ASSET_LIST_COLUMNS,
  'cpu', 'ram', 'storage', 'management_url', 'u_position', 'u_height', 'watts', 'notes',
  'disposal_reason', 'disposal_date',
].join(', ')

export const EMPLOYEE_COLUMNS =
  'id, full_name, first_name, last_name, email, department, title, location_id, status, location:locations(id, name)'

export const EMPLOYEE_STATUSES = ['active', 'inactive']

// ---- Statuses the bot may set ----------------------------------------------

// Disposal and loss stay human decisions; assets in those states are read-only
// to the bot. 'Deployed' is only reachable through /checkout.
export const LOCKED_STATUSES = ['Disposed', 'Lost/Stolen']
export const BOT_ASSET_STATUSES = ASSET_STATUSES.filter(s => !LOCKED_STATUSES.includes(s))

export const COMPUTER_FIELDS = ['hostname', 'ip_address', 'os', 'cpu', 'ram', 'storage']

// ---- Lookups ---------------------------------------------------------------

// Asset by numeric id or asset tag (`PRS-00042`, case-insensitive).
// → { id, asset } (asset null = not found), { id, invalid: true }, or { id, error }.
export async function findAsset(admin, rawId, columns = ASSET_DETAIL_COLUMNS) {
  const id = cleanId(rawId)
  let query = admin.from('assets').select(columns)
  if (/^\d{1,18}$/.test(id)) query = query.eq('id', id)
  else if (/^prs-\d{1,12}$/i.test(id)) query = query.eq('asset_tag', id.toUpperCase())
  else return { id, invalid: true }
  const { data, error } = await query.maybeSingle()
  return error ? { id, error } : { id, asset: data || null }
}

// ---- Shaping ---------------------------------------------------------------

const ref = (obj, id) => (obj ? { id: obj.id, name: obj.name ?? obj.full_name ?? null } : id ? { id, name: null } : null)

export function shapeAsset(a) {
  return {
    id: a.id,
    asset_tag: a.asset_tag,
    name: a.name,
    category: a.category,
    type: a.type,
    status: a.status,
    serial_number: a.serial_number,
    make: a.make,
    model: a.model,
    purchase_date: a.purchase_date,
    warranty_expiry: a.warranty_expiry,
    hostname: a.hostname,
    ip_address: a.ip_address,
    os: a.os,
    // assigned_employee is the real assignment; assigned_to is the cached name
    // (may hold a legacy free-text value on rows that predate the employee FK).
    assigned_employee: ref(a.employee, a.assigned_employee_id),
    assigned_to: a.assigned_to,
    assigned_date: a.assigned_date,
    location: ref(a.location_obj, a.location_id),
    room: ref(a.room, a.room_id),
    rack: ref(a.rack, a.rack_id),
    rack_mountable: !!a.rack_mountable,
    created_at: a.created_at,
    updated_at: a.updated_at,
  }
}

export function shapeAssetDetail(a) {
  return {
    ...shapeAsset(a),
    cpu: a.cpu,
    ram: a.ram,
    storage: a.storage,
    management_url: a.management_url,
    u_position: a.u_position,
    u_height: a.u_height,
    watts: a.watts,
    notes: a.notes,
    disposal_reason: a.disposal_reason,
    disposal_date: a.disposal_date,
  }
}

export function shapeEmployee(e) {
  return {
    id: e.id,
    full_name: e.full_name,
    first_name: e.first_name,
    last_name: e.last_name,
    email: e.email,
    department: e.department,
    title: e.title,
    status: e.status,
    location: ref(e.location, e.location_id),
  }
}

// ---- Write validation ------------------------------------------------------

export const ASSET_WRITE_FIELDS = [
  'name', 'category', 'type', 'status', 'serial_number', 'make', 'model', 'purchase_date',
  'warranty_expiry', 'location_id', 'room_id', 'notes', ...COMPUTER_FIELDS, 'management_url',
  'allow_duplicate_serial',
]

const LIMITS = { name: 200, short: 200, url: 500, notes: 2000 }

// Known asset columns the bot may never set, with the reason.
function refusedFieldMessage(key) {
  if (key === 'asset_tag' || key === 'id') return `'${key}' is assigned automatically and can't be set.`
  if (key === 'purchase_cost' || key === 'useful_life_months') return 'Cost fields aren\'t available through the bot API.'
  if (key === 'photo_url') return 'Photos can\'t be set through the bot API.'
  if (/^(rack_|u_)/.test(key) || key === 'watts') return `'${key}': rack fields aren't supported through the bot API (rack placement stays on /tracker/racks).`
  if (key.startsWith('assigned_')) return `'${key}': assignment goes through POST /tracker/assets/{id}/checkout and /checkin.`
  if (key.startsWith('disposal_')) return `'${key}': disposal isn't available through the bot API.`
  return null
}

// Parse the create/PATCH body against the allow-list. → { fields, allowDuplicateSerial };
// fields[k] is undefined when absent, null when cleared. Status rules that need
// the current asset ('Deployed' via PATCH) are checked by the caller.
export function readAssetFields(body, { create }) {
  for (const k of Object.keys(body)) {
    const why = refusedFieldMessage(k)
    if (why) invalid(why)
  }
  allowKeys(body, ASSET_WRITE_FIELDS)

  if (has(body, 'status') && LOCKED_STATUSES.includes(body.status)) {
    reject(422, 'status_not_allowed', `The bot API can't set status '${body.status}' — disposal and loss stay a human action in IT Tracker.`)
  }
  const fields = {
    name: strField(body, 'name', { required: create, max: LIMITS.name }),
    category: create
      ? (enumField(body, 'category', ASSET_CATEGORIES) ?? invalid("'category' is required."))
      : enumField(body, 'category', ASSET_CATEGORIES),
    type: enumField(body, 'type', ASSET_TYPE_VALUES, { nullable: true }),
    status: enumField(body, 'status', BOT_ASSET_STATUSES),
    serial_number: strField(body, 'serial_number', { max: LIMITS.short, nullable: true }),
    make: strField(body, 'make', { max: LIMITS.short, nullable: true }),
    model: strField(body, 'model', { max: LIMITS.short, nullable: true }),
    purchase_date: dateField(body, 'purchase_date', { nullable: true }),
    warranty_expiry: dateField(body, 'warranty_expiry', { nullable: true }),
    location_id: uuidField(body, 'location_id', { nullable: true }),
    room_id: uuidField(body, 'room_id', { nullable: true }),
    notes: strField(body, 'notes', { max: LIMITS.notes, nullable: true }),
    management_url: strField(body, 'management_url', { max: LIMITS.url, nullable: true }),
  }
  for (const f of COMPUTER_FIELDS) fields[f] = strField(body, f, { max: LIMITS.short, nullable: true })
  if (create && fields.status === 'Deployed') {
    invalid("New assets can't start as 'Deployed' — create it, then assign it with POST /tracker/assets/{id}/checkout.")
  }
  return { fields, allowDuplicateSerial: boolField(body, 'allow_duplicate_serial') === true }
}

// Same type rule as AssetModal: computer fields only on computer types,
// management_url only on a set, non-computer type. Clearing (null) is always
// allowed. A type change never wipes existing values (the bot didn't ask to).
export function checkTypeRules(fields, current = {}) {
  const type = fields.type !== undefined ? fields.type : (current.type ?? null)
  const computer = isComputerType(type)
  const setComputer = COMPUTER_FIELDS.filter(f => fields[f] != null)
  if (setComputer.length && !computer) {
    invalid(`${setComputer.join(', ')} can only be set on a computer type (Laptop, Desktop, Server)${type ? ` — this asset's type is '${type}'` : ' — set a type'}.`)
  }
  if (fields.management_url != null && (!type || computer)) {
    invalid(`'management_url' is only for non-computer types${type ? ` — this asset's type is '${type}'` : ' — set a type'}.`)
  }
}

// Location must exist; room must exist and belong to the (effective) location.
// → { location, room } (the looked-up rows, or undefined when not touched).
export async function checkLocationRoom(admin, fields, current = {}) {
  const locationId = fields.location_id !== undefined ? fields.location_id : (current.location_id ?? null)
  let location, room
  if (fields.location_id) {
    const { data, error } = await admin.from('locations').select('id, name').eq('id', fields.location_id).maybeSingle()
    if (error) dbFail('bot location lookup', error)
    if (!data) invalid("'location_id' doesn't match a location.")
    location = data
  }
  if (fields.room_id) {
    if (!locationId) invalid("'room_id' needs a location — send 'location_id' too.")
    const { data, error } = await admin.from('rooms').select('id, name, location_id').eq('id', fields.room_id).maybeSingle()
    if (error) dbFail('bot room lookup', error)
    if (!data) invalid("'room_id' doesn't match a room.")
    if (data.location_id !== locationId) invalid("'room_id' belongs to a different location than 'location_id'.")
    room = data
  }
  return { location, room }
}

// A non-empty serial already on another non-Disposed asset → 409
// duplicate_serial (case-insensitive), unless the bot confirmed it.
export async function checkDuplicateSerial(admin, serial, { excludeId = null, allow = false } = {}) {
  if (!serial || allow) return
  let query = admin
    .from('assets')
    .select('id, asset_tag, name')
    .ilike('serial_number', serial.replace(/[\\%_]/g, '\\$&'))
    .neq('status', 'Disposed')
    .order('id')
    .limit(5)
  if (excludeId !== null) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) dbFail('bot serial lookup', error)
  if (data?.length) {
    const list = data.map(a => `${a.asset_tag || `#${a.id}`} "${a.name}"`).join(', ')
    reject(409, 'duplicate_serial',
      `Serial number '${serial}' is already on ${list}. Send "allow_duplicate_serial": true if this is intended.`)
  }
}

// The route's {id}: 400 malformed, 404 missing, 500 on DB error.
export async function loadAsset(admin, rawId, columns = ASSET_DETAIL_COLUMNS) {
  const r = await findAsset(admin, rawId, columns)
  if (r.invalid) invalid("Asset id must be a numeric id or an asset tag like 'PRS-00042'.")
  if (r.error) dbFail('bot asset lookup', r.error)
  if (!r.asset) reject(404, 'not_found', 'Asset not found.')
  return r.asset
}

// Disposed / Lost-Stolen assets are read-only to the bot.
export function assertNotLocked(asset) {
  if (LOCKED_STATUSES.includes(asset.status)) {
    reject(409, 'asset_locked', `This asset is '${asset.status}' — the bot API can't change it.`)
  }
}

// An active employee for checkout. → { id, full_name }.
export async function loadActiveEmployee(admin, employeeId) {
  if (!isUuid(employeeId)) invalid("'employee_id' must be a uuid.")
  const { data, error } = await admin
    .from('employees').select('id, full_name, status').eq('id', employeeId).maybeSingle()
  if (error) dbFail('bot employee lookup', error)
  if (!data) invalid("'employee_id' doesn't match an employee.")
  if (data.status !== 'active') reject(422, 'employee_inactive', `${data.full_name} is not an active employee.`)
  return { id: data.id, full_name: data.full_name }
}

// ---- History ---------------------------------------------------------------

// "<name> (bot)" for audit_log detail text, so IT Tracker History shows the
// write came from the bot (user_id = the acting profile).
export function botActorLabel(actor) {
  return `${actor.full_name || actor.email || 'API client'} (bot)`
}

// Same audit_log row the UI writes (assets/page.js logAction). Called after the
// asset write committed, so a failure is logged, never returned.
export async function logAssetHistory(admin, actor, assetId, action, detail) {
  const { error } = await admin.from('audit_log').insert({
    action, entity_type: 'asset', entity_id: assetId, detail, user_id: actor.id,
  })
  if (error) console.error(`bot asset audit_log (${action}, asset ${assetId}):`, error.message)
}
