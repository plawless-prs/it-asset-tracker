// Bot API — IT Tracker employee directory (read-only; there are no employee writes).
//   GET (assets:read) ?q=<text>           (full name / email / department)
//       &status=active|inactive|all        (default: active)
//       &limit=25 (max 100) &offset=0
//       Ordered by full name. Minimal fields only (no notes / manager / profile link).
// See docs/bot-api.md.
import { requireBotScope, botJson, botFail } from '../../../../../../lib/botAuth'
import { intParam, searchTerm } from '../../../../../../lib/botHelpdesk'
import { EMPLOYEE_COLUMNS, EMPLOYEE_STATUSES, shapeEmployee } from '../../../../../../lib/botTracker'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotScope(req, 'assets:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  const status = String(sp.get('status') || 'active').trim().toLowerCase()
  if (status !== 'all' && !EMPLOYEE_STATUSES.includes(status)) {
    return botFail(auth, req, 400, 'invalid_param', `Unknown status '${status}'. Use active, inactive or all.`)
  }
  const q = searchTerm(sp)
  const limit = intParam(sp, 'limit', 25, 1, 100)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)

  let query = admin
    .from('employees')
    .select(EMPLOYEE_COLUMNS, { count: 'exact' })
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (status !== 'all') query = query.eq('status', status)
  if (q) query = query.or(`full_name.ilike.*${q}*,email.ilike.*${q}*,department.ilike.*${q}*`)

  const { data, count, error } = await query
  if (error) {
    console.error('bot employees list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load employees.')
  }

  const employees = (data || []).map(shapeEmployee)
  return botJson(auth, req, {
    data: employees,
    pagination: { limit, offset, total: count ?? null },
    filters: { status, q: q || null },
  }, { count: employees.length })
}
