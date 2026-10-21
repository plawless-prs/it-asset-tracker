// Shared pieces for the Daily Ops bot routes (src/app/api/bot/v1/dailyops/*):
// column lists, lookups, response shaping, and write-side validation.
//
// The bot API reads through the service role (RLS bypassed), so every select
// names its columns. Daily Ops has no email or reminders, so nothing here
// sends any. Templates (sop_templates / sop_template_items) are read-only to
// the bot. Business dates are Central time (todayCentral()).
import { PRIORITY_ORDER } from './helpdesk'
import { instanceStatusFor } from './dailyops'
import { todayCentral } from './priceupdates'
import { cleanId, isUuid, person } from './botHelpdesk'
import { dbFail, invalid, reject } from './botWrite'

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'skipped']
export const OPEN_TASK_STATUSES = ['todo', 'in_progress']
export const TASK_PRIORITIES = PRIORITY_ORDER // ticket_priority enum
export const TASK_LIMITS = { title: 200, description: 5000 }

// ---- Columns ---------------------------------------------------------------

export const TASK_COLUMNS = [
  'id', 'title', 'description', 'status', 'priority', 'assigned_to', 'due_date',
  'created_at', 'completed_at', 'created_by',
  'assignee:assigned_to(id, full_name, email)',
  'creator:created_by(id, full_name, email)',
].join(', ')

// One sop_item_status row with what a checklist write needs: its template item
// (required) and its instance (date, status, template active).
export const CHECKLIST_ITEM_COLUMNS = [
  'id', 'instance_id', 'template_item_id', 'checked', 'checked_by', 'checked_at',
  'item:sop_template_items(id, label, instructions, required, sort_order)',
  'instance:sop_instances(id, template_id, due_date, status, completed_at, template:sop_templates(id, title, active))',
].join(', ')

// ---- Shaping ---------------------------------------------------------------

export function shapeTask(t, today = todayCentral()) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assignee: person(t.assignee) || (t.assigned_to ? { id: t.assigned_to, name: null, email: null } : null),
    creator: person(t.creator) || (t.created_by ? { id: t.created_by, name: null, email: null } : null),
    due_date: t.due_date,
    // Derived like the Tasks page's "(overdue)" — never stored.
    overdue: !!(t.due_date && OPEN_TASK_STATUSES.includes(t.status) && t.due_date < today),
    created_at: t.created_at,
    completed_at: t.completed_at,
  }
}

export function shapeChecklistItem(templateItem, status, people = {}) {
  const checkedBy = status?.checked_by
  return {
    id: status?.id ?? null, // sop_item_status.id — the {id} for PATCH /dailyops/checklist-items/{id}
    template_item_id: templateItem.id,
    label: templateItem.label,
    instructions: templateItem.instructions,
    required: !!templateItem.required,
    checked: !!status?.checked,
    checked_by: checkedBy ? (person(people[checkedBy]) || { id: checkedBy, name: null, email: null }) : null,
    checked_at: status?.checked_at ?? null,
  }
}

// Today's checklist cards from ensureInstancesForDate()'s output — same rules as
// the Today page: instances of inactive/deleted templates are hidden, cards in
// template sort_order, items in item sort_order. `people` = profile id → row.
export function buildChecklists({ templates, instances, statuses }, isoDate, people = {}) {
  return instances.map(inst => {
    const template = templates.find(t => t.id === inst.template_id)
    if (!template) return null
    const items = [...(template.items || [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(ti => shapeChecklistItem(ti, statuses.find(s => s.instance_id === inst.id && s.template_item_id === ti.id), people))
    return {
      sort: template.sort_order,
      card: {
        instance_id: inst.id,
        due_date: isoDate,
        status: inst.status,
        completed_at: inst.completed_at,
        template: { id: template.id, title: template.title, description: template.description, frequency: template.frequency },
        items,
      },
    }
  }).filter(Boolean).sort((a, b) => a.sort - b.sort).map(x => x.card)
}

// profile id → { id, full_name, email } for the given ids (checked_by etc.).
export async function loadPeople(admin, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return {}
  const { data, error } = await admin.from('profiles').select('id, full_name, email').in('id', unique)
  if (error) throw error
  return Object.fromEntries((data || []).map(p => [p.id, p]))
}

// ---- Lookups ---------------------------------------------------------------

// Task by uuid. → { id, task } (null = not found), { id, invalid: true }, or { id, error }.
export async function findTask(admin, rawId, columns = TASK_COLUMNS) {
  const id = cleanId(rawId)
  if (!isUuid(id)) return { id, invalid: true }
  const { data, error } = await admin.from('tasks').select(columns).eq('id', id).maybeSingle()
  return error ? { id, error } : { id, task: data || null }
}

// The route's task {id}: 400 malformed, 404 missing, 500 on DB error.
export async function loadTask(admin, rawId, columns = TASK_COLUMNS) {
  const r = await findTask(admin, rawId, columns)
  if (r.invalid) invalid('Task id must be a uuid.')
  if (r.error) dbFail('bot task lookup', r.error)
  if (!r.task) reject(404, 'not_found', 'Task not found.')
  return r.task
}

// Checklist item (sop_item_status) by uuid. → { id, item } / { id, invalid } / { id, error }.
export async function findChecklistItem(admin, rawId, columns = CHECKLIST_ITEM_COLUMNS) {
  const id = cleanId(rawId)
  if (!isUuid(id)) return { id, invalid: true }
  const { data, error } = await admin.from('sop_item_status').select(columns).eq('id', id).maybeSingle()
  return error ? { id, error } : { id, item: data || null }
}

export async function loadChecklistItem(admin, rawId) {
  const r = await findChecklistItem(admin, rawId)
  if (r.invalid) invalid('Checklist item id must be a uuid (the item\'s `id` from GET /dailyops/today).')
  if (r.error) dbFail('bot checklist item lookup', r.error)
  if (!r.item) reject(404, 'not_found', 'Checklist item not found.')
  return r.item
}

// assigned_to must be an existing profile → the profile row (null clears).
export async function loadAssignee(admin, assigneeId) {
  if (assigneeId == null) return null
  const { data, error } = await admin.from('profiles').select('id, full_name, email').eq('id', assigneeId).maybeSingle()
  if (error) dbFail('bot task assignee lookup', error)
  if (!data) invalid("'assigned_to' doesn't match a user profile.")
  return data
}

// ---- Instance status -------------------------------------------------------

// { template_item_id, required, checked } for every item of the instance's
// template (what the Today page's toggle() derives from — an item with no
// status row yet counts as unchecked). Throws the Supabase error.
export async function loadInstanceItems(admin, instanceId, templateId) {
  const [{ data: items, error: iErr }, { data: statuses, error: sErr }] = await Promise.all([
    admin.from('sop_template_items').select('id, required').eq('template_id', templateId),
    admin.from('sop_item_status').select('template_item_id, checked').eq('instance_id', instanceId),
  ])
  if (iErr || sErr) throw (iErr || sErr)
  const checked = Object.fromEntries((statuses || []).map(s => [s.template_item_id, s.checked]))
  return (items || []).map(i => ({ template_item_id: i.id, required: i.required, checked: !!checked[i.id] }))
}

// After an item write: re-read the instance's items, and if the derived status
// (instanceStatusFor) differs from `instance.status`, update it the way
// toggle() does — guarded on the status we read. The item change is already
// committed, so failures are console.error'd, never thrown. → the instance
// row as best known ({ id, status, completed_at }).
export async function syncInstanceStatus(admin, instance) {
  let next
  try {
    next = instanceStatusFor(await loadInstanceItems(admin, instance.id, instance.template_id))
  } catch (e) {
    console.error(`bot checklist instance recompute (${instance.id}):`, e?.message || e)
    return instance
  }
  if (next === instance.status) return instance
  const { data, error } = await admin
    .from('sop_instances')
    .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
    .eq('id', instance.id).eq('status', instance.status)
    .select('id, status, completed_at').maybeSingle()
  if (error || !data) {
    console.error(`bot checklist instance status update (${instance.id}):`, error?.message || 'status changed concurrently (0 rows)')
    const { data: fresh } = await admin.from('sop_instances').select('id, status, completed_at').eq('id', instance.id).maybeSingle()
    return fresh || instance
  }
  return data
}
