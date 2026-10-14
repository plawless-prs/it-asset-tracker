// Admin-only bot API key management (called by /admin with the admin's Bearer
// token). Keys are generated here; only their SHA-256 hash + a display prefix
// are stored, and the plain key is returned exactly once (create / rotate).
//
//   GET                                   -> { clients: [...] }  (never the hash)
//   POST  { name, scopes? }               -> { client, key }
//   PATCH { id, action: 'deactivate' | 'activate' | 'rotate' }
//                                         -> { client } (+ key on rotate)
import { requireAdmin } from '../../../../lib/apiAuth'
import { BOT_SCOPES, generateApiKey } from '../../../../lib/botAuth'

export const runtime = 'nodejs'

const CLIENT_COLUMNS = 'id, name, key_prefix, scopes, active, created_at, last_used_at'

async function audit(admin, actorId, action, detail) {
  // Best effort — an audit hiccup shouldn't undo the key change.
  const { error } = await admin.from('audit_log').insert({ action, entity_type: 'api_client', detail, user_id: actorId })
  if (error) console.error('admin/api-clients audit_log:', error.message)
}

export async function GET(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { data, error } = await auth.admin
    .from('api_clients').select(CLIENT_COLUMNS).order('created_at', { ascending: true })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ clients: data || [], available_scopes: BOT_SCOPES })
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
  const { data: client, error } = await admin
    .from('api_clients')
    .insert({ name, key_prefix: prefix, key_hash: hash, scopes })
    .select(CLIENT_COLUMNS)
    .single()
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
  if (!['deactivate', 'activate', 'rotate'].includes(action)) return Response.json({ error: 'unknown action' }, { status: 400 })

  const { data: existing } = await admin.from('api_clients').select('id, name').eq('id', id).maybeSingle()
  if (!existing) return Response.json({ error: 'API client not found' }, { status: 404 })

  let patch, key
  if (action === 'rotate') {
    const gen = generateApiKey()
    key = gen.key
    patch = { key_prefix: gen.prefix, key_hash: gen.hash }
  } else {
    patch = { active: action === 'activate' }
  }

  const { data: client, error } = await admin
    .from('api_clients').update(patch).eq('id', id).select(CLIENT_COLUMNS).single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const detail = action === 'rotate'
    ? `API client "${existing.name}" key rotated (new key ${client.key_prefix}…; old key stops working immediately)`
    : `API client "${existing.name}" ${action}d`
  await audit(admin, actor.id, 'updated', detail)
  return Response.json(key ? { client, key } : { client })
}
