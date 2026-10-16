// Bot API — one Help Desk ticket with its conversation (read-only, scope
// helpdesk:read). [id] = the ticket uuid or its number (`1042` / `#1042`).
// Comments come back split: `public_comments` (visible to the requester) and
// `internal_comments` (staff-only notes — never show these to requesters).
import { requireBotScope, botJson, botFail } from '../../../../../../../lib/botAuth'
import {
  TICKET_COLUMNS, isUuid, shapeTicket, shapeComment, shapeActivity,
} from '../../../../../../../lib/botHelpdesk'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const id = decodeURIComponent(String(rawId || '')).trim().replace(/^#/, '')
  let query = admin.from('tickets').select(TICKET_COLUMNS)
  if (isUuid(id)) query = query.eq('id', id)
  else if (/^\d{1,18}$/.test(id)) query = query.eq('number', id)
  else return botFail(auth, req, 400, 'invalid_param', 'Ticket id must be a uuid or a ticket number.', { id })

  const { data: ticket, error } = await query.maybeSingle()
  if (error) {
    console.error('bot ticket detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load ticket.', { id })
  }
  if (!ticket) return botFail(auth, req, 404, 'not_found', 'Ticket not found.', { id })

  const [comments, activity, links, attachments] = await Promise.all([
    admin.from('ticket_comments')
      .select('id, body, is_internal, created_at, author:author_id(id, full_name, email)')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    admin.from('ticket_activity')
      .select('id, action, from_value, to_value, created_at, actor:actor_id(id, full_name, email)')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    admin.from('kb_article_tickets')
      .select('article:article_id(id, slug, title, status)')
      .eq('ticket_id', ticket.id),
    admin.from('ticket_attachments')
      .select('id, comment_id, file_name, file_size, created_at')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
  ])
  const failed = [comments, activity, links, attachments].find(r => r.error)
  if (failed) {
    console.error('bot ticket detail (related):', failed.error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load ticket details.', { id })
  }

  const shaped = (comments.data || []).map(shapeComment)
  const internalIds = new Set(shaped.filter(c => c.visibility === 'internal').map(c => c.id))
  const base = process.env.APP_BASE_URL || 'https://www.prstech.app'
  return botJson(auth, req, {
    data: {
      ticket: shapeTicket(ticket),
      public_comments: shaped.filter(c => c.visibility === 'public'),
      internal_comments: shaped.filter(c => c.visibility === 'internal'),
      activity: (activity.data || []).map(shapeActivity),
      // Metadata only (no storage paths). An attachment on an internal note is internal too.
      attachments: (attachments.data || []).map(a => ({
        ...a, visibility: a.comment_id && internalIds.has(a.comment_id) ? 'internal' : 'public',
      })),
      // Published articles only — drafts never leave via the bot API.
      linked_kb: (links.data || [])
        .map(l => l.article)
        .filter(a => a && a.status === 'published')
        .map(a => ({ id: a.id, slug: a.slug, title: a.title, url: `${base}/helpdesk/kb/${a.slug}` })),
    },
    notice: 'internal_comments are staff-only notes. Never show them to the requester.',
  }, { count: 1, params: { id } })
}
