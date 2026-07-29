// Prophet 21 (Epicor cloud) REST/OData client — server-only. Generic and
// app-agnostic so future apps (quote dashboard, dead-stock report) can reuse it.
// Never import into a client component.
//
// Auth: POST the API user's credentials to the P21 token endpoint (P21 takes
// username/password as HTTP headers) -> bearer token, cached until expiry.
// Reads: OData views under `${P21_BASE_URL}${P21_ODATA_BASE}/{ViewName}`.
//
// View/field/path names differ between hosted instances — everything here is
// env-configurable. Confirm against your instance (community docs:
// github.com/mrwuss/p21-api-documentation); if a guess 404s, override via env.
//
// Env: P21_BASE_URL, P21_USERNAME, P21_PASSWORD (required to talk to P21);
//      P21_TOKEN_PATH (default '/api/security/token/v2'),
//      P21_ODATA_BASE  (default '/odataservice/odata/view').

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const backoff = (attempt) => Math.min(1000 * 2 ** (attempt - 1), 8000)

function baseUrl() {
  return (process.env.P21_BASE_URL || '').replace(/\/+$/, '')
}

export function p21Configured() {
  return !!(process.env.P21_BASE_URL && process.env.P21_USERNAME && process.env.P21_PASSWORD)
}

let _token = null
let _exp = 0

export function _resetP21Token() { _token = null; _exp = 0 }

export async function getP21Token() {
  const now = Date.now()
  if (_token && now < _exp - 60000) return _token
  const base = baseUrl()
  if (!base) throw new Error('P21_BASE_URL not set')
  const path = process.env.P21_TOKEN_PATH || '/api/security/token/v2'
  const method = (process.env.P21_TOKEN_METHOD || 'POST').toUpperCase()

  // V2 token endpoint: credentials go in the JSON BODY with Content-Type +
  // Accept application/json. (Passing them as headers is the deprecated V1
  // style and makes V2 throw a NullReferenceException.) An optional consumer
  // key (P21_CONSUMER_KEY) switches to the client-credentials variant.
  const creds = { username: process.env.P21_USERNAME || '', password: process.env.P21_PASSWORD || '' }
  if (process.env.P21_CONSUMER_KEY) {
    creds.ClientSecret = process.env.P21_CONSUMER_KEY
    creds.GrantType = 'client_credentials'
  }
  const init = { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(creds)

  const r = await fetch(`${base}${path}`, init)
  const txt = await r.text()
  if (!r.ok) throw new Error(`P21 token error: ${r.status} ${txt.slice(0, 300)}`)

  // Prefer JSON; some middleware returns XML even with Accept: application/json.
  let token = null, expires = null
  try {
    const j = txt ? JSON.parse(txt) : null
    token = j?.AccessToken || j?.access_token || j?.token
    expires = Number(j?.ExpiresInSeconds || j?.ExpiresIn || j?.expires_in)
  } catch { /* fall through to XML */ }
  if (!token) {
    const m = txt.match(/<AccessToken>([^<]+)<\/AccessToken>/i) || txt.match(/"AccessToken"\s*:\s*"([^"]+)"/i)
    if (m) token = m[1]
  }
  if (!token) throw new Error(`P21 token response had no AccessToken: ${txt.slice(0, 200)}`)
  _token = token
  _exp = now + ((expires && isFinite(expires) ? expires : 3300) * 1000)
  return token
}

// Single OData GET. opts: { select, filter, top, skip, orderby }.
// Retries token once on 401, and backs off on 429/5xx.
export async function p21OData(viewName, opts = {}) {
  const base = baseUrl()
  if (!base) throw new Error('P21_BASE_URL not set')
  const odataBase = process.env.P21_ODATA_BASE || '/odataservice/odata/view'

  const params = new URLSearchParams()
  if (opts.select) params.set('$select', opts.select)
  if (opts.filter) params.set('$filter', opts.filter)
  if (opts.top != null) params.set('$top', String(opts.top))
  if (opts.skip != null) params.set('$skip', String(opts.skip))
  if (opts.orderby) params.set('$orderby', opts.orderby)
  const url = `${base}${odataBase}/${viewName}?${params.toString()}`

  for (let attempt = 1; ; attempt++) {
    const token = await getP21Token()
    let r
    try {
      r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    } catch (e) {
      if (attempt <= 4) { await sleep(backoff(attempt)); continue }
      throw new Error(`P21 OData ${viewName}: network error ${String(e?.message || e)}`)
    }
    if (r.status === 401 && attempt === 1) { _resetP21Token(); continue }
    if ((r.status === 429 || r.status >= 500) && attempt <= 4) { await sleep(backoff(attempt)); continue }

    const txt = await r.text()
    if (!r.ok) throw new Error(`P21 OData ${viewName}: ${r.status} ${txt.slice(0, 300)}`)
    try { return txt ? JSON.parse(txt) : { value: [] } }
    catch { throw new Error(`P21 OData ${viewName}: non-JSON response`) }
  }
}

// Page through a view with $top/$skip, invoking onPage(rows) per page.
// Returns the total row count seen.
export async function p21ODataAll(viewName, opts = {}, onPage, { pageSize = 1000, maxPages = 5000 } = {}) {
  let skip = 0, total = 0
  for (let page = 0; page < maxPages; page++) {
    const j = await p21OData(viewName, { ...opts, top: pageSize, skip })
    const rows = Array.isArray(j) ? j : (j?.value || [])
    if (rows.length === 0) break
    await onPage(rows)
    total += rows.length
    if (rows.length < pageSize) break
    skip += pageSize
  }
  return total
}
