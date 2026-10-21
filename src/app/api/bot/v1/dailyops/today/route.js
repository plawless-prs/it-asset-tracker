// Bot API — today's Daily Ops checklists (Central-time "today").
//   GET (dailyops:read) → { date, checklists: [...] }.
// Side effect (same as a human opening /dailyops): today's sop_instances and
// their sop_item_status rows are created lazily if missing, via
// ensureInstancesForDate() — idempotent (ignoreDuplicates). Daily templates
// are due every day, weekly on Mondays, monthly on the 1st; ad hoc never.
// Instances of inactive templates are hidden. See docs/bot-api.md.
import { requireBotScope, botJson, botFail } from '../../../../../../lib/botAuth'
import { ensureInstancesForDate } from '../../../../../../lib/dailyops'
import { todayCentral } from '../../../../../../lib/priceupdates'
import { buildChecklists, loadPeople } from '../../../../../../lib/botDailyOps'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotScope(req, 'dailyops:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const date = todayCentral()
  let checklists
  try {
    const state = await ensureInstancesForDate(admin, date)
    const people = await loadPeople(admin, state.statuses.map(s => s.checked_by))
    checklists = buildChecklists(state, date, people)
  } catch (e) {
    console.error('bot dailyops today:', e?.message || e)
    return botFail(auth, req, 500, 'internal_error', "Could not load today's checklists.")
  }

  return botJson(auth, req, { date, checklists }, { count: checklists.length })
}
