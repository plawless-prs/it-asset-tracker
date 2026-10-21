// Bot API — whoami (any active key, no scope required). Read-only smoke test:
// which client this key is, its scopes, who its writes are attributed to, and
// the limits that apply.
//   GET → { client: { name, scopes }, acts_as, limits, writes_today }
import {
  requireBotClient, botJson, countWrites,
  RATE_LIMIT, WRITE_LIMIT_MINUTE, WRITE_LIMIT_DAY,
} from '../../../../../lib/botAuth'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotClient(req)
  if (auth.error) return auth.error
  const { admin, client } = auth

  let actsAs = null
  if (client.acting_profile_id) {
    const { data: p, error } = await admin
      .from('profiles').select('id, full_name, email').eq('id', client.acting_profile_id).maybeSingle()
    if (error) console.error('bot whoami profile:', error.message)
    if (p) actsAs = { id: p.id, name: p.full_name, email: p.email }
  }

  // Same rolling 24h window the daily write limit uses. null if the count
  // fails (e.g. migration 22 not run yet).
  const { count, error: cErr } = await countWrites(admin, client.id, 24 * 60 * 60_000)
  if (cErr) console.error('bot whoami write count:', cErr.message)

  return botJson(auth, req, {
    client: { name: client.name, scopes: client.scopes || [] },
    acts_as: actsAs,
    limits: { per_minute: RATE_LIMIT, writes_per_minute: WRITE_LIMIT_MINUTE, writes_per_day: WRITE_LIMIT_DAY },
    writes_today: cErr ? null : count,
  })
}
