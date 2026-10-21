// Outbound Help Desk notification. Sends via Microsoft Graph (as it@) when the
// Entra app is configured; otherwise falls back to a Power Automate
// HTTP-trigger flow (transport + the 'assigned' email live in
// src/lib/helpdeskNotify.js, shared with the bot API).
//
// Requires Help Desk access (or admin). The caller only names a ticket and an
// event — the recipient, subject, and body are built here from the database,
// so a session can't be used to send arbitrary email as it@:
//   { ticket_id, event: 'assigned' }           -> the ticket's assignee
//                                                 (skipped if that's it@/priceupdate@)
//   { ticket_id, event: 'reply', comment_id }  -> the requester, with that
//                                                 (public) comment as the body
import { requireAppAccess } from '../../../../lib/apiAuth'
import { sendAssignedEmail, sendHelpdeskMail } from '../../../../lib/helpdeskNotify'

export const runtime = 'nodejs'

const EVENTS = ['assigned', 'reply']

const send = result => Response.json(result, { status: result.error ? 502 : 200 })

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
    .select('id, number, title, requester_email, requester:requester_id(email)')
    .eq('id', ticketId)
    .maybeSingle()
  if (!ticket) return Response.json({ error: 'ticket not found' }, { status: 404 })

  if (event === 'assigned') return send(await sendAssignedEmail(admin, ticket.id))

  const commentId = String(payload?.comment_id || '')
  if (!commentId) return Response.json({ error: 'comment_id required' }, { status: 400 })
  const { data: comment } = await admin
    .from('ticket_comments').select('id, ticket_id, body, is_internal').eq('id', commentId).maybeSingle()
  if (!comment || comment.ticket_id !== ticket.id) return Response.json({ error: 'comment not found' }, { status: 404 })
  // Internal notes never leave the building.
  if (comment.is_internal) return Response.json({ error: 'internal notes are not emailed' }, { status: 400 })
  const to = ticket.requester?.email || ticket.requester_email
  const subject = `Re: [#${ticket.number}] ${ticket.title}`
  const body = `${comment.body}\n\n—\nPRS Help Desk`
  return send(await sendHelpdeskMail(to, subject, body))
}
