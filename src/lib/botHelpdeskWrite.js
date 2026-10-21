// Validation for the Help Desk / KB bot WRITE routes (server-only). The bot API
// writes through the service role, so RLS protects nothing here: every body is
// allow-listed, every enum/length checked, every reference looked up before
// anything is written (and before a dry run answers).
//
// Validators throw a WriteRejection; routes wrap their pre-write work in
// withValidation(), which turns it into a logged botWriteFail response.
import { after } from 'next/server'
import { botWriteFail, summarizeBody } from './botAuth'
import { CATEGORY_OPTIONS, PRIORITY_ORDER } from './helpdesk'
import {
  KB_DETAIL_COLUMNS, KB_LIST_COLUMNS, findKbArticle, findTicket, isUuid, shapeKbArticle, shapeKbSummary,
} from './botHelpdesk'
import { isMailboxAddress, sendAssignedEmail } from './helpdeskNotify'

export const TICKET_PRIORITIES = PRIORITY_ORDER
export const CATEGORY_IDS = CATEGORY_OPTIONS.map(c => c.id)
export const LIMITS = { title: 200, text: 10_000, kbBody: 50_000, tags: 20, tag: 50 }

export const COMMENT_COLUMNS = 'id, body, is_internal, created_at, author:author_id(id, full_name, email)'
export const KB_DRAFT_LIST_COLUMNS = `${KB_LIST_COLUMNS}, status, via_client_id`
export const KB_DRAFT_DETAIL_COLUMNS = `${KB_DETAIL_COLUMNS}, status, via_client_id`

// Draft KB shapes: the published shapes plus status + whether a bot wrote it.
export const shapeKbDraftSummary = a => shapeKbSummary(a, { status: a.status, created_by_bot: !!a.via_client_id })
export const shapeKbDraft = a => ({ ...shapeKbArticle(a), status: a.status, created_by_bot: !!a.via_client_id })

// The one email a bot write may cause: "assigned to you" to the (validated)
// new assignee, after the response, only once the DB write succeeded. Never
// call this on a dry run.
export function scheduleAssignedEmail(admin, ticketId) {
  after(async () => {
    const r = await sendAssignedEmail(admin, ticketId)
    if (r.error) console.error(`bot assigned email (ticket ${ticketId}):`, r.error)
  })
}

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

const invalid = message => reject(400, 'invalid_param', message)

function dbFail(where, error) {
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

// Unknown keys → 400 listing them. `forbidden` = known-but-refused keys with
// their own message (e.g. status on a KB create).
export function allowKeys(body, allowed, forbidden = {}) {
  const keys = Object.keys(body)
  const refused = keys.find(k => k in forbidden)
  if (refused) invalid(forbidden[refused])
  const unknown = keys.filter(k => !allowed.includes(k))
  if (unknown.length) invalid(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`)
}

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key)

// Trimmed string field. Absent → undefined; required/blank/too long → 400.
export function strField(body, key, { required = false, max }) {
  if (!has(body, key) || body[key] === null) {
    if (required) invalid(`'${key}' is required.`)
    if (body[key] === null) invalid(`'${key}' can't be null.`)
    return undefined
  }
  if (typeof body[key] !== 'string') invalid(`'${key}' must be a string.`)
  const v = body[key].trim()
  if (!v) invalid(`'${key}' can't be blank.`)
  if (v.length > max) invalid(`'${key}' is too long (max ${max} characters).`)
  return v
}

export function enumField(body, key, values) {
  if (!has(body, key)) return undefined
  if (!values.includes(body[key])) invalid(`'${key}' must be one of ${values.join(', ')}.`)
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

// Array of strings, trimmed, blanks dropped, de-duplicated; ≤20, each ≤50 chars.
export function tagsField(body, key = 'tags') {
  if (!has(body, key)) return undefined
  const v = body[key]
  if (!Array.isArray(v) || v.some(t => typeof t !== 'string')) invalid(`'${key}' must be an array of strings.`)
  const tags = [...new Set(v.map(t => t.trim()).filter(Boolean))]
  if (tags.length > LIMITS.tags) invalid(`'${key}' allows at most ${LIMITS.tags} tags.`)
  const long = tags.find(t => t.length > LIMITS.tag)
  if (long) invalid(`Tag '${long.slice(0, 60)}…' is too long (max ${LIMITS.tag} characters).`)
  return tags
}

// ---- Lookups ---------------------------------------------------------------

// The route's {id}: 400 malformed, 404 missing, 500 on DB error.
export async function loadTicket(admin, rawId, columns) {
  const r = await findTicket(admin, rawId, columns)
  if (r.invalid) invalid('Ticket id must be a uuid or a ticket number.')
  if (r.error) dbFail('bot ticket lookup', r.error)
  if (!r.ticket) reject(404, 'not_found', 'Ticket not found.')
  return r.ticket
}

// A ticket referenced from a body field (e.g. ticket_id on a KB create): 400 when missing.
export async function loadReferencedTicket(admin, key, raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') invalid(`'${key}' must be a ticket uuid or number.`)
  const r = await findTicket(admin, raw, 'id, number')
  if (r.invalid) invalid(`'${key}' must be a ticket uuid or number.`)
  if (r.error) dbFail('bot ticket ref lookup', r.error)
  if (!r.ticket) invalid(`'${key}' doesn't match a ticket.`)
  return r.ticket
}

export async function loadKbArticle(admin, rawId, columns, opts) {
  const r = await findKbArticle(admin, rawId, columns, opts)
  if (r.invalid) invalid('Article id must be a uuid or a slug.')
  if (r.error) dbFail('bot kb lookup', r.error)
  if (!r.article) reject(404, 'not_found', 'Article not found.')
  return r.article
}

export async function loadKbCategory(admin, categoryId) {
  const { data, error } = await admin.from('kb_categories').select('id, name, slug').eq('id', categoryId).maybeSingle()
  if (error) dbFail('bot kb category lookup', error)
  if (!data) invalid("'category_id' doesn't match a KB category.")
  return data
}

// Assignee must be an agent (profiles.role = 'admin', same as is_agent()) and
// not one whose "assigned to you" email would loop back into a mailbox the app
// reads, or land on the bot's own acting profile. → { id, full_name, email }.
export async function validateAssignee(admin, auth, assigneeId) {
  if (!isUuid(assigneeId)) invalid("'assignee_id' must be a uuid or null.")
  const { data: p, error } = await admin
    .from('profiles').select('id, full_name, email, role').eq('id', assigneeId).maybeSingle()
  if (error) dbFail('bot assignee lookup', error)
  const refuse = why => reject(422, 'invalid_assignee', why)
  if (!p) refuse("'assignee_id' doesn't match a profile.")
  if (p.role !== 'admin') refuse('The assignee must be a Help Desk agent (an admin profile).')
  const email = String(p.email || '').trim().toLowerCase()
  const actorEmail = String(auth.actor.email || '').trim().toLowerCase()
  if (p.id === auth.actor.id || (email && email === actorEmail)) {
    refuse("Can't assign a ticket to this API client's own acting profile.")
  }
  if (isMailboxAddress(email)) {
    refuse("Can't assign a ticket to a mailbox profile (its assignment email would come back in as a new ticket).")
  }
  return { id: p.id, full_name: p.full_name, email: p.email }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// requester_id (must be a profile) or requester_email (lowercased; mapped to a
// profile by email like createEmailTicket(), else kept raw with no profile).
// → { requester_id, requester_email, requester (profile or null) }.
export async function resolveRequester(admin, body) {
  const hasId = has(body, 'requester_id') && body.requester_id !== null
  const hasEmail = has(body, 'requester_email') && body.requester_email !== null
  if (hasId && hasEmail) invalid("Send 'requester_id' or 'requester_email', not both.")
  if (!hasId && !hasEmail) invalid("'requester_email' or 'requester_id' is required.")

  if (hasId) {
    const id = uuidField(body, 'requester_id')
    const { data: p, error } = await admin.from('profiles').select('id, full_name, email').eq('id', id).maybeSingle()
    if (error) dbFail('bot requester lookup', error)
    if (!p) invalid("'requester_id' doesn't match a profile.")
    return { requester_id: p.id, requester_email: null, requester: p }
  }

  const email = strField(body, 'requester_email', { max: 320 }).toLowerCase()
  if (!EMAIL_RE.test(email)) invalid("'requester_email' must be an email address.")
  // ilike for a case-insensitive match; escape its wildcards (_ is common in addresses).
  const { data: p, error } = await admin
    .from('profiles').select('id, full_name, email').ilike('email', email.replace(/[\\%_]/g, '\\$&')).limit(1).maybeSingle()
  if (error) dbFail('bot requester email lookup', error)
  return { requester_id: p?.id || null, requester_email: email, requester: p || null }
}
