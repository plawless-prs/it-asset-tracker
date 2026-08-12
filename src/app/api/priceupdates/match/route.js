// Match a batch's parsed lines against the P21 item mirror and apply guardrail
// flags. Re-runnable. Bearer-auth + priceupdates access (like parse-file).
// The matching itself lives in lib/matchBatch.js (shared with the on-arrival
// auto-parse flow, which runs with no user session); this route is the
// user-triggered entry point and only does auth.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { matchBatch } from '../../../../lib/matchBatch'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(req) {
  const accessToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: { user }, error: uErr } = await admin.auth.getUser(accessToken)
  if (uErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { data: profile } = await admin.from('profiles').select('role, app_access').eq('id', user.id).single()
  const acc = Array.isArray(profile?.app_access) ? profile.app_access : []
  if (!(profile?.role === 'admin' || acc.includes('priceupdates'))) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const batchId = body?.batch_id
  if (!batchId) return Response.json({ error: 'batch_id required' }, { status: 400 })

  try {
    const result = await matchBatch(admin, batchId)
    return Response.json(result)
  } catch (e) {
    const status = e?.status || 500
    return Response.json(
      status === 404 ? { error: e.message } : { ok: false, error: String(e?.message || e) },
      { status }
    )
  }
}
