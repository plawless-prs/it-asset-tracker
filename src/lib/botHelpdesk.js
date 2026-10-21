// Shared pieces for the Help Desk bot routes (src/app/api/bot/v1/helpdesk/*;
// write-side validation lives in botHelpdeskWrite.js). Explicit column lists only — the bot API
// reads through the service role (RLS bypassed), so every select must name
// exactly what may leave the building, and published-only / internal-comment
// filtering has to happen here, not in policies.
import { slaState } from './helpdesk'

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
export const DEFAULT_TICKET_STATUSES = ['open', 'in_progress', 'waiting']

export const TICKET_COLUMNS = [
  'id', 'number', 'title', 'description', 'status', 'priority', 'source', 'category',
  'requester_email', 'first_response_due', 'resolution_due', 'first_responded_at',
  'created_at', 'updated_at', 'resolved_at', 'closed_at',
  'requester:requester_id(id, full_name, email)',
  'assignee:assignee_id(id, full_name, email)',
].join(', ')

export const KB_LIST_COLUMNS = 'id, slug, title, body, tags, updated_at, published_at, category:category_id(name, slug)'
export const KB_DETAIL_COLUMNS = 'id, slug, title, body, tags, created_at, updated_at, published_at, category:category_id(name, slug)'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v) => UUID_RE.test(String(v || ''))

const baseUrl = () => process.env.APP_BASE_URL || 'https://www.prstech.app'

export function cleanId(raw) {
  const s = String(raw ?? '')
  try { return decodeURIComponent(s).trim() } catch { return s.trim() }
}

// Ticket by uuid or number (`1042` / `#1042`).
// → { id, ticket } (ticket null = not found), { id, invalid: true }, or { id, error }.
export async function findTicket(admin, rawId, columns = TICKET_COLUMNS) {
  const id = cleanId(rawId).replace(/^#/, '')
  let query = admin.from('tickets').select(columns)
  if (isUuid(id)) query = query.eq('id', id)
  else if (/^\d{1,18}$/.test(id)) query = query.eq('number', id)
  else return { id, invalid: true }
  const { data, error } = await query.maybeSingle()
  return error ? { id, error } : { id, ticket: data || null }
}

// KB article by uuid or slug, optionally restricted to one status.
// → { id, article }, { id, invalid: true }, or { id, error } (same as findTicket).
export async function findKbArticle(admin, rawId, columns, { status } = {}) {
  const id = cleanId(rawId)
  let query = admin.from('kb_articles').select(columns)
  if (status) query = query.eq('status', status)
  if (isUuid(id)) query = query.eq('id', id)
  else if (/^[a-z0-9-]{1,200}$/i.test(id)) query = query.eq('slug', id.toLowerCase())
  else return { id, invalid: true }
  const { data, error } = await query.maybeSingle()
  return error ? { id, error } : { id, article: data || null }
}

// Integer query param clamped to [min, max]; blank/garbage → fallback.
export function intParam(sp, name, fallback, min, max) {
  const n = parseInt(sp.get(name) ?? '', 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Free-text search term, safe to drop into a PostgREST or() filter (its
// syntax characters are stripped rather than escaped).
export function searchTerm(sp) {
  return String(sp.get('q') || '').replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

export function person(p) {
  return p ? { id: p.id, name: p.full_name || null, email: p.email || null } : null
}

export function shapeTicket(t) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    sla_state: slaState(t),
    priority: t.priority,
    category: t.category,
    source: t.source,
    requester: person(t.requester) || (t.requester_email ? { id: null, name: null, email: t.requester_email } : null),
    assignee: person(t.assignee),
    first_response_due: t.first_response_due,
    resolution_due: t.resolution_due,
    first_responded_at: t.first_responded_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    resolved_at: t.resolved_at,
    closed_at: t.closed_at,
    url: `${baseUrl()}/helpdesk/tickets/${t.id}`,
  }
}

export function shapeComment(c) {
  return {
    id: c.id,
    visibility: c.is_internal ? 'internal' : 'public',
    author: person(c.author),
    body: c.body,
    created_at: c.created_at,
  }
}

export function shapeActivity(a) {
  return {
    id: a.id,
    action: a.action,
    from_value: a.from_value,
    to_value: a.to_value,
    actor: person(a.actor),
    created_at: a.created_at,
  }
}

// Same snippet rule as the search_kb() SQL function (migration 02).
export function kbSnippet(body) {
  return String(body || '').replace(/[#*`>_-]/g, '').slice(0, 150)
}

export function shapeKbSummary(a, extra = {}) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    snippet: kbSnippet(a.body),
    tags: a.tags || [],
    category: a.category ? { name: a.category.name, slug: a.category.slug } : null,
    updated_at: a.updated_at,
    published_at: a.published_at,
    url: `${baseUrl()}/helpdesk/kb/${a.slug}`,
    ...extra,
  }
}

export function shapeKbArticle(a) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    body: a.body,
    body_format: 'markdown',
    tags: a.tags || [],
    category: a.category ? { name: a.category.name, slug: a.category.slug } : null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    published_at: a.published_at,
    url: `${baseUrl()}/helpdesk/kb/${a.slug}`,
  }
}
