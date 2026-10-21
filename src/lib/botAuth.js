// Auth for the bot API (/api/bot/v1/*). Server-only — pulls in the
// service-role client; never import into a client component.
//
// Bots send a per-client API key as `Authorization: Bearer <key>`. Keys live in
// `api_clients` as a SHA-256 hash (plus a short display prefix) with a list of
// scopes; the plain key is shown once at creation/rotation (/admin) and never
// stored. Every call is logged to `api_client_calls` (not audit_log).
//
// Usage (read route):
//   const auth = await requireBotScope(req, 'helpdesk:read')
//   if (auth.error) return auth.error
//   ...
//   return botJson(auth, req, { data }, { count: rows.length })
//
// Usage (write route — see "Writes" below for the full pattern):
//   const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'ticket' })
//   if (auth.error) return auth.error
//
// Rate limit: 60 requests/min per key, counted IN MEMORY PER SERVER INSTANCE.
// Vercel can run several instances at once (and cold starts reset the
// counter), so the effective ceiling is 60 × live instances — fine for a
// friendly internal bot, not a hard guarantee. Writes additionally get a
// DB-backed limit (shared across instances) — see requireBotWrite.
import { createHash, randomBytes } from 'crypto'
import { after } from 'next/server'
import { safeEqual } from './apiAuth'
import { createAdminClient } from './supabaseAdmin'

// Every scope a key can be granted. Admin key creation/editing validates
// against this. Scopes whose routes haven't shipped yet grant nothing until
// their PR lands (granting one early is harmless).
export const BOT_SCOPES = [
  'helpdesk:read', 'helpdesk:write', 'kb:write',
  'assets:read', 'assets:write',
  'dailyops:read', 'dailyops:write',
  'pricing:read', 'pricing:write',
]

// One-line descriptions for the /admin scope checkboxes.
export const BOT_SCOPE_INFO = {
  'helpdesk:read': 'Read tickets (incl. internal notes) and published KB articles',
  'helpdesk:write': 'Create/update tickets, add internal notes, link KB articles',
  'kb:write': 'Create and edit draft KB articles (never publish)',
  'assets:read': 'Read assets, employees and locations',
  'assets:write': 'Create/update assets, check out / check in',
  'dailyops:read': "Read today's checklists and tasks",
  'dailyops:write': 'Create/update tasks, check off checklist items',
  'pricing:read': 'Read price batches, lines, vendors and worker status',
  'pricing:write': 'Stage price batches only (create, upload, match, include/exclude) — never approve/export',
}

export const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const hits = new Map() // client id -> request timestamps within the window

// DB-backed write limits (counted from api_client_calls, so shared across
// instances). 429 rows are logged but not counted, so a retry loop can't
// extend its own lockout.
export const WRITE_LIMIT_MINUTE = 20
export const WRITE_LIMIT_DAY = 500

const CLIENT_COLUMNS = 'id, name, key_hash, scopes, active, acting_profile_id'
const LEGACY_CLIENT_COLUMNS = 'id, name, key_hash, scopes, active' // before migration 22

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

function callRow(client, req, status, { count = null, params } = {}) {
  return {
    client_id: client.id,
    client_name: client.name,
    method: req.method,
    route: new URL(req.url).pathname,
    params: paramsSummary(req, params),
    status,
    result_count: count,
  }
}

// Best-effort, after the response is sent — a logging hiccup never fails a call.
function logCall(admin, client, req, status, opts) {
  const row = callRow(client, req, status, opts)
  after(async () => {
    const { error } = await admin.from('api_client_calls').insert(row)
    if (error) console.error('api_client_calls insert:', error.message)
  })
}

// Pass scope = null to accept any active key (see requireBotClient).
// Returns { client, admin } on success, or { error: Response }:
// 401 missing/unknown/inactive key, 429 over the rate limit, 403 key lacks
// the scope. `admin` is the service-role client for the route to reuse.
export async function requireBotScope(req, scope) {
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!key) return { error: botError(401, 'unauthorized', 'Missing API key (Authorization: Bearer <key>).') }

  const admin = createAdminClient()
  const hash = hashApiKey(key)
  const lookup = cols => admin.from('api_clients').select(cols).eq('key_hash', hash).maybeSingle()
  let { data: client, error } = await lookup(CLIENT_COLUMNS)
  // 42703 = undefined column: migration 22 not run yet. Keep read keys working.
  if (error?.code === '42703') {
    ({ data: client, error } = await lookup(LEGACY_CLIENT_COLUMNS))
    if (client) client.acting_profile_id = null
  }
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
  if (scope !== null && (!Array.isArray(client.scopes) || !client.scopes.includes(scope))) {
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

// Any active key, no scope required (e.g. /whoami).
export function requireBotClient(req) {
  return requireBotScope(req, null)
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

// =============================================================================
// Writes
// =============================================================================
// Every write route follows this order:
//
//   const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'ticket' })
//   if (auth.error) return auth.error
//   const body = await readJson(...)                       // parse + allow-list validate (incl. lookups)
//   if (invalid) return botWriteFail(auth, req, 400, 'invalid_param', '…', { summary })
//   const idem = await requireIdempotencyKey(auth, req)    // creates; idempotencyKeyFrom() on PATCH
//   if (idem.error) return idem.error
//   const summary = summarizeBody(body)
//   if (auth.dryRun) return botWriteJson(auth, req, { data: wouldBe, dry_run: true }, { summary })
//   return runWrite(auth, req, { route: 'POST /helpdesk/tickets', body, idemKey: idem.key, summary }, async () => {
//     ...write (actor = auth.actor.id)...
//     if (failedBeforeAnythingWasCommitted) return { error: { status: 500, code: 'internal_error', message } }
//     return { status: 201, body: { data: row }, targetIds: [row.id] }
//   })
//
// runWrite = reserveIdempotency (replay / 422 conflict / 409 in-progress
// return early) → startWrite (log failure: release the key, return 500,
// write nothing) → write (error: release the key so the bot can retry,
// botWriteFail) → completeIdempotency → botWriteJson.
//
// Write routes must NEVER call sendNotify / sendGraphMail / /api/helpdesk/notify.
// The only email a bot write may cause is the "assigned to you" mail, via
// sendAssignedEmail() in src/lib/helpdeskNotify.js (scheduled with after()).

// Count this client's write calls since `sinceMs` ago (429s excluded).
export async function countWrites(admin, clientId, sinceMs) {
  const { count, error } = await admin
    .from('api_client_calls')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('is_write', true)
    .neq('status', 429)
    .gte('created_at', new Date(Date.now() - sinceMs).toISOString())
  return { count: count ?? 0, error }
}

function writeCallRow(auth, req, status, { targetType, targetIds, summary, idempotencyKey, count = null, params } = {}) {
  return {
    ...callRow(auth.client, req, status, { count, params }),
    is_write: true,
    target_type: targetType ?? auth.write?.targetType ?? null,
    target_ids: targetIds?.length ? targetIds.map(String) : null,
    request_summary: summary ?? null,
    idempotency_key: idempotencyKey ?? null,
  }
}

// Synchronous write-call log for responses that didn't go through startWrite
// (pre-write rejections, dry runs, replays). Nothing was written, so a log
// failure is reported but doesn't change the response.
async function logWriteCall(auth, req, status, opts) {
  const { error } = await auth.admin.from('api_client_calls').insert(writeCallRow(auth, req, status, opts))
  if (error) console.error('api_client_calls write insert:', error.message)
}

// Returns { client, admin, actor, dryRun, write } or { error: Response }.
// On top of requireBotScope: the client must have an acting profile (409
// not_configured otherwise) and be under the DB-backed write limits (429).
// `actor` = { id, full_name, email } — use actor.id for every author/actor column.
export async function requireBotWrite(req, scope, { targetType = null } = {}) {
  const auth = await requireBotScope(req, scope)
  if (auth.error) return auth
  const { admin, client } = auth
  const sp = new URL(req.url).searchParams
  const dryRun = ['1', 'true'].includes(String(sp.get('dry_run') || '').toLowerCase())
  const ctx = { ...auth, dryRun, write: { targetType, callId: null, req } }

  const notConfigured = 'This API client has no acting profile. An admin must set "Acts as" for it on /admin → Bot API clients.'
  if (!client.acting_profile_id) {
    await logWriteCall(ctx, req, 409)
    return { error: botError(409, 'not_configured', notConfigured) }
  }
  const { data: actor, error: pErr } = await admin
    .from('profiles').select('id, full_name, email').eq('id', client.acting_profile_id).maybeSingle()
  if (pErr) {
    console.error('requireBotWrite profile:', pErr.message)
    return { error: botError(500, 'internal_error', 'Could not load the acting profile.') }
  }
  if (!actor) {
    await logWriteCall(ctx, req, 409)
    return { error: botError(409, 'not_configured', notConfigured) }
  }

  const [minute, day] = await Promise.all([
    countWrites(admin, client.id, 60_000),
    countWrites(admin, client.id, 24 * 60 * 60_000),
  ])
  if (minute.error || day.error) {
    console.error('requireBotWrite rate count:', (minute.error || day.error).message)
    return { error: botError(500, 'internal_error', 'Could not check the write rate limit.') }
  }
  if (minute.count >= WRITE_LIMIT_MINUTE || day.count >= WRITE_LIMIT_DAY) {
    const perDay = day.count >= WRITE_LIMIT_DAY
    await logWriteCall(ctx, req, 429)
    return {
      error: botError(429, 'rate_limited',
        perDay ? `Write limit is ${WRITE_LIMIT_DAY} per 24 hours.` : `Write limit is ${WRITE_LIMIT_MINUTE} per minute.`,
        { 'Retry-After': perDay ? '3600' : '60' }),
    }
  }

  return { ...ctx, actor }
}

// Log the write as in-progress (status 102) BEFORE writing. Returns { callId }
// or { error: Response } — if the log can't be written, the route must return
// that error and not write.
export async function startWrite(auth, req, { targetType, summary, idempotencyKey } = {}) {
  const { data, error } = await auth.admin
    .from('api_client_calls')
    .insert(writeCallRow(auth, req, 102, { targetType, summary, idempotencyKey }))
    .select('id')
    .single()
  if (error || !data) {
    console.error('startWrite log insert:', error?.message)
    return { error: botError(500, 'internal_error', 'Could not log the write; nothing was changed.') }
  }
  auth.write.callId = data.id
  return { callId: data.id }
}

// Stamp the final outcome on the startWrite row. Never fails the response.
export async function finishWrite(auth, callId, { status, targetIds, count = null } = {}) {
  const patch = { status, result_count: count }
  if (targetIds?.length) patch.target_ids = targetIds.map(String)
  const { error } = await auth.admin.from('api_client_calls').update(patch).eq('id', callId)
  if (error) console.error('finishWrite log update:', error.message)
}

// Success response for a write route. After startWrite it finishes that log
// row; otherwise (dry run) it logs the call now, with summary.dry_run = true.
export async function botWriteJson(auth, req, body, { status = 200, targetIds, count = null, summary } = {}) {
  if (auth.write.callId) {
    await finishWrite(auth, auth.write.callId, { status, targetIds, count })
  } else {
    await logWriteCall(auth, req, status, {
      targetIds, count, summary: auth.dryRun ? { ...(summary || {}), dry_run: true } : summary,
    })
  }
  return Response.json(body, { status })
}

// Error response for a write route (validation, not found, DB error mid-write).
export async function botWriteFail(auth, req, status, code, message, { targetIds, summary, idempotencyKey, headers } = {}) {
  if (auth.write.callId) await finishWrite(auth, auth.write.callId, { status, targetIds })
  else await logWriteCall(auth, req, status, { targetIds, summary, idempotencyKey })
  return botError(status, code, message, headers)
}

// Compact, jsonb-safe summary of a request body for request_summary: top-level
// keys only, strings cut to 200 chars, arrays to 20 items, nested objects one
// level deep; anything named like a key/token/password/secret is dropped.
const SENSITIVE = /key|token|password|passwd|secret|credential/i
const STR_MAX = 200
const ARR_MAX = 20

function summarizeValue(v, depth) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v.length > STR_MAX ? `${v.slice(0, STR_MAX)}…` : v
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    const items = v.slice(0, ARR_MAX).map(x => summarizeValue(x, depth + 1))
    if (v.length > ARR_MAX) items.push(`…(+${v.length - ARR_MAX} more)`)
    return items
  }
  if (typeof v === 'object') {
    if (depth >= 2) return '[object]'
    const out = {}
    for (const [k, x] of Object.entries(v)) if (!SENSITIVE.test(k)) out[k] = summarizeValue(x, depth + 1)
    return out
  }
  return String(v).slice(0, STR_MAX)
}

export function summarizeBody(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { body: summarizeValue(obj, 0) }
  return summarizeValue(obj, 0)
}

// ---- Idempotency -----------------------------------------------------------
// A repeat with the same Idempotency-Key + same body replays the stored
// response; same key with a different body (or route) → 422. Keys are scoped
// per client. The key is RESERVED before writing (an api_idempotency row with
// status 0 = in progress; the PK makes the insert the lock), so a concurrent
// duplicate gets 409 idempotency_in_progress instead of writing twice. A
// reservation older than IDEM_STALE_MS (the request died mid-write) can be
// taken over. Rows can be cleaned up after 7 days (see migration 22).
const IDEM_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/
const IDEM_RESERVED = 0
const IDEM_STALE_MS = 2 * 60_000

// → { key } (key = null when the header is absent) or { invalid: true }.
export function readIdempotencyKey(req) {
  const raw = req.headers.get('idempotency-key')
  if (raw === null || raw.trim() === '') return { key: null }
  const key = raw.trim()
  return IDEM_KEY_RE.test(key) ? { key } : { invalid: true }
}

// → { key } or { error: Response } (logged). `required` for creates.
export async function idempotencyKeyFrom(auth, req, { required = false } = {}) {
  const r = readIdempotencyKey(req)
  if (r.invalid) {
    return { error: await botWriteFail(auth, req, 400, 'invalid_param', 'Idempotency-Key must be 1–200 characters of A-Z a-z 0-9 . _ : -') }
  }
  if (!r.key && required && !auth.dryRun) {
    return { error: await botWriteFail(auth, req, 400, 'idempotency_key_required', 'This endpoint requires an Idempotency-Key header.') }
  }
  return { key: r.key }
}

// Creates: Idempotency-Key is mandatory (except on dry runs).
export function requireIdempotencyKey(auth, req) {
  return idempotencyKeyFrom(auth, req, { required: true })
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  return `{${Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
}

export function hashRequest(body) {
  return createHash('sha256').update(stableStringify(body)).digest('hex')
}

async function replayResponse(auth, request, key, row) {
  await logWriteCall(auth, request, row.status, { idempotencyKey: key, summary: { replay: true } })
  return Response.json(row.response ?? {}, { status: row.status, headers: { 'Idempotent-Replay': 'true' } })
}

async function idempotencyFail(auth, request, key, kind) {
  if (kind === 'conflict') {
    return botWriteFail(auth, request, 422, 'idempotency_conflict',
      'This Idempotency-Key was already used with a different request. Use a new key.', { idempotencyKey: key })
  }
  if (kind === 'in_progress') {
    return botWriteFail(auth, request, 409, 'idempotency_in_progress',
      'A request with this Idempotency-Key is still being processed. Retry shortly.',
      { idempotencyKey: key, headers: { 'Retry-After': '5' } })
  }
  return botWriteFail(auth, request, 500, 'internal_error', 'Could not check the Idempotency-Key.', { idempotencyKey: key })
}

// Reserve the key before writing. → { reserved: true } (proceed, then
// completeIdempotency / releaseIdempotency), { reserved: false } (no key —
// proceed), { replay: Response }, or { error: Response } (422 conflict, 409
// in progress, 500). The request comes from requireBotWrite's context.
export async function reserveIdempotency(auth, key, route, requestHash, req) {
  if (!key) return { reserved: false }
  const request = req || auth.write.req
  const ids = { client_id: auth.client.id, idem_key: key }
  const { error: insErr } = await auth.admin.from('api_idempotency').insert({
    ...ids, route, request_hash: requestHash, status: IDEM_RESERVED, response: null,
  })
  if (!insErr) return { reserved: true }
  if (insErr.code !== '23505') {
    console.error('reserveIdempotency insert:', insErr.message)
    return { error: await idempotencyFail(auth, request, key, 'internal') }
  }

  const { data, error } = await auth.admin
    .from('api_idempotency')
    .select('route, request_hash, status, response, created_at')
    .match(ids)
    .maybeSingle()
  if (error) {
    console.error('reserveIdempotency read:', error.message)
    return { error: await idempotencyFail(auth, request, key, 'internal') }
  }
  // Released between our insert and read: the other request failed. Let the bot retry.
  if (!data) return { error: await idempotencyFail(auth, request, key, 'in_progress') }
  if (data.route !== route || data.request_hash !== requestHash) {
    return { error: await idempotencyFail(auth, request, key, 'conflict') }
  }
  if (data.status !== IDEM_RESERVED) return { replay: await replayResponse(auth, request, key, data) }

  if (Date.now() - new Date(data.created_at).getTime() < IDEM_STALE_MS) {
    return { error: await idempotencyFail(auth, request, key, 'in_progress') }
  }
  const cutoff = new Date(Date.now() - IDEM_STALE_MS).toISOString()
  // Stale reservation: take it over, unless another retry just beat us to it.
  const { data: taken, error: tErr } = await auth.admin
    .from('api_idempotency')
    .update({ created_at: new Date().toISOString() })
    .match({ ...ids, status: IDEM_RESERVED })
    .lt('created_at', cutoff)
    .select('idem_key')
  if (tErr) {
    console.error('reserveIdempotency takeover:', tErr.message)
    return { error: await idempotencyFail(auth, request, key, 'internal') }
  }
  if (!taken?.length) return { error: await idempotencyFail(auth, request, key, 'in_progress') }
  return { reserved: true }
}

// Early replay — call right after reading the body and Idempotency-Key, BEFORE
// any state-dependent validation (duplicate serial, not_checkoutable,
// not_draft, lookups whose answer changes once the first request succeeded).
// An exact repeat of a completed request (same key + route + body) gets the
// stored response with Idempotent-Replay: true; the same key with a different
// route/body gets 422 idempotency_conflict; a fresh reservation still in
// flight gets 409 idempotency_in_progress. Returns a Response, or null to
// carry on (no key, dry run, unknown key, stale reservation — runWrite's
// reserveIdempotency still guards the write itself).
// `route` is the same string later passed to runWrite, or an async function
// returning it (resolve a path id → canonical id; return null if not found).
export async function replayIfCompleted(auth, req, key, route, body) {
  if (!key || auth.dryRun) return null
  const { data, error } = await auth.admin
    .from('api_idempotency')
    .select('route, request_hash, status, response, created_at')
    .eq('client_id', auth.client.id)
    .eq('idem_key', key)
    .maybeSingle()
  if (error) {
    console.error('replayIfCompleted:', error.message)
    return null
  }
  if (!data) return null
  const resolved = typeof route === 'function' ? await route() : route
  if (!resolved || data.route !== resolved || data.request_hash !== hashRequest(body)) {
    return idempotencyFail(auth, req, key, 'conflict')
  }
  if (data.status === IDEM_RESERVED) {
    if (Date.now() - new Date(data.created_at).getTime() >= IDEM_STALE_MS) return null
    return idempotencyFail(auth, req, key, 'in_progress')
  }
  return replayResponse(auth, req, key, data)
}

// Store the final response on the reserved row for future replays.
export async function completeIdempotency(auth, key, status, response) {
  if (!key) return
  const { error } = await auth.admin
    .from('api_idempotency')
    .update({ status, response })
    .match({ client_id: auth.client.id, idem_key: key })
  if (error) console.error('completeIdempotency:', error.message)
}

// The write failed: drop the reservation so the bot can retry with the same key.
export async function releaseIdempotency(auth, key) {
  if (!key) return
  const { error } = await auth.admin
    .from('api_idempotency')
    .delete()
    .match({ client_id: auth.client.id, idem_key: key, status: IDEM_RESERVED })
  if (error) console.error('releaseIdempotency:', error.message)
}

// The reserve → log → write → complete sequence every write route shares.
// `write` runs only after the key is reserved and the call is logged. It
// returns { status, body, targetIds, count? } on success, or
// { error: { status, code, message }, targetIds? } when nothing was committed
// (the reservation is released so a retry with the same key can write).
export async function runWrite(auth, req, { route, body, idemKey, summary }, write) {
  const requestHash = hashRequest(body)
  const r = await reserveIdempotency(auth, idemKey, route, requestHash, req)
  if (r.error) return r.error
  if (r.replay) return r.replay

  const started = await startWrite(auth, req, { summary, idempotencyKey: idemKey })
  if (started.error) {
    await releaseIdempotency(auth, idemKey)
    return started.error
  }

  let result
  try {
    result = await write()
  } catch (e) {
    console.error(`${route} write:`, e)
    result = { error: { status: 500, code: 'internal_error', message: 'Unexpected error while writing.' } }
  }
  if (result.error) {
    await releaseIdempotency(auth, idemKey)
    const { status, code, message } = result.error
    return botWriteFail(auth, req, status, code, message, { targetIds: result.targetIds })
  }

  await completeIdempotency(auth, idemKey, result.status, result.body)
  return botWriteJson(auth, req, result.body, { status: result.status, targetIds: result.targetIds, count: result.count ?? 1 })
}

// Older check-then-write pair (PR 1), kept for compatibility. Not race-safe —
// new routes use reserveIdempotency / runWrite.
// → {} (proceed), { replay: Response }, or { error: Response }. No key → {}.
export async function checkIdempotency(auth, key, route, requestHash, req) {
  if (!key) return {}
  const request = req || auth.write.req
  const { data, error } = await auth.admin
    .from('api_idempotency')
    .select('route, request_hash, status, response')
    .eq('client_id', auth.client.id)
    .eq('idem_key', key)
    .maybeSingle()
  if (error) {
    console.error('checkIdempotency:', error.message)
    return { error: await idempotencyFail(auth, request, key, 'internal') }
  }
  if (!data) return {}
  if (data.route !== route || data.request_hash !== requestHash) {
    return { error: await idempotencyFail(auth, request, key, 'conflict') }
  }
  if (data.status === IDEM_RESERVED) return { error: await idempotencyFail(auth, request, key, 'in_progress') }
  return { replay: await replayResponse(auth, request, key, data) }
}

// Store the response for future replays. A duplicate key is ignored.
export async function saveIdempotency(auth, key, route, requestHash, status, response) {
  if (!key) return
  const { error } = await auth.admin.from('api_idempotency').upsert({
    client_id: auth.client.id, idem_key: key, route, request_hash: requestHash, status, response,
  }, { onConflict: 'client_id,idem_key', ignoreDuplicates: true })
  if (error) console.error('saveIdempotency:', error.message)
}
