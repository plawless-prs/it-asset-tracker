// Bot API — check / uncheck one item on today's Daily Ops checklist.
// [id] = the item's sop_item_status.id (the `id` of an item in GET /dailyops/today).
//   PATCH (dailyops:write) { checked: true|false }. Same write as the Today
//       page's toggle(): checked_by = the acting profile (null when unchecking),
//       checked_at = now (null when unchecking), then the instance status is
//       recomputed (every required item checked → 'done', else 'todo').
//       Only today's (Central) checklists of active templates can be changed.
//       Idempotency-Key optional; ?dry_run=1. See docs/bot-api.md.
import { requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted } from '../../../../../../../lib/botAuth'
import { withValidation, readBody, allowKeys, boolField, invalid, reject, dbFail } from '../../../../../../../lib/botWrite'
import { instanceStatusFor } from '../../../../../../../lib/dailyops'
import { todayCentral } from '../../../../../../../lib/priceupdates'
import {
  CHECKLIST_ITEM_COLUMNS, findChecklistItem, loadChecklistItem, loadInstanceItems, loadPeople, shapeChecklistItem,
  syncInstanceStatus,
} from '../../../../../../../lib/botDailyOps'

export const runtime = 'nodejs'

const shapeInstance = i => ({ id: i.id, status: i.status, completed_at: i.completed_at })

export async function PATCH(req, { params }) {
  const auth = await requireBotWrite(req, 'dailyops:write', { targetType: 'checklist_item' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const s = (await findChecklistItem(admin, rawId, 'id')).item; return s ? `PATCH /dailyops/checklist-items/${s.id}` : null }, body)
    if (replay) return replay
    allowKeys(body, ['checked'], { note: "'note' isn't supported — the Today page doesn't show item notes." })
    const checked = boolField(body, 'checked')
    if (checked === undefined) invalid("'checked' is required (true or false).")

    const current = await loadChecklistItem(admin, rawId)
    const instance = current.instance
    const today = todayCentral()
    if (instance.due_date !== today) {
      reject(409, 'not_today', `This item belongs to the ${instance.due_date} checklist — only today's (${today}, Central) can be changed.`)
    }
    if (!instance.template?.active) {
      reject(409, 'template_inactive', 'This checklist\'s template has been deactivated, so its items can\'t be changed.')
    }

    const targetIds = [current.id, instance.id]
    let people
    try {
      people = await loadPeople(admin, [current.checked_by, actor.id])
    } catch (e) {
      dbFail('bot checklist people lookup', e)
    }

    if (current.checked === checked) {
      return botWriteJson(auth, req, {
        data: { item: shapeChecklistItem(current.item, current, people), instance: shapeInstance(instance) },
        unchanged: true,
        ...(auth.dryRun ? { dry_run: true } : {}),
      }, { summary: ctx.summary, targetIds })
    }

    const patch = {
      checked,
      checked_by: checked ? actor.id : null,
      checked_at: checked ? new Date().toISOString() : null,
    }

    if (auth.dryRun) {
      let items
      try {
        items = await loadInstanceItems(admin, instance.id, instance.template_id)
      } catch (e) {
        dbFail('bot checklist instance items', e)
      }
      const nextStatus = instanceStatusFor(items.map(it => (
        it.template_item_id === current.template_item_id ? { ...it, checked } : it
      )))
      const wouldBe = nextStatus === instance.status ? instance
        : { ...instance, status: nextStatus, completed_at: nextStatus === 'done' ? new Date().toISOString() : null }
      return botWriteJson(auth, req, {
        data: { item: shapeChecklistItem(current.item, { ...current, ...patch }, people), instance: shapeInstance(wouldBe) },
        dry_run: true,
      }, { summary: ctx.summary, targetIds })
    }

    const route = `PATCH /dailyops/checklist-items/${current.id}`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      // Guarded on the checked state we validated against (a concurrent toggle wins).
      const { data: updated, error } = await admin
        .from('sop_item_status').update(patch)
        .eq('id', current.id).eq('checked', current.checked)
        .select(CHECKLIST_ITEM_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot checklist item update:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not update the checklist item.' }, targetIds }
      }
      if (!updated) {
        return { error: { status: 409, code: 'conflict', message: 'The item changed while updating. Re-read today\'s checklists and retry.' }, targetIds }
      }

      // The item change is committed — from here on, failures are logged, not returned.
      const inst = await syncInstanceStatus(admin, instance)
      return {
        status: 200,
        body: { data: { item: shapeChecklistItem(updated.item, updated, people), instance: shapeInstance(inst) } },
        targetIds,
      }
    })
  })
}
