// Microsoft Graph client (server-only). Uses the client-credentials flow with
// the Entra app registration to read mailboxes and manage change-notification
// subscriptions. Never import into a client component.

const GRAPH = 'https://graph.microsoft.com/v1.0'

let _token = null
let _exp = 0

export async function getAppToken() {
  const now = Date.now()
  if (_token && now < _exp - 60000) return _token
  const body = new URLSearchParams({
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const r = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const j = await r.json()
  if (!r.ok) throw new Error('token error: ' + JSON.stringify(j))
  _token = j.access_token
  _exp = now + (j.expires_in || 3600) * 1000
  return _token
}

export async function graph(path, opts = {}) {
  const token = await getAppToken()
  const r = await fetch(`${GRAPH}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const txt = await r.text()
  const json = txt ? JSON.parse(txt) : null
  if (!r.ok) throw new Error(`graph ${path}: ${r.status} ${txt}`)
  return json
}

export async function fetchMessage(mailbox, messageId) {
  const p = `/users/${encodeURIComponent(mailbox)}/messages/${messageId}?$select=from,subject,bodyPreview,receivedDateTime`
  return graph(p)
}

export async function sendGraphMail(mailbox, to, subject, body) {
  await graph(`/users/${encodeURIComponent(mailbox)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: true,
    }),
  })
}

export function subResource(mailbox) {
  return `users/${mailbox}/mailFolders('Inbox')/messages`
}

export async function listSubscriptions() {
  const j = await graph('/subscriptions')
  return j?.value || []
}

// Create the subscription if missing, otherwise extend its expiry.
// Graph caps message subscriptions at ~4230 minutes; we use 2 days and renew
// daily via cron.
export async function ensureSubscription(mailbox, notificationUrl, clientState) {
  const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  const subs = await listSubscriptions()
  const existing = subs.find(s => String(s.resource || '').toLowerCase().includes(mailbox.toLowerCase()) && s.notificationUrl === notificationUrl)
  if (existing) {
    await graph(`/subscriptions/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ expirationDateTime: expiration }) })
    return { mailbox, action: 'renewed', id: existing.id, expiration }
  }
  const created = await graph('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      resource: subResource(mailbox),
      expirationDateTime: expiration,
      clientState,
    }),
  })
  return { mailbox, action: 'created', id: created.id, expiration }
}
