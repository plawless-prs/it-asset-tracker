// Daily batch-reminder digest (scheduling calendar feature).
//
// Called by a Vercel cron at 12:00 UTC (7am CDT / 6am CST). Finds every batch
// whose effective_date is within the next 7 days — or already past — that
// isn't applied/archived, and sends ONE digest email per recipient listing
// them all (overdue / due today / upcoming). Because it recomputes daily from
// live data, reminders naturally repeat every day until a batch is applied or
// deleted, with no per-batch reminder state to maintain.
//
// Recipients: pu_settings.reminder_emails (migration 18; empty = disabled).
// Sender: it@ via Graph (src/lib/graph.js), same as Help Desk outbound.
// Auth: Bearer CRON_SECRET (the cron) or a logged-in `priceupdates` user
// (manual test). Excluded from the auth redirect in src/proxy.js.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { sendGraphMail } from '../../../../lib/graph'
import { todayCentral, daysUntil, batchReadiness, BATCH_STATUS_META } from '../../../../lib/priceupdates'

export const runtime = 'nodejs'

const LEAD_DAYS = 7

async function authorize(req, admin) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) return true
  if (!bearer) return false
  const { data: { user } } = await admin.auth.getUser(bearer)
  if (!user) return false
  const { data: profile } = await admin.from('profiles').select('role, app_access').eq('id', user.id).single()
  const acc = Array.isArray(profile?.app_access) ? profile.app_access : []
  return profile?.role === 'admin' || acc.includes('priceupdates')
}

function describe(b, today) {
  const d = daysUntil(b.effective_date, today)
  const when = d < 0 ? `${-d} day(s) overdue` : d === 0 ? 'due TODAY' : `in ${d} day(s)`
  const status = BATCH_STATUS_META[b.status]?.label || b.status
  const awaitingFile = b.status === 'received' && (b.files?.[0]?.count ?? 0) === 0
  const ready = batchReadiness(b) === 'ready' ? 'ready to load'
    : awaitingFile ? 'NOT ready — still awaiting the vendor file'
    : 'NOT ready — needs prep'
  return `  • ${b.vendor?.name || 'Unidentified vendor'} — batch #${b.number}, effective ${b.effective_date} (${when}) — ${status}, ${ready}`
}

async function handler(req) {
  const admin = createAdminClient()
  if (!(await authorize(req, admin))) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const today = todayCentral()
  const horizon = new Date(Date.parse(today) + LEAD_DAYS * 86400000).toISOString().slice(0, 10)

  const { data: batches, error } = await admin
    .from('pu_batches')
    .select('id, number, status, effective_date, vendor:vendor_id(name), files:pu_batch_files(count)')
    .not('effective_date', 'is', null)
    .lte('effective_date', horizon)
    .not('status', 'in', '(applied,archived)')
    .order('effective_date')
  if (error) return Response.json({ ok: false, error: error.message }, { status: 502 })
  if (!batches?.length) return Response.json({ ok: true, sent: false, reason: 'nothing due within a week' })

  const { data: settings } = await admin.from('pu_settings').select('reminder_emails').eq('id', 1).single()
  const recipients = (settings?.reminder_emails || []).filter(e => e.includes('@'))
  if (recipients.length === 0) return Response.json({ ok: true, sent: false, reason: 'no reminder recipients configured' })

  const overdue = batches.filter(b => daysUntil(b.effective_date, today) < 0)
  const dueToday = batches.filter(b => daysUntil(b.effective_date, today) === 0)
  const upcoming = batches.filter(b => daysUntil(b.effective_date, today) > 0)

  const sections = []
  if (overdue.length) sections.push(`OVERDUE — not yet applied in P21:\n${overdue.map(b => describe(b, today)).join('\n')}`)
  if (dueToday.length) sections.push(`DUE TODAY:\n${dueToday.map(b => describe(b, today)).join('\n')}`)
  if (upcoming.length) sections.push(`UPCOMING (next ${LEAD_DAYS} days):\n${upcoming.map(b => describe(b, today)).join('\n')}`)

  const subject = `Price updates: ${batches.length} batch(es) need attention` +
    (overdue.length ? ` — ${overdue.length} overdue` : dueToday.length ? ' — due today' : '')
  const body =
    `Daily price-update reminder for ${today}.\n\n` +
    sections.join('\n\n') +
    `\n\nReview: ${process.env.APP_BASE_URL || 'https://www.prstech.app'}/priceupdates/batches` +
    `\n\nReminders repeat daily until a batch is applied in P21 (or deleted).` +
    ` Recipients are configured in Price Updates → Settings.`

  const results = []
  for (const to of recipients) {
    try {
      await sendGraphMail(process.env.IT_MAILBOX, to, subject, body)
      results.push({ to, ok: true })
    } catch (e) {
      results.push({ to, ok: false, error: String(e?.message || e) })
    }
  }

  return Response.json({
    ok: results.every(r => r.ok),
    sent: results.some(r => r.ok),
    batches: batches.length,
    overdue: overdue.length,
    due_today: dueToday.length,
    upcoming: upcoming.length,
    recipients: results,
  })
}

export async function POST(req) { return handler(req) }
export async function GET(req) { return handler(req) }
