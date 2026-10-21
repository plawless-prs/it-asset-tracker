// Admin-only bot API key management (called by /admin with the admin's Bearer
// token). Keys are generated here; only their SHA-256 hash + a display prefix
// are stored, and the plain key is returned exactly once (create / rotate).
//
//   GET                                   -> { clients, available_scopes, scope_info,
//                                              profiles, mailbox_emails }  (never the hash)
//   POST  { name, scopes? }               -> { client, key }
//   PATCH { id, action: 'deactivate' | 'activate' | 'rotate' }
//                                         -> { client } (+ key on rotate)
//   PATCH { id, action: 'set_scopes', scopes: [...] }            -> { client }
//   PATCH { id, action: 'set_acting_profile', profile_id|null }  -> { client }
import { requireAdmin } from '../../../../lib/apiAuth'
import { BOT_SCOPES, BOT_SCOPE_INFO, generateApiKey } from '../../../../lib/botAuth'

export const runtime = 'nodejs'

const CLIENT_COLUMNS = 'id, name, key_prefix, scopes, active, created_at, last_used_at, acting_profile_id'
const LEGACY_CLIENT_COLUMNS = 'id, name, key_prefix, scopes, active, created_at, last_used_at' // before migration 22

// Run a query with the full column list; if migration 22 hasn't been run
// (42703 = undefined column), retry without acting_profile_id so the list and
// the kill switch keep working. Each query is a single statement, so a failed
// first attempt changed nothing.
async function withColumns(run) {
  const res = await run(CLIENT_COLUMNS)
  return res.error?.code === '42703' ? run(LEGACY_CLIENT_COLUMNS) : res
}

async function audit(admin, actorId, action, detail) {
  // Best effort — an audit hiccup shouldn't undo the key change.
  const { error } = await admin.from('audit_log').insert({ action, entity_type: 'api_client', detail, user_id: actorId })
  if (error) console.error('admin/api-clients audit_log:', error.message)
}

function mailboxEmails() {
  return [process.env.IT_MAILBOX, process.env.PRICEUPDATE_MAILBOX]
    .map(v => String(v || '').trim().toLowerCase())
    .filter(Boolean)
}

function profileLabel(p) {
  return `"${p.full_name || p.email || p.id}"`
}

export async function GET(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { admin } = auth
  const [{ data, error }, { data: profiles, error: pErr }] = await Promise.all([
    withColumns(cols => admin.from('api_clients').select(cols).order('created_at', { ascending: true })),
    admin.from('profiles').select('id, full_name, email, role').order('full_name', { ascending: true }),
  ])
  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })
  return Response.json({
    clients: data || [],
    available_scopes: BOT_SCOPES,
    scope_info: BOT_SCOPE_INFO,
    profiles: profiles || [],
    mailbox_emails: mailboxEmails(),
  })
}

export async function POST(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { admin, user: actor } = auth

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const name = String(body?.name || '').trim()
  if (!name || name.length > 80) return Response.json({ error: 'Name is required (max 80 characters)' }, { status: 400 })
  const scopes = Array.isArray(body?.scopes) && body.scopes.length ? [...new Set(body.scopes.map(String))] : ['helpdesk:read']
  const unknown = scopes.filter(s => !BOT_SCOPES.includes(s))
  if (unknown.length) return Response.json({ error: `Unknown scope: ${unknown[0]}` }, { status: 400 })

  const { key, prefix, hash } = generateApiKey()
  const { data: client, error } = await withColumns(cols => admin
    .from('api_clients')
    .insert({ name, key_prefix: prefix, key_hash: hash, scopes })
    .select(cols)
    .single())
  if (error) {
    if (error.code === '23505') return Response.json({ error: `An API client named "${name}" already exists` }, { status: 409 })
    return Response.json({ error: error.message }, { status: 500 })
  }

  await audit(admin, actor.id, 'created', `API client "${name}" created (${prefix}…, scopes: ${scopes.join(', ')})`)
  return Response.json({ client, key })
}

export async function PATCH(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { admin, user: actor } = auth

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const id = String(body?.id || '')
  const action = body?.action
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  if (!['deactivate', 'activate', 'rotate', 'set_scopes', 'set_acting_profile'].includes(action)) {
    return Response.json({ error: 'unknown action' }, { status: 400 })
  }

  const { data: existing } = await withColumns(cols => admin.from('api_clients').select(cols).eq('id', id).maybeSingle())
  if (!existing) return Response.json({ error: 'API client not found' }, { status: 404 })

  let patch, key, detail
  if (action === 'rotate') {
    const gen = generateApiKey()
    key = gen.key
    patch = { key_prefix: gen.prefix, key_hash: gen.hash }
  } else if (action === 'set_scopes') {
    if (!Array.isArray(body?.scopes)) return Response.json({ error: 'scopes must be an array' }, { status: 400 })
    const requested = [...new Set(body.scopes.map(String))]
    const unknown = requested.filter(s => !BOT_SCOPES.includes(s))
    if (unknown.length) return Response.json({ error: `Unknown scope: ${unknown[0]}` }, { status: 400 })
    if (!requested.length) return Response.json({ error: 'At least one scope is required (deactivate the key to switch it off)' }, { status: 400 })
    const scopes = BOT_SCOPES.filter(s => requested.includes(s)) // canonical order
    patch = { scopes }
    detail = `API client "${existing.name}" scopes: ${(existing.scopes || []).join(', ') || 'none'} → ${scopes.join(', ')}`
  } else if (action === 'set_acting_profile') {
    if (!('acting_profile_id' in existing)) {
      return Response.json({ error: 'Run migration 22_bot_api_writes.sql first' }, { status: 409 })
    }
    const profileId = body?.profile_id ? String(body.profile_id) : null
    const ids = [existing.acting_profile_id, profileId].filter(Boolean)
    const { data: found, error: fErr } = ids.length
      ? await admin.from('profiles').select('id, full_name, email').in('id', ids)
      : { data: [] }
    if (fErr) return Response.json({ error: fErr.message }, { status: 500 })
    const byId = new Map((found || []).map(p => [p.id, p]))
    if (profileId && !byId.has(profileId)) return Response.json({ error: 'Profile not found' }, { status: 400 })
    patch = { acting_profile_id: profileId }
    const label = pid => (pid ? profileLabel(byId.get(pid) || { id: pid }) : 'none')
    detail = `API client "${existing.name}" acts as: ${label(existing.acting_profile_id)} → ${label(profileId)}`
  } else {
    patch = { active: action === 'activate' }
  }

  const { data: client, error } = await withColumns(cols => admin
    .from('api_clients').update(patch).eq('id', id).select(cols).single())
  if (error) return Response.json({ error: error.message }, { status: 500 })

  if (action === 'rotate') {
    detail = `API client "${existing.name}" key rotated (new key ${client.key_prefix}…; old key stops working immediately)`
  } else if (action === 'activate' || action === 'deactivate') {
    detail = `API client "${existing.name}" ${action}d`
  }
  await audit(admin, actor.id, 'updated', detail)
  return Response.json(key ? { client, key } : { client })
}
