// Bot API — Daily Ops one-off tasks.
//   GET (dailyops:read) ?status=todo,in_progress (default; 'all' = every status)
//       &assigned_to=<profile uuid> &due_before=YYYY-MM-DD (exclusive)
//       &q=<title text> &limit=25 (max 100) &offset=0
//       Ordered newest first (created_at desc, id).
//   POST (dailyops:write) create a task (status always 'todo', created_by = the
//       acting profile). Idempotency-Key required; ?dry_run=1.
// No email or reminders exist for Daily Ops. See docs/bot-api.md.
import {
  requireBotScope, botJson, botFail, requireBotWrite, requireIdempotencyKey, botWriteJson, runWrite, replayIfCompleted,
} from '../../../../../../lib/botAuth'
import { intParam, isUuid, searchTerm } from '../../../../../../lib/botHelpdesk'
import { withValidation, readBody, allowKeys, strField, enumField, uuidField, dateField } from '../../../../../../lib/botWrite'
import { todayCentral } from '../../../../../../lib/priceupdates'
import {
  TASK_COLUMNS, TASK_STATUSES, OPEN_TASK_STATUSES, TASK_PRIORITIES, TASK_LIMITS, shapeTask, loadAssignee,
} from '../../../../../../lib/botDailyOps'

export const runtime = 'nodejs'

// A real calendar date 'YYYY-MM-DD' (2026-02-30 is refused).
const isIsoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v

export async function GET(req) {
  const auth = await requireBotScope(req, 'dailyops:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  let statuses = OPEN_TASK_STATUSES
  const rawStatus = sp.get('status')?.trim().toLowerCase()
  if (rawStatus === 'all') statuses = null
  else if (rawStatus) {
    const parts = [...new Set(rawStatus.split(',').map(s => s.trim()).filter(Boolean))]
    const bad = parts.find(p => !TASK_STATUSES.includes(p))
    if (bad || !parts.length) {
      return botFail(auth, req, 400, 'invalid_param',
        `Unknown status '${bad ?? rawStatus}'. Use one or more of ${TASK_STATUSES.join(', ')} (comma-separated), or 'all'.`)
    }
    statuses = parts
  }
  const assignedTo = sp.get('assigned_to')?.trim() || null
  if (assignedTo && !isUuid(assignedTo)) return botFail(auth, req, 400, 'invalid_param', "'assigned_to' must be a uuid.")
  const dueBefore = sp.get('due_before')?.trim() || null
  if (dueBefore && !isIsoDate(dueBefore)) return botFail(auth, req, 400, 'invalid_param', "'due_before' must be a date (YYYY-MM-DD).")
  const q = searchTerm(sp)
  const limit = intParam(sp, 'limit', 25, 1, 100)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)

  let query = admin
    .from('tasks')
    .select(TASK_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (statuses) query = query.in('status', statuses)
  if (assignedTo) query = query.eq('assigned_to', assignedTo)
  if (dueBefore) query = query.lt('due_date', dueBefore)
  if (q) query = query.ilike('title', `%${q}%`)

  const { data, count, error } = await query
  if (error) {
    console.error('bot dailyops tasks list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load tasks.')
  }

  const today = todayCentral()
  const tasks = (data || []).map(t => shapeTask(t, today))
  return botJson(auth, req, {
    data: tasks,
    pagination: { limit, offset, total: count ?? null },
    filters: { status: statuses || 'all', assigned_to: assignedTo, due_before: dueBefore, q: q || null },
  }, { count: tasks.length })
}

const CREATE_FIELDS = ['title', 'description', 'priority', 'assigned_to', 'due_date']

export async function POST(req) {
  const auth = await requireBotWrite(req, 'dailyops:write', { targetType: 'task' })
  if (auth.error) return auth.error
  const { admin, actor } = auth

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await requireIdempotencyKey(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, 'POST /dailyops/tasks', body)
    if (replay) return replay
    allowKeys(body, CREATE_FIELDS, {
      status: "New tasks always start as 'todo' — don't send 'status' (change it afterwards with PATCH /dailyops/tasks/{id}).",
      created_by: "'created_by' is always the API client's acting profile.",
      completed_at: "'completed_at' is set automatically when a task is marked done.",
    })
    const title = strField(body, 'title', { required: true, max: TASK_LIMITS.title })
    const description = strField(body, 'description', { max: TASK_LIMITS.description, nullable: true })
    const priority = enumField(body, 'priority', TASK_PRIORITIES)
    const assignedTo = uuidField(body, 'assigned_to', { nullable: true })
    const dueDate = dateField(body, 'due_date', { nullable: true })
    const assignee = await loadAssignee(admin, assignedTo)

    // Same row the Tasks page's createTask() inserts.
    const row = {
      title,
      description: description ?? null,
      priority: priority ?? 'medium',
      assigned_to: assignedTo ?? null,
      due_date: dueDate ?? null,
      created_by: actor.id,
    }

    if (auth.dryRun) {
      const wouldBe = shapeTask({
        ...row, id: null, status: 'todo', created_at: null, completed_at: null, assignee, creator: actor,
      })
      return botWriteJson(auth, req, { data: wouldBe, dry_run: true }, { summary: ctx.summary })
    }

    return runWrite(auth, req, { route: 'POST /dailyops/tasks', body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: task, error } = await admin.from('tasks').insert(row).select(TASK_COLUMNS).single()
      if (error) {
        console.error('bot task create:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not create the task.' } }
      }
      return { status: 201, body: { data: shapeTask(task) }, targetIds: [task.id] }
    })
  })
}
