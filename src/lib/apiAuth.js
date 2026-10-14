// Shared auth for server API routes (server-only — pulls in the service-role
// client; never import into a client component).
//
// Callers send their Supabase access token as `Authorization: Bearer <token>`.
// The token is validated against Supabase Auth, then the caller's `profiles`
// row decides access — the same rule as useRole's hasAccess():
// admin, or app_access includes the app id.
//
// Usage:
//   const auth = await requireAppAccess(req, 'helpdesk')
//   if (auth.error) return auth.error
//   const { admin, user, profile } = auth
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from './supabaseAdmin'

// Constant-time string compare for shared secrets. An empty/missing value on
// either side never matches, so an unset env var can't authorize anything.
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''))
  const bufB = Buffer.from(String(b ?? ''))
  if (!bufA.length || bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function deny(status) {
  return Response.json({ error: status === 401 ? 'unauthorized' : 'forbidden' }, { status })
}

// Returns { admin, user, profile, isAdmin } on success, or { error: Response }
// (401 = no/invalid session, 403 = signed in but no access to the app).
// `admin` is the service-role client, handed back so the route doesn't build a
// second one. Pass appId = null to require the admin role.
// allowCron: also accept `Bearer <CRON_SECRET>` (Vercel cron) — then the
// result is { admin, cron: true } with no user.
export async function requireAppAccess(req, appId, { allowCron = false } = {}) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!bearer) return { error: deny(401) }

  const admin = createAdminClient()
  if (allowCron && safeEqual(bearer, process.env.CRON_SECRET)) return { admin, cron: true }

  const { data: { user }, error: uErr } = await admin.auth.getUser(bearer)
  if (uErr || !user) return { error: deny(401) }

  const { data: profile } = await admin
    .from('profiles').select('id, email, full_name, role, app_access').eq('id', user.id).single()
  const access = Array.isArray(profile?.app_access) ? profile.app_access : []
  const isAdmin = profile?.role === 'admin'
  if (!isAdmin && !(appId && access.includes(appId))) return { error: deny(403) }

  return { admin, user, profile, isAdmin }
}

export function requireAdmin(req) {
  return requireAppAccess(req, null)
}
