// Server-side Help Desk email (server-only — takes the service-role client).
// Sends via Microsoft Graph (as it@) when the Entra app is configured;
// otherwise falls back to a Power Automate HTTP-trigger flow.
//
// Used by /api/helpdesk/notify (human UI) and the bot API ticket routes. Bots
// may only cause the 'assigned' email (sendAssignedEmail); the requester-facing
// 'reply' email stays in the notify route and is never reachable from a bot.
import { sendGraphMail } from './graph'

// Mailboxes the app reads. Mail sent to them comes back in as a new ticket
// (it@) or batch (priceupdate@), so they must never be a notification recipient.
export function mailboxAddresses() {
  return [process.env.IT_MAILBOX, process.env.PRICEUPDATE_MAILBOX]
    .map(m => String(m || '').trim().toLowerCase())
    .filter(Boolean)
}

export function isMailboxAddress(email) {
  const e = String(email || '').trim().toLowerCase()
  return !!e && mailboxAddresses().includes(e)
}

// Transport only — the caller builds a server-side recipient/subject/body.
// → { ok, via?, skipped?, error? }. Never throws.
export async function sendHelpdeskMail(to, subject, body) {
  to = String(to || '').trim()
  if (!to || !to.includes('@')) return { ok: false, skipped: 'no recipient' }

  // Preferred: Microsoft Graph sendMail as it@.
  if (process.env.AZURE_CLIENT_ID && process.env.IT_MAILBOX) {
    try {
      await sendGraphMail(process.env.IT_MAILBOX, to, subject, body)
      return { ok: true, via: 'graph' }
    } catch (e) {
      return { ok: false, via: 'graph', error: String(e) }
    }
  }

  // Fallback: Power Automate HTTP-trigger flow.
  const url = process.env.POWER_AUTOMATE_NOTIFY_URL
  if (!url) return { ok: false, skipped: 'no email transport configured' }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, subject, body }) })
    return { ok: r.ok, via: 'power-automate' }
  } catch (e) {
    return { ok: false, via: 'power-automate', error: String(e) }
  }
}

// "Ticket #N assigned to you" → the ticket's current assignee. Skips (no
// send) when there's no assignee or the assignee's email is one of the app's
// own mailboxes (that would loop back in as a new ticket).
// → { ok, via?, skipped?, error? }. Never throws.
export async function sendAssignedEmail(admin, ticketId) {
  try {
    const { data: ticket, error } = await admin
      .from('tickets')
      .select('id, number, title, description, assignee:assignee_id(email)')
      .eq('id', ticketId)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!ticket) return { ok: false, skipped: 'ticket not found' }

    const to = String(ticket.assignee?.email || '').trim()
    if (isMailboxAddress(to)) return { ok: false, skipped: 'mailbox recipient' }

    const base = process.env.APP_BASE_URL || 'https://www.prstech.app'
    const subject = `Ticket #${ticket.number} assigned to you: ${ticket.title}`
    const body = `You've been assigned Help Desk ticket #${ticket.number}.\n\n${ticket.title}\n\n${ticket.description || ''}\n\nOpen it: ${base}/helpdesk/tickets/${ticket.id}`
    return await sendHelpdeskMail(to, subject, body)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
