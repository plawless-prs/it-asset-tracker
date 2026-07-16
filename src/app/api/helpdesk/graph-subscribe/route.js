// Create/renew Graph mail subscriptions for it@ and priceupdate@.
// - Call manually once (with the x-helpdesk-token header) to set them up.
// - Vercel Cron hits it daily to renew before the ~2-day expiry (cron requests
//   carry Authorization: Bearer <CRON_SECRET>).
import { ensureSubscription } from '../../../../lib/graph'

export const runtime = 'nodejs'

function authorized(req) {
  const headerToken = req.headers.get('x-helpdesk-token')
  if (process.env.HELPDESK_INBOUND_TOKEN && headerToken === process.env.HELPDESK_INBOUND_TOKEN) return true
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true
  return false
}

async function run(req) {
  if (!authorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })

  // ?recreate=1 deletes + recreates the subscriptions (needed once to migrate
  // older subs so their clientState carries the queue).
  const recreate = new URL(req.url).searchParams.get('recreate') === '1'
  const base = process.env.APP_BASE_URL || 'https://www.prstech.app'
  const notificationUrl = `${base}/api/helpdesk/graph-notify`
  const clientState = process.env.GRAPH_CLIENT_STATE || ''
  const targets = [
    { mailbox: process.env.IT_MAILBOX, queue: 'it' },
    { mailbox: process.env.PRICEUPDATE_MAILBOX, queue: 'priceupdate' },
  ].filter(t => t.mailbox)

  const results = []
  for (const t of targets) {
    try { results.push(await ensureSubscription(t.mailbox, notificationUrl, clientState, t.queue, recreate)) }
    catch (e) { results.push({ mailbox: t.mailbox, error: String(e) }) }
  }
  return Response.json({ ok: true, recreate, results })
}

export async function POST(req) { return run(req) }
export async function GET(req) { return run(req) }
