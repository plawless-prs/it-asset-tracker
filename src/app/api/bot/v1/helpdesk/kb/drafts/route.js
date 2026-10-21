// Bot API — list DRAFT KB articles (scope kb:write; drafts never appear in the
// helpdesk:read KB routes).
//   GET ?q=<text> (title, case-insensitive) &limit=25 (max 50) &offset=0
// Newest-updated first. `created_by_bot` = written through the bot API.
import { requireBotScope, botJson, botFail } from '../../../../../../../lib/botAuth'
import { intParam, searchTerm } from '../../../../../../../lib/botHelpdesk'
import { KB_DRAFT_LIST_COLUMNS, shapeKbDraftSummary } from '../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function GET(req) {
  const auth = await requireBotScope(req, 'kb:write')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  const q = searchTerm(sp)
  const limit = intParam(sp, 'limit', 25, 1, 50)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)

  let query = admin
    .from('kb_articles')
    .select(KB_DRAFT_LIST_COLUMNS, { count: 'exact' })
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (q) query = query.ilike('title', `%${q.replace(/_/g, '\\_')}%`)

  const { data, count, error } = await query
  if (error) {
    console.error('bot kb drafts list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load KB drafts.')
  }
  const drafts = (data || []).map(shapeKbDraftSummary)
  return botJson(auth, req, {
    data: drafts,
    pagination: { limit, offset, total: count ?? null },
    filters: { q: q || null },
  }, { count: drafts.length })
}
