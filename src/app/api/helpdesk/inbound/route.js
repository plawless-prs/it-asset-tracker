// Manual inbound email -> ticket (token-guarded). Kept for testing or as a
// non-Graph fallback (e.g. Power Automate Premium, or curl). The Graph webhook
// route is the primary inbound path. Shares createEmailTicket() so behavior
// (profile mapping, category, de-dupe) is identical.
import { createEmailTicket } from '../../../../lib/emailTicket'

export const runtime = 'nodejs'

export async function POST(req) {
  const token = req.headers.get('x-helpdesk-token')
  if (!process.env.HELPDESK_INBOUND_TOKEN || token !== process.env.HELPDESK_INBOUND_TOKEN) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }

  const { data, error, duplicate } = await createEmailTicket({
    from: body.from,
    subject: body.subject,
    text: body.text || body.body,
    queue: String(body.queue || '').toLowerCase(),
    messageId: body.messageId || undefined,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (duplicate) return Response.json({ ok: true, duplicate: true })
  return Response.json({ ok: true, id: data?.id, number: data?.number })
}
