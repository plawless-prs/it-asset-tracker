// Bot API — Help Desk tickets.
//   GET (helpdesk:read) ?status=open,waiting|all  (default: open + in_progress + waiting)
//       &q=<text>                 (title/description, case-insensitive)
//       &limit=25 (max 100) &offset=0
//       Newest first.
//   POST (helpdesk:write) create a ticket (source 'chat'); Idempotency-Key
//       required; ?dry_run=1. Emails the assignee "assigned to you" if one is set.
// See docs/bot-api.md.
import {
  requireBotScope, botJson, botFail, requireBotWrite, requireIdempotencyKey, botWriteJson, runWrite,
} from '../../../../../../lib/botAuth'
import {
  TICKET_COLUMNS, TICKET_STATUSES, DEFAULT_TICKET_STATUSES,
  intParam, searchTerm, shapeTicket, person,
} from '../../../../../../lib/botHelpdesk'
import {
  withValidation, readBody, allowKeys, strField, enumField, resolveRequester, validateAssignee,
  scheduleAssignedEmail, LIMITS, TICKET_PRIORITIES, CATEGORY_IDS,
} from '../../../../../../lib/botHelpdeskWrite'

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

const CREATE_FIELDS = ['title', 'description', 'requester_email', 'requester_id', 'priority', 'category', 'assignee_id']

export async function POST(req) {
  const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'ticket' })
  if (auth.error) return auth.error
  const { admin } = auth

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    allowKeys(body, CREATE_FIELDS, { source: "'source' is set by the API (bot tickets are always 'chat')." })
    const title = strField(body, 'title', { required: true, max: LIMITS.title })
    const description = strField(body, 'description', { required: true, max: LIMITS.text })
    const priority = enumField(body, 'priority', TICKET_PRIORITIES) ?? 'medium'
    const category = enumField(body, 'category', CATEGORY_IDS) ?? 'other'
    const requester = await resolveRequester(admin, body)
    const assignee = body.assignee_id != null ? await validateAssignee(admin, auth, body.assignee_id) : null

    const idem = await requireIdempotencyKey(auth, req)
    if (idem.error) return idem.error

    const row = {
      title, description, priority, category, source: 'chat',
      requester_id: requester.requester_id,
      requester_email: requester.requester_email,
      assignee_id: assignee?.id ?? null,
      created_via_client_id: auth.client.id,
    }

    if (auth.dryRun) {
      // SLA due times are stamped by a DB trigger on insert, so they're omitted here.
      const wouldBe = {
        id: null, number: null, title, description, status: 'open', priority, category, source: 'chat',
        requester: person(requester.requester) || { id: null, name: null, email: requester.requester_email },
        assignee: person(assignee),
        url: null,
      }
      return botWriteJson(auth, req, { data: wouldBe, dry_run: true }, { summary: ctx.summary })
    }

    return runWrite(auth, req, { route: 'POST /helpdesk/tickets', body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: ticket, error } = await admin.from('tickets').insert(row).select(TICKET_COLUMNS).single()
      if (error) {
        console.error('bot ticket create:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not create the ticket.' } }
      }
      // Same timeline entry the UI writes (new/page.js). The ticket exists
      // either way, so a failure here is logged, not returned.
      const { error: aErr } = await admin.from('ticket_activity').insert({
        ticket_id: ticket.id, actor_id: auth.actor.id, action: 'created', to_value: priority,
      })
      if (aErr) console.error('bot ticket create activity:', aErr.message)
      if (assignee) scheduleAssignedEmail(admin, ticket.id)
      return { status: 201, body: { data: shapeTicket(ticket) }, targetIds: [ticket.id] }
    })
  })
}
