// Auth for the bot API (/api/bot/v1/*). Server-only — pulls in the
// service-role client; never import into a client component.
//
// Bots send a per-client API key as `Authorization: Bearer <key>`. Keys live in
// `api_clients` as a SHA-256 hash (plus a short display prefix) with a list of
// scopes; the plain key is shown once at creation/rotation (/admin) and never
// stored. Every call is logged to `api_client_calls` (not audit_log).
//
// Usage (route handler):
//   const auth = await requireBotScope(req, 'helpdesk:read')
//   if (auth.error) return auth.error
//   ...
//   return botJson(auth, req, { data }, { count: rows.length })
//
// Rate limit: 60 requests/min per key, counted IN MEMORY PER SERVER INSTANCE.
// Vercel can run several instances at once (and cold starts reset the
// counter), so the effective ceiling is 60 × live instances — fine for a
// friendly internal bot, not a hard guarantee. Move to a shared store if that
// ever matters.
import { createHash, randomBytes } from 'crypto'
import { after } from 'next/server'
import { safeEqual } from './apiAuth'
import { createAdminClient } from './supabaseAdmin'

// Every scope a key can be granted. Admin key creation validates against this.
export const BOT_SCOPES = ['helpdesk:read']

const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const hits = new Map() // client id -> request timestamps within the window

export function hashApiKey(key) {
  return createHash('sha256').update(String(key)).digest('hex')
}

// New random key: `prs_` + 32 random bytes (base64url). `prefix` is what the
// admin list shows so a key can be identified without revealing it.
export function generateApiKey() {
  const key = `prs_${randomBytes(32).toString('base64url')}`
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) }
}

export function botError(status, code, message, headers) {
  return Response.json({ error: { code, message } }, { status, headers })
}

function overRateLimit(clientId) {
  const now = Date.now()
  const recent = (hits.get(clientId) || []).filter(t => now - t < RATE_WINDOW_MS)
  const limited = recent.length >= RATE_LIMIT
  if (!limited) recent.push(now)
  hits.set(clientId, recent)
  return limited
}

// Compact, loggable summary of the request: query params + any route params.
function paramsSummary(req, extra) {
  const out = {}
  for (const [k, v] of new URL(req.url).searchParams) out[k] = String(v).slice(0, 200)
  return { ...out, ...extra }
}

// Best-effort, after the response is sent — a logging hiccup never fails a call.
function logCall(admin, client, req, status, { count = null, params } = {}) {
  const row = {
    client_id: client.id,
    client_name: client.name,
    method: req.method,
    route: new URL(req.url).pathname,
    params: paramsSummary(req, params),
    status,
    result_count: count,
  }
  after(async () => {
    const { error } = await admin.from('api_client_calls').insert(row)
    if (error) console.error('api_client_calls insert:', error.message)
  })
}

// Returns { client, admin } on success, or { error: Response }:
// 401 missing/unknown/inactive key, 429 over the rate limit, 403 key lacks
// the scope. `admin` is the service-role client for the route to reuse.
export async function requireBotScope(req, scope) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!key) return { error: botError(401, 'unauthorized', 'Missing API key (Authorization: Bearer <key>).') }

  const admin = createAdminClient()
  const hash = hashApiKey(key)
  const { data: client, error } = await admin
    .from('api_clients')
    .select('id, name, key_hash, scopes, active')
    .eq('key_hash', hash)
    .maybeSingle()
  if (error) {
    console.error('requireBotScope lookup:', error.message)
    return { error: botError(500, 'internal_error', 'Could not verify API key.') }
  }
  if (!client || !client.active || !safeEqual(client.key_hash, hash)) {
    return { error: botError(401, 'unauthorized', 'Invalid or inactive API key.') }
  }

  if (overRateLimit(client.id)) {
    logCall(admin, client, req, 429)
    return { error: botError(429, 'rate_limited', `Rate limit is ${RATE_LIMIT} requests per minute.`, { 'Retry-After': '60' }) }
  }
  if (!Array.isArray(client.scopes) || !client.scopes.includes(scope)) {
    logCall(admin, client, req, 403)
    return { error: botError(403, 'forbidden', `API key lacks the '${scope}' scope.`) }
  }

  after(async () => {
    const { error: uErr } = await admin
      .from('api_clients').update({ last_used_at: new Date().toISOString() }).eq('id', client.id)
    if (uErr) console.error('api_clients last_used_at:', uErr.message)
  })

  return { client, admin }
}

// Success response + call log. `count` = rows returned; `params` = extra
// values worth logging (e.g. the route's [id]).
export function botJson(auth, req, body, { status = 200, count = null, params } = {}) {
  logCall(auth.admin, auth.client, req, status, { count, params })
  return Response.json(body, { status })
}

// Error response after auth succeeded (bad param, not found, DB error) + call log.
export function botFail(auth, req, status, code, message, params) {
  logCall(auth.admin, auth.client, req, status, { params })
  return botError(status, code, message)
}
