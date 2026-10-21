// Bot API — one Daily Ops task. [id] = task uuid.
//   GET (dailyops:read) the task.
//   PATCH (dailyops:write) edit status / title / description / priority /
//       assigned_to / due_date. Only changed fields are written. Status 'done'
//       stamps completed_at; any other status clears it (the Tasks page's
//       setStatus()). Status changes aren't attributed — tasks have no
//       "changed by" column. Idempotency-Key optional; ?dry_run=1. See docs/bot-api.md.
import {
  requireBotScope, botJson, botFail, requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted,
} from '../../../../../../../lib/botAuth'
import {
  withValidation, readBody, allowKeys, strField, enumField, uuidField, dateField, invalid,
} from '../../../../../../../lib/botWrite'
import {
  TASK_COLUMNS, TASK_STATUSES, TASK_PRIORITIES, TASK_LIMITS, findTask, loadTask, loadAssignee, shapeTask,
} from '../../../../../../../lib/botDailyOps'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'dailyops:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const { id, task, invalid: bad, error } = await findTask(admin, rawId)
  if (bad) return botFail(auth, req, 400, 'invalid_param', 'Task id must be a uuid.', { id })
  if (error) {
    console.error('bot task detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load task.', { id })
  }
  if (!task) return botFail(auth, req, 404, 'not_found', 'Task not found.', { id })

  return botJson(auth, req, { data: shapeTask(task) }, { count: 1, params: { id } })
}

const EDIT_FIELDS = ['status', 'title', 'description', 'priority', 'assigned_to', 'due_date']

export async function PATCH(req, { params }) {
  const auth = await requireBotWrite(req, 'dailyops:write', { targetType: 'task' })
  if (auth.error) return auth.error
  const { admin } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const t = (await findTask(admin, rawId, 'id')).task; return t ? `PATCH /dailyops/tasks/${t.id}` : null }, body)
    if (replay) return replay
    allowKeys(body, EDIT_FIELDS, {
      created_by: "'created_by' can't be changed.",
      completed_at: "'completed_at' follows 'status' (set when done, cleared otherwise).",
    })
    const fields = {
      status: enumField(body, 'status', TASK_STATUSES),
      title: strField(body, 'title', { max: TASK_LIMITS.title }),
      description: strField(body, 'description', { max: TASK_LIMITS.description, nullable: true }),
      priority: enumField(body, 'priority', TASK_PRIORITIES),
      assigned_to: uuidField(body, 'assigned_to', { nullable: true }),
      due_date: dateField(body, 'due_date', { nullable: true }),
    }
    if (!EDIT_FIELDS.some(f => fields[f] !== undefined)) invalid(`Send at least one of: ${EDIT_FIELDS.join(', ')}.`)

    const task = await loadTask(admin, rawId)
    const changed = EDIT_FIELDS.filter(f => fields[f] !== undefined && (task[f] ?? null) !== fields[f])
    const assignee = changed.includes('assigned_to') ? await loadAssignee(admin, fields.assigned_to) : task.assignee

    const targetIds = [task.id]

    if (!changed.length) {
      return botWriteJson(auth, req, {
        data: shapeTask(task), changed: [], unchanged: true,
        ...(auth.dryRun ? { dry_run: true } : {}),
      }, { summary: ctx.summary, targetIds })
    }

    const patch = Object.fromEntries(changed.map(f => [f, fields[f]]))
    if ('status' in patch) patch.completed_at = patch.status === 'done' ? new Date().toISOString() : null

    if (auth.dryRun) {
      const wouldBe = { ...task, ...patch, assignee }
      return botWriteJson(auth, req, { data: shapeTask(wouldBe), changed, dry_run: true }, { summary: ctx.summary, targetIds })
    }

    const route = `PATCH /dailyops/tasks/${task.id}`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      // Guarded on the status we validated against, so a concurrent status
      // change isn't silently overwritten.
      const { data: updated, error } = await admin
        .from('tasks').update(patch)
        .eq('id', task.id).eq('status', task.status)
        .select(TASK_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot task update:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not update the task.' }, targetIds }
      }
      if (!updated) {
        return { error: { status: 409, code: 'conflict', message: 'The task changed while updating. Re-read it and retry.' }, targetIds }
      }
      return { status: 200, body: { data: shapeTask(updated), changed }, targetIds }
    })
  })
}
