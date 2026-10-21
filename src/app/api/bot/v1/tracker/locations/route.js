// Bot API — IT Tracker locations (branches) with their rooms (read-only).
//   GET (assets:read) every location, by name, each with rooms sorted by name.
// See docs/bot-api.md.
import { requireBotScope, botJson, botFail } from '../../../../../../lib/botAuth'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotScope(req, 'assets:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { data, error } = await admin
    .from('locations')
    .select('id, name, address, rooms(id, name)')
    .order('name', { ascending: true })
  if (error) {
    console.error('bot locations list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load locations.')
  }

  const locations = (data || []).map(l => ({
    id: l.id,
    name: l.name,
    address: l.address,
    rooms: (l.rooms || []).map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name)),
  }))
  return botJson(auth, req, { data: locations }, { count: locations.length })
}
