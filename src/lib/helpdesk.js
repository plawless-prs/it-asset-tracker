// Shared constants + helpers for the Help Desk app.
// Colors follow the PRS Apps dark theme used across the hub.

export const PRIORITY_META = {
  low:    { label: 'Low',    dot: '#3b82f6', pillBg: '#10243f', pillText: '#7fb4f5' },
  medium: { label: 'Medium', dot: '#9aa6b4', pillBg: '#1b2533', pillText: '#aebacc' },
  high:   { label: 'High',   dot: '#f59e0b', pillBg: '#332300', pillText: '#fbbf24' },
  urgent: { label: 'Urgent', dot: '#ef4444', pillBg: '#330d0d', pillText: '#f87171' },
}

export const STATUS_META = {
  open:        { label: 'Open',        color: '#3b82f6', pillBg: '#10243f', pillText: '#7fb4f5' },
  in_progress: { label: 'In progress', color: '#f59e0b', pillBg: '#332300', pillText: '#fbbf24' },
  waiting:     { label: 'Waiting',     color: '#9aa6b4', pillBg: '#1b2533', pillText: '#aebacc' },
  resolved:    { label: 'Resolved',    color: '#22c55e', pillBg: '#0d3320', pillText: '#4ade80' },
  closed:      { label: 'Closed',      color: '#6b7280', pillBg: '#1a1a1a', pillText: '#9aa6b4' },
}

// SLA "state" pills (from ticket_list_view.sla_state)
export const SLA_META = {
  overdue:   { label: 'Overdue',   pillBg: '#330d0d', pillText: '#f87171' },
  due_today: { label: 'Due today', pillBg: '#332300', pillText: '#fbbf24' },
  on_time:   { label: 'On time',   pillBg: '#13202e', pillText: '#7e93a8' },
  resolved:  { label: 'Met',       pillBg: '#0d3320', pillText: '#4ade80' },
}

export const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent']
export const STATUS_ORDER = ['open', 'in_progress', 'waiting', 'resolved', 'closed']
export const SOURCE_OPTIONS = ['manual', 'email', 'phone', 'chat', 'portal']

export const UNRESOLVED = ['open', 'in_progress', 'waiting']

export function isUnresolved(status) {
  return UNRESOLVED.includes(status)
}

// Mirrors the SQL ticket_list_view.sla_state, for when we query the tickets
// table directly (e.g. to embed requester/assignee names).
export function slaState(ticket) {
  if (!ticket) return 'on_time'
  if (ticket.status === 'resolved' || ticket.status === 'closed') return 'resolved'
  if (!ticket.resolution_due) return 'on_time'
  const due = new Date(ticket.resolution_due)
  if (due.getTime() < Date.now()) return 'overdue'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0)
  if (dueDay.getTime() === today.getTime()) return 'due_today'
  return 'on_time'
}

export function displayName(profile) {
  if (!profile) return 'Unknown'
  return profile.full_name || profile.email || 'Unknown'
}

// Requester label that falls back to the raw sender email for inbound tickets
// created from an address with no matching profile.
export function requesterLabel(ticket) {
  if (ticket?.requester) return displayName(ticket.requester)
  return ticket?.requester_email || 'Unknown'
}

// Best-effort outbound email via the /api/helpdesk/notify route (Power Automate).
// Never throws; a failed notification must not break the ticket action.
export async function sendNotify(supabase, { to, subject, body }) {
  if (!to || !String(to).includes('@')) return
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch('/api/helpdesk/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ to, subject, body }),
    })
  } catch { /* best effort */ }
}

// "22 min ago" / "3h ago" / "2d ago"
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

// Countdown vs. an SLA due timestamp. Returns { text, breached }.
export function slaCountdown(dueStr) {
  if (!dueStr) return { text: '—', breached: false }
  const diff = new Date(dueStr).getTime() - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  let span
  if (mins < 60) span = `${mins}m`
  else if (hrs < 24) span = `${hrs}h ${mins % 60}m`
  else span = `${days}d ${hrs % 24}h`
  return diff < 0 ? { text: `overdue ${span}`, breached: true } : { text: `in ${span}`, breached: false }
}

export function initials(nameOrEmail) {
  if (!nameOrEmail) return '?'
  const s = String(nameOrEmail).trim()
  if (s.includes('@')) return s[0].toUpperCase()
  const parts = s.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || s[0].toUpperCase()
}
