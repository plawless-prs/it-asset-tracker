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
