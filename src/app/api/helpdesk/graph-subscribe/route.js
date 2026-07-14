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

  const base = process.env.APP_BASE_URL || 'https://prstech.app'
  const notificationUrl = `${base}/api/helpdesk/graph-notify`
  const clientState = process.env.GRAPH_CLIENT_STATE || ''
  const mailboxes = [process.env.IT_MAILBOX, process.env.PRICEUPDATE_MAILBOX].filter(Boolean)

  const results = []
  for (const mb of mailboxes) {
    try { results.push(await ensureSubscription(mb, notificationUrl, clientState)) }
    catch (e) { results.push({ mailbox: mb, error: String(e) }) }
  }
  return Response.json({ ok: true, results })
}

export async function POST(req) { return run(req) }
export async function GET(req) { return run(req) }
