// Outbound Help Desk notification. Sends via Microsoft Graph (as it@) when the
// Entra app is configured; otherwise falls back to a Power Automate
// HTTP-trigger flow.
//
// Requires Help Desk access (or admin). The caller only names a ticket and an
// event — the recipient, subject, and body are built here from the database,
// so a session can't be used to send arbitrary email as it@:
//   { ticket_id, event: 'assigned' }           -> the ticket's assignee
//   { ticket_id, event: 'reply', comment_id }  -> the requester, with that
//                                                 (public) comment as the body
import { requireAppAccess } from '../../../../lib/apiAuth'
import { sendGraphMail } from '../../../../lib/graph'

export const runtime = 'nodejs'

const EVENTS = ['assigned', 'reply']

export async function POST(req) {
  const auth = await requireAppAccess(req, 'helpdesk')
  if (auth.error) return auth.error
  const { admin } = auth

  let payload
  try { payload = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const ticketId = String(payload?.ticket_id || '')
  const event = payload?.event
  if (!ticketId) return Response.json({ error: 'ticket_id required' }, { status: 400 })
  if (!EVENTS.includes(event)) return Response.json({ error: 'unknown event' }, { status: 400 })

  const { data: ticket } = await admin
    .from('tickets')
    .select('id, number, title, description, requester_email, requester:requester_id(email), assignee:assignee_id(email)')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket) return Response.json({ error: 'ticket not found' }, { status: 404 })

  let to, subject, body
  if (event === 'assigned') {
    const base = process.env.APP_BASE_URL || 'https://www.prstech.app'
    to = ticket.assignee?.email
    subject = `Ticket #${ticket.number} assigned to you: ${ticket.title}`
    body = `You've been assigned Help Desk ticket #${ticket.number}.\n\n${ticket.title}\n\n${ticket.description || ''}\n\nOpen it: ${base}/helpdesk/tickets/${ticket.id}`
  } else {
    const commentId = String(payload?.comment_id || '')
    if (!commentId) return Response.json({ error: 'comment_id required' }, { status: 400 })
    const { data: comment } = await admin
      .from('ticket_comments').select('id, ticket_id, body, is_internal').eq('id', commentId).maybeSingle()
    if (!comment || comment.ticket_id !== ticket.id) return Response.json({ error: 'comment not found' }, { status: 404 })
    // Internal notes never leave the building.
    if (comment.is_internal) return Response.json({ error: 'internal notes are not emailed' }, { status: 400 })
    to = ticket.requester?.email || ticket.requester_email
    subject = `Re: [#${ticket.number}] ${ticket.title}`
    body = `${comment.body}\n\n—\nPRS Help Desk`
  }

  to = String(to || '').trim()
  if (!to || !to.includes('@')) return Response.json({ ok: false, skipped: 'no recipient' })

  // Preferred: Microsoft Graph sendMail as it@.
  if (process.env.AZURE_CLIENT_ID && process.env.IT_MAILBOX) {
    try {
      await sendGraphMail(process.env.IT_MAILBOX, to, subject, body)
      return Response.json({ ok: true, via: 'graph' })
    } catch (e) {
      return Response.json({ ok: false, via: 'graph', error: String(e) }, { status: 502 })
    }
  }

  // Fallback: Power Automate HTTP-trigger flow.
  const url = process.env.POWER_AUTOMATE_NOTIFY_URL
  if (!url) return Response.json({ ok: false, skipped: 'no email transport configured' })
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body }) })
    return Response.json({ ok: r.ok, via: 'power-automate' })
  } catch (e) {
    return Response.json({ ok: false, via: 'power-automate', error: String(e) }, { status: 502 })
  }
}
