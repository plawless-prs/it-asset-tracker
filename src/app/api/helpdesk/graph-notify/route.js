// Microsoft Graph change-notification endpoint.
// 1) Subscription validation: Graph POSTs with ?validationToken=... and expects
//    the token echoed back as text/plain within 10s.
// 2) Notifications: Graph POSTs { value: [ ... ] } when a new email arrives.
//    We verify clientState and branch on the queue embedded in it:
//    'priceupdate' -> a Price Update Processor batch (Phase 6a; attachments
//    and body captured, deduped on message id); anything else -> a Help Desk
//    ticket (de-duped the same way). priceupdate@ no longer creates tickets.
import { after } from 'next/server'
import { createEmailTicket } from '../../../../lib/emailTicket'
import { createEmailBatch } from '../../../../lib/emailBatch'
import { autoParseBatch } from '../../../../lib/autoParse'
import { fetchMessage, fetchMessageFull } from '../../../../lib/graph'

export const runtime = 'nodejs'
// Auto-parse + matching on big vendor files runs after the response (via
// after()) but still inside this invocation's window — same budget as the
// match route.
export const maxDuration = 120

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
      const queueFromState = cs.includes('|') ? cs.slice(cs.indexOf('|') + 1) : null
      const queue = queueFromState || mailboxToQueue(mailbox)
      if (queue === 'priceupdate') {
        const msg = await fetchMessageFull(mailbox, messageId)
        const result = await createEmailBatch({ mailbox, messageId, msg })
        // Phase 6b: parse + match in the background so a known vendor's file
        // lands in the queue already at needs_review. after() lets Graph get
        // its 2xx first; failures just leave the files pending for manual
        // mapping (and a note on the batch).
        if (result?.data?.id && result.files > 0) {
          const batchId = result.data.id
          after(() => autoParseBatch(batchId).catch(e => console.error('autoParseBatch:', e)))
        }
      } else {
        const msg = await fetchMessage(mailbox, messageId)
        await createEmailTicket({
          from: msg?.from?.emailAddress?.address || '',
          subject: msg?.subject || '',
          text: msg?.bodyPreview || '',
          queue,
          messageId,
        })
      }
    } catch (e) {
      console.error('graph-notify error:', e)
      // Swallow so one bad message doesn't fail the whole batch / cause retries.
    }
  }

  // Graph just needs a fast 2xx.
  return new Response(null, { status: 202 })
}
