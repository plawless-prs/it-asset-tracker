// Admin-only user management (called by /admin with the admin's Bearer token).
// Runs with the service-role key so accounts are created/removed through the
// Supabase Auth admin API — the browser never calls signUp, and deleting a
// user actually removes (or disables) their login, not just the profile row.
//
//   POST   { email, password, full_name, role, department, app_access }
//   DELETE { id }  -> { result: 'deleted' | 'deactivated' }
//
// `profiles` is referenced by tickets/comments/activity/batches/etc. with no
// ON DELETE action, so anyone with history can't be hard-deleted. Those users
// are DEACTIVATED instead: Auth user banned (can't sign in), role -> viewer,
// app_access cleared; the profile row stays so history keeps its author.
import { requireAdmin } from '../../../../lib/apiAuth'

export const runtime = 'nodejs'

const ROLES = ['admin', 'manager', 'editor', 'viewer']
// Supabase has no "forever" ban; ~100 years is the conventional stand-in.
const BAN_FOREVER = '876000h'

async function audit(admin, actorId, action, detail) {
  // Best effort — an audit hiccup shouldn't undo the user change.
  const { error } = await admin.from('audit_log').insert({ action, entity_type: 'user', detail, user_id: actorId })
  if (error) console.error('admin/users audit_log:', error.message)
}

export async function POST(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { admin, user: actor } = auth

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')
  const role = String(body?.role || 'viewer')
  if (!email || !email.includes('@')) return Response.json({ error: 'A valid email is required' }, { status: 400 })
  if (password.length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  if (!ROLES.includes(role)) return Response.json({ error: 'Unknown role' }, { status: 400 })
  const appAccess = Array.isArray(body?.app_access) ? body.app_access.filter(a => typeof a === 'string') : []

  // email_confirm: the admin vouches for the address, so no confirmation email.
  const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (cErr || !created?.user) {
    return Response.json({ error: cErr?.message || 'Could not create user' }, { status: 400 })
  }

  const { error: pErr } = await admin.from('profiles').upsert({
    id: created.user.id,
    email,
    full_name: String(body?.full_name || '').trim() || null,
    role,
    department: String(body?.department || '').trim() || null,
    app_access: appAccess,
  })
  if (pErr) {
    // Don't leave a login with no profile behind.
    await admin.auth.admin.deleteUser(created.user.id)
    return Response.json({ error: 'Could not create profile: ' + pErr.message }, { status: 500 })
  }

  await audit(admin, actor.id, 'created', `User "${email}" created with role "${role}"`)
  return Response.json({ ok: true, id: created.user.id })
}

export async function DELETE(req) {
  const auth = await requireAdmin(req)
  if (auth.error) return auth.error
  const { admin, user: actor } = auth

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const id = String(body?.id || '')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  if (id === actor.id) return Response.json({ error: 'You cannot delete your own account.' }, { status: 400 })

  const { data: target } = await admin.from('profiles').select('id, email, full_name, role').eq('id', id).maybeSingle()
  if (!target) return Response.json({ error: 'User not found' }, { status: 404 })
  const label = target.email || target.full_name || id

  if (target.role === 'admin') {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
    if ((count ?? 0) <= 1) {
      return Response.json({ error: 'Cannot delete the last admin account. Assign another admin first.' }, { status: 400 })
    }
  }

  // Profile first: a foreign-key violation (23503) is the clean signal that
  // this user has history and must be deactivated rather than deleted.
  const { error: dErr } = await admin.from('profiles').delete().eq('id', id)

  if (dErr && dErr.code === '23503') {
    const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER })
    // "Not found" = the login is already gone, which is the goal anyway.
    if (banErr && banErr.status !== 404) {
      return Response.json({ error: 'Could not disable the login: ' + banErr.message }, { status: 500 })
    }
    const { error: upErr } = await admin.from('profiles').update({ role: 'viewer', app_access: [] }).eq('id', id)
    if (upErr) {
      return Response.json({ error: 'Login disabled, but clearing access failed: ' + upErr.message }, { status: 500 })
    }
    await audit(admin, actor.id, 'deleted', `User "${label}" deactivated (has history): login disabled, access cleared`)
    return Response.json({ ok: true, result: 'deactivated' })
  }
  if (dErr) return Response.json({ error: dErr.message }, { status: 500 })

  // Profile is gone — now remove the login itself.
  const { error: aErr } = await admin.auth.admin.deleteUser(id)
  if (aErr && aErr.status !== 404) {
    // Supabase refuses to delete some Auth users (e.g. ones that own Storage
    // objects). Never leave a working login behind: ban it instead.
    const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_FOREVER })
    if (banErr) {
      return Response.json({
        error: `Profile removed, but the login for "${label}" could not be deleted or disabled (${aErr.message}). Remove it in Supabase → Authentication → Users.`,
      }, { status: 500 })
    }
    await audit(admin, actor.id, 'deleted', `User "${label}" deleted (login disabled — Auth account could not be removed: ${aErr.message})`)
    return Response.json({ ok: true, result: 'deleted', warning: 'The login was disabled rather than removed: ' + aErr.message })
  }

  await audit(admin, actor.id, 'deleted', `User "${label}" deleted`)
  return Response.json({ ok: true, result: 'deleted' })
}
