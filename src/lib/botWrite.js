// Module-agnostic validation helpers for the bot API WRITE routes (server-only).
// The bot API writes through the service role, so RLS protects nothing: every
// body is allow-listed, every enum/length checked, every reference looked up
// before anything is written (and before a dry run answers).
//
// Validators throw a WriteRejection; routes wrap their pre-write work in
// withValidation(), which turns it into a logged botWriteFail response.
// Module-specific validators live beside their module (botHelpdeskWrite.js,
// botTracker.js) and build on these. No email imports here — keep it that way.
import { botWriteFail, summarizeBody } from './botAuth'
import { isUuid } from './botHelpdesk'

export class WriteRejection extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function reject(status, code, message) {
  throw new WriteRejection(status, code, message)
}

export const invalid = message => reject(400, 'invalid_param', message)

export function dbFail(where, error) {
  console.error(`${where}:`, error.message)
  reject(500, 'internal_error', 'Database error while validating the request.')
}

// Runs fn(ctx); a WriteRejection becomes a logged error response (with the
// body summary, once readBody has set it). Anything else propagates.
export async function withValidation(auth, req, fn) {
  const ctx = { summary: null }
  try {
    return await fn(ctx)
  } catch (e) {
    if (!(e instanceof WriteRejection)) throw e
    return botWriteFail(auth, req, e.status, e.code, e.message, { summary: ctx.summary })
  }
}

// ---- Body shape ------------------------------------------------------------

export async function readBody(req, ctx) {
  let body
  try { body = await req.json() } catch { invalid('Body must be valid JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Body must be a JSON object.')
  ctx.summary = summarizeBody(body)
  return body
}

// Body that must be absent or `{}` (e.g. an action endpoint with no inputs).
export async function readEmptyBody(req, ctx) {
  let text
  try { text = await req.text() } catch { invalid('Could not read the request body.') }
  if (!text.trim()) {
    ctx.summary = {}
    return {}
  }
  let body
  try { body = JSON.parse(text) } catch { invalid('Body must be valid JSON (or empty).') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Body must be a JSON object (or empty).')
  ctx.summary = summarizeBody(body)
  const keys = Object.keys(body)
  if (keys.length) invalid(`This endpoint takes no body fields (got: ${keys.join(', ')}).`)
  return body
}

// Unknown keys → 400 listing them. `forbidden` = known-but-refused keys with
// their own message (e.g. status on a KB create).
export function allowKeys(body, allowed, forbidden = {}) {
  const keys = Object.keys(body)
  const refused = keys.find(k => k in forbidden)
  if (refused) invalid(forbidden[refused])
  const unknown = keys.filter(k => !allowed.includes(k))
  if (unknown.length) invalid(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`)
}

export const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key)

// Trimmed string field. Absent → undefined; required/blank/too long → 400.
// `nullable` → null or a blank string clears the field (returns null).
export function strField(body, key, { required = false, max, nullable = false }) {
  if (!has(body, key) || body[key] === null) {
    if (required) invalid(`'${key}' is required.`)
    if (body[key] === null) {
      if (nullable) return null
      invalid(`'${key}' can't be null.`)
    }
    return undefined
  }
  if (typeof body[key] !== 'string') invalid(`'${key}' must be a string${nullable ? ' or null' : ''}.`)
  const v = body[key].trim()
  if (!v) {
    if (nullable && !required) return null
    invalid(`'${key}' can't be blank.`)
  }
  if (v.length > max) invalid(`'${key}' is too long (max ${max} characters).`)
  return v
}

// `nullable` → null is accepted (clears the field).
export function enumField(body, key, values, { nullable = false } = {}) {
  if (!has(body, key)) return undefined
  if (body[key] === null && nullable) return null
  if (!values.includes(body[key])) invalid(`'${key}' must be one of ${values.join(', ')}${nullable ? ' (or null)' : ''}.`)
  return body[key]
}

// uuid field. `nullable` → null is accepted (e.g. unassign / clear category).
export function uuidField(body, key, { required = false, nullable = false } = {}) {
  if (!has(body, key)) {
    if (required) invalid(`'${key}' is required.`)
    return undefined
  }
  if (body[key] === null && nullable) return null
  if (!isUuid(body[key])) invalid(`'${key}' must be a uuid${nullable ? ' or null' : ''}.`)
  return String(body[key]).toLowerCase()
}

// Calendar date 'YYYY-MM-DD' (a real date — 2026-02-30 is refused).
export function dateField(body, key, { nullable = false } = {}) {
  if (!has(body, key)) return undefined
  if (body[key] === null && nullable) return null
  const v = typeof body[key] === 'string' ? body[key].trim() : ''
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (!d || d.toISOString().slice(0, 10) !== v) invalid(`'${key}' must be a date (YYYY-MM-DD)${nullable ? ' or null' : ''}.`)
  return v
}

export function boolField(body, key) {
  if (!has(body, key)) return undefined
  if (typeof body[key] !== 'boolean') invalid(`'${key}' must be true or false.`)
  return body[key]
}
