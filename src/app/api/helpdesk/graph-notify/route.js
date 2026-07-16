// Microsoft Graph change-notification endpoint.
// 1) Subscription validation: Graph POSTs with ?validationToken=... and expects
//    the token echoed back as text/plain within 10s.
// 2) Notifications: Graph POSTs { value: [ ... ] } when a new email arrives.
//    We verify clientState, fetch the message, and create a ticket (de-duped).
import { createEmailTicket } from '../../../../lib/emailTicket'
import { fetchMessage } from '../../../../lib/graph'

export const runtime = 'nodejs'

function mailboxToQueue(mailbox) {
  const m = String(mailbox || '').toLowerCase()
  if (process.env.PRICEUPDATE_MAILBOX && m === process.env.PRICEUPDATE_MAILBOX.toLowerCase()) return 'priceupdate'
  return 'it'
}

function extractMailbox(resource) {
  const m = String(resource || '').match(/users\/([^\/]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}

export async function POST(req) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  let body
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }

  const base = process.env.GRAPH_CLIENT_STATE || ''
  const notifications = Array.isArray(body?.value) ? body.value : []
  for (const n of notifications) {
    const cs = n.clientState || ''
    // Accept the bare secret (older subs) or "<secret>|<queue>" (current subs).
    if (base && cs !== base && !cs.startsWith(base + '|')) continue
    try {
      const mailbox = extractMailbox(n.resource)
      const messageId = n.resourceData?.id
      if (!mailbox || !messageId) continue
      const msg = await fetchMessage(mailbox, messageId)
      const queueFromState = cs.includes('|') ? cs.slice(cs.indexOf('|') + 1) : null
      await createEmailTicket({
        from: msg?.from?.emailAddress?.address || '',
        subject: msg?.subject || '',
        text: msg?.bodyPreview || '',
        queue: queueFromState || mailboxToQueue(mailbox),
        messageId,
      })
    } catch (e) {
      console.error('graph-notify error:', e)
      // Swallow so one bad message doesn't fail the whole batch / cause retries.
    }
  }

  // Graph just needs a fast 2xx.
  return new Response(null, { status: 202 })
}
