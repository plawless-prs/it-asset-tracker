// Bot API — list Help Desk tickets (read-only, scope helpdesk:read).
//   GET ?status=open,waiting|all  (default: open + in_progress + waiting)
//       &q=<text>                 (title/description, case-insensitive)
//       &limit=25 (max 100) &offset=0
// Newest first. See docs/bot-api.md.
import { requireBotScope, botJson, botFail } from '../../../../../../lib/botAuth'
import {
  TICKET_COLUMNS, TICKET_STATUSES, DEFAULT_TICKET_STATUSES,
  intParam, searchTerm, shapeTicket,
} from '../../../../../../lib/botHelpdesk'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  const rawStatus = String(sp.get('status') || '').trim().toLowerCase()
  let statuses = DEFAULT_TICKET_STATUSES
  if (rawStatus === 'all') statuses = null
  else if (rawStatus) {
    statuses = rawStatus.split(',').map(s => s.trim()).filter(Boolean)
    const bad = statuses.filter(s => !TICKET_STATUSES.includes(s))
    if (bad.length) {
      return botFail(auth, req, 400, 'invalid_param',
        `Unknown status '${bad[0]}'. Use one or more of ${TICKET_STATUSES.join(', ')} (comma-separated), or 'all'.`)
    }
  }
  const q = searchTerm(sp)
  const limit = intParam(sp, 'limit', 25, 1, 100)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)

  let query = admin
    .from('tickets')
    .select(TICKET_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (statuses) query = query.in('status', statuses)
  if (q) query = query.or(`title.ilike.*${q}*,description.ilike.*${q}*`)

  const { data, count, error } = await query
  if (error) {
    console.error('bot tickets list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load tickets.')
  }

  const tickets = (data || []).map(shapeTicket)
  return botJson(auth, req, {
    data: tickets,
    pagination: { limit, offset, total: count ?? null },
    filters: { status: statuses || 'all', q: q || null },
  }, { count: tickets.length })
}
