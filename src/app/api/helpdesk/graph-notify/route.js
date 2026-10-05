// Microsoft Graph change-notification endpoint.
// 1) Subscription validation: Graph POSTs with ?validationToken=... and expects
//    the token echoed back as text/plain within 10s.
// 2) Notifications: Graph POSTs { value: [ ... ] } when a new email arrives.
//    We verify clientState (rejecting everything if GRAPH_CLIENT_STATE is
//    unset) and branch on the queue embedded in it:
//    'priceupdate' -> a Price Update Processor batch (Phase 6a; attachments
//    and body captured, deduped on message id); anything else -> a Help Desk
//    ticket (de-duped the same way). priceupdate@ no longer creates tickets.
import { after } from 'next/server'
import { createEmailTicket } from '../../../../lib/emailTicket'
import { createEmailBatch } from '../../../../lib/emailBatch'
import { autoParseBatch } from '../../../../lib/autoParse'
import { fetchMessage, fetchMessageFull } from '../../../../lib/graph'
import { safeEqual } from '../../../../lib/apiAuth'

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

// Verify a notification's clientState against the secret (constant-time).
// Accepts the bare secret (older subs) or "<secret>|<queue>" (current subs).
// Returns null on mismatch, else { queue } (null queue for bare-secret subs).
function checkClientState(cs, base) {
  if (!safeEqual(cs.slice(0, base.length), base)) return null
  if (cs.length === base.length) return { queue: null }
  if (cs[base.length] !== '|') return null
  return { queue: cs.slice(base.length + 1) || null }
}

export async function POST(req) {
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  // No secret configured = no way to tell Graph from anyone else. Fail closed
  // rather than accept every POST as a real notification.
  const base = process.env.GRAPH_CLIENT_STATE || ''
  if (!base) {
    console.error('graph-notify: GRAPH_CLIENT_STATE is not set — rejecting notification')
    return new Response('webhook secret not configured', { status: 500 })
  }

  let body
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }

  const notifications = Array.isArray(body?.value) ? body.value : []
  for (const n of notifications) {
    const state = checkClientState(String(n.clientState || ''), base)
    if (!state) continue
    try {
      const mailbox = extractMailbox(n.resource)
      const messageId = n.resourceData?.id
      if (!mailbox || !messageId) continue
      const queue = state.queue || mailboxToQueue(mailbox)
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
