// Outbound notification. Sends via Microsoft Graph (as it@) when the Entra app
// is configured; otherwise falls back to a Power Automate HTTP-trigger flow.
// Requires a valid Supabase access token (Bearer) so anonymous callers can't
// send arbitrary email.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { sendGraphMail } from '../../../../lib/graph'

export const runtime = 'nodejs'

export async function POST(req) {
  const accessToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: { user }, error: uErr } = await supabase.auth.getUser(accessToken)
  if (uErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let payload
  try { payload = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const to = String(payload?.to || '').trim()
  if (!to || !to.includes('@')) return Response.json({ ok: false, skipped: 'no recipient' })
  const subject = String(payload.subject || 'PRS Help Desk')
  const body = String(payload.body || '')

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
