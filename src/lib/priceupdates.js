// Shared constants + helpers for the Price Update Processor (app id `priceupdates`).
// Mirrors lib/helpdesk.js / lib/tracker.js — import from here instead of
// re-declaring these inline in the app's pages/components.
// Colors follow the PRS Apps dark theme used across the hub.

// --- Batch status (the workflow) --------------------------------------------
// received -> parsing -> needs_review -> approved -> exported -> applied
// plus failed / archived.
export const BATCH_STATUS_META = {
  received:     { label: 'Received',     dot: '#3b82f6', pillBg: '#10243f', pillText: '#7fb4f5' },
  parsing:      { label: 'Parsing',      dot: '#9aa6b4', pillBg: '#1b2533', pillText: '#aebacc' },
  needs_review: { label: 'Needs review', dot: '#f59e0b', pillBg: '#332300', pillText: '#fbbf24' },
  approved:     { label: 'Approved',     dot: '#22c55e', pillBg: '#0d3320', pillText: '#4ade80' },
  exported:     { label: 'Exported',     dot: '#818cf8', pillBg: '#1a1a2e', pillText: '#a78bfa' },
  applied:      { label: 'Applied',      dot: '#6b7280', pillBg: '#1a1a1a', pillText: '#9aa6b4' },
  failed:       { label: 'Failed',       dot: '#ef4444', pillBg: '#330d0d', pillText: '#f87171' },
  archived:     { label: 'Archived',     dot: '#6b7280', pillBg: '#1a1a1a', pillText: '#737373' },
}

export const BATCH_STATUS_ORDER = [
  'received', 'parsing', 'needs_review', 'approved', 'exported', 'applied', 'failed', 'archived',
]

// Statuses that still need someone's attention (not a terminal/parked state).
export const OPEN_STATUSES = ['received', 'parsing', 'needs_review', 'approved', 'exported']

export function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status)
}

// --- Source (email vs. manual upload) ---------------------------------------
export const SOURCE_META = {
  email:  { label: 'Email',  icon: '✉' },
  upload: { label: 'Upload', icon: '⬆' },
}

// --- Line match status ------------------------------------------------------
export const MATCH_META = {
  matched:   { label: 'Matched',   pillBg: '#0d3320', pillText: '#4ade80' },
  unmatched: { label: 'Unmatched', pillBg: '#330d0d', pillText: '#f87171' },
  ambiguous: { label: 'Ambiguous', pillBg: '#332300', pillText: '#fbbf24' },
  new_item:  { label: 'New item',  pillBg: '#10243f', pillText: '#7fb4f5' },
}

// --- Line flag (guardrails) -------------------------------------------------
export const FLAG_META = {
  ok:             { label: 'OK',              dot: '#22c55e' },
  large_increase: { label: 'Large increase',  dot: '#ef4444' },
  decrease:       { label: 'Decrease',        dot: '#f59e0b' },
  cost_over_list: { label: 'Cost over list',  dot: '#ef4444' },
  new:            { label: 'New',             dot: '#3b82f6' },
  review:         { label: 'Review',          dot: '#9aa6b4' },
}

// --- Derived "attention" pill for the queue ---------------------------------
// The status-vs-derived-state idea from Help Desk's SLA pills: computed from the
// batch's line counts rather than stored. Returns a pill meta or null.
export function attentionPill(batch) {
  if (!batch) return null
  const unmatched = (batch.line_count || 0) - (batch.matched_count || 0)
  if (batch.status === 'failed') {
    return { label: 'Failed', pillBg: '#330d0d', pillText: '#f87171' }
  }
  if (batch.status === 'exported') {
    return { label: 'Awaiting P21 load', pillBg: '#1a1a2e', pillText: '#a78bfa' }
  }
  if (batch.flagged_count > 0) {
    return { label: `${batch.flagged_count} flagged`, pillBg: '#332300', pillText: '#fbbf24' }
  }
  if (batch.line_count > 0 && unmatched > 0) {
    return { label: `${unmatched} unmatched`, pillBg: '#330d0d', pillText: '#f87171' }
  }
  return null
}

// --- Formatters -------------------------------------------------------------
export function formatCurrency(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "22 min ago" / "3h ago" / "2d ago" / "Jul 3" (copied from lib/helpdesk.js).
export function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const then = new Date(dateStr).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Signed percent, e.g. "+12.5%" / "-4.0%".
export function formatPct(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—'
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}
