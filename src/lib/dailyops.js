// Shared constants + helpers for Daily Ops (app id `dailyops`).
// Mirrors lib/helpdesk.js / lib/priceupdates.js — import from here instead of
// re-declaring inline. Task priority reuses the Help Desk PRIORITY_META
// (tasks.priority is the same ticket_priority enum).

export const FREQUENCY_META = {
  daily:   { label: 'Daily',   pillBg: '#10243f', pillText: '#7fb4f5' },
  weekly:  { label: 'Weekly',  pillBg: '#1a1a2e', pillText: '#a78bfa' },
  monthly: { label: 'Monthly', pillBg: '#332300', pillText: '#fbbf24' },
  adhoc:   { label: 'Ad hoc',  pillBg: '#1b2533', pillText: '#aebacc' },
}

export const TASK_STATUS_META = {
  todo:        { label: 'To do',       dot: '#3b82f6', pillBg: '#10243f', pillText: '#7fb4f5' },
  in_progress: { label: 'In progress', dot: '#f59e0b', pillBg: '#332300', pillText: '#fbbf24' },
  done:        { label: 'Done',        dot: '#22c55e', pillBg: '#0d3320', pillText: '#4ade80' },
  skipped:     { label: 'Skipped',     dot: '#6b7280', pillBg: '#1a1a1a', pillText: '#9aa6b4' },
}

// Which recurring templates are due on a given 'YYYY-MM-DD' (Central) date:
// daily = every day; weekly = Mondays; monthly = the 1st. Ad hoc templates
// are only instantiated by hand.
export function isTemplateDue(frequency, isoDate) {
  if (frequency === 'daily') return true
  const [y, m, d] = String(isoDate).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (frequency === 'weekly') return dow === 1
  if (frequency === 'monthly') return d === 1
  return false
}

export function personLabel(p) {
  return p?.full_name || p?.email || '—'
}

// Lazy instance creation for one 'YYYY-MM-DD' date (no cron): upsert an
// sop_instances row for every active template due that day, then seed the
// per-item sop_item_status rows. ignoreDuplicates keeps concurrent callers
// safe (unique on template_id + due_date / instance_id + template_item_id),
// so the first caller creates them and everyone else picks up the same state.
// Used by the Today page and the bot API (GET /dailyops/today) — pass any
// Supabase client. Throws the Supabase error on failure.
// → { templates (active, with items), instances (that date's), statuses }.
export async function ensureInstancesForDate(supabase, isoDate) {
  const { data: templates, error: tErr } = await supabase
    .from('sop_templates')
    .select('id, title, description, frequency, sort_order, items:sop_template_items(id, label, instructions, required, sort_order)')
    .eq('active', true)
    .order('sort_order')
  if (tErr) throw tErr
  const due = (templates || []).filter(t => isTemplateDue(t.frequency, isoDate))

  if (due.length) {
    const { error: iErr } = await supabase.from('sop_instances').upsert(
      due.map(t => ({ template_id: t.id, due_date: isoDate })),
      { onConflict: 'template_id,due_date', ignoreDuplicates: true },
    )
    if (iErr) throw iErr
  }
  const { data: instances, error: gErr } = await supabase
    .from('sop_instances')
    .select('id, template_id, status, completed_at')
    .eq('due_date', isoDate)
  if (gErr) throw gErr

  // Seed the per-item checkbox rows for the instances we just ensured.
  const seedRows = []
  for (const inst of instances || []) {
    const t = (templates || []).find(x => x.id === inst.template_id)
    for (const it of t?.items || []) seedRows.push({ instance_id: inst.id, template_item_id: it.id })
  }
  if (seedRows.length) {
    const { error: sErr } = await supabase.from('sop_item_status').upsert(
      seedRows, { onConflict: 'instance_id,template_item_id', ignoreDuplicates: true },
    )
    if (sErr) throw sErr
  }
  const { data: statuses, error: stErr } = await supabase
    .from('sop_item_status')
    .select('id, instance_id, template_item_id, checked, checked_by, checked_at')
    .in('instance_id', (instances || []).map(i => i.id))
  if (stErr) throw stErr

  return { templates: templates || [], instances: instances || [], statuses: statuses || [] }
}

// An instance's status is derived from its required items: every required
// item checked → 'done', else 'todo' (no required items → 'done').
// items = [{ required, checked }].
export function instanceStatusFor(items) {
  return items.filter(i => i.required).every(i => i.checked) ? 'done' : 'todo'
}
