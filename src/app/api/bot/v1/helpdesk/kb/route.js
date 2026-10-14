// Bot API — Help Desk knowledge base (read-only, scope helpdesk:read).
// Published articles only.
//   GET ?q=<text>  → ranked search via search_kb() (migration 02; returns at
//                    most 5 hits — limit can only lower that)
//   GET (no q)     → newest-updated first, &limit=25 (max 100) &offset=0
import { requireBotScope, botJson, botFail } from '../../../../../../lib/botAuth'
import { KB_LIST_COLUMNS, intParam, shapeKbSummary } from '../../../../../../lib/botHelpdesk'

export const runtime = 'nodejs'

const SEARCH_MAX = 5 // hard-coded LIMIT inside search_kb()

export async function GET(req) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const sp = new URL(req.url).searchParams
  const q = String(sp.get('q') || '').trim().slice(0, 200)

  if (q) {
    const limit = intParam(sp, 'limit', SEARCH_MAX, 1, SEARCH_MAX)
    const { data: hits, error } = await admin.rpc('search_kb', { qtext: q, qtitle: q })
    if (error) {
      console.error('bot kb search:', error.message)
      return botFail(auth, req, 500, 'internal_error', 'Could not search the knowledge base.')
    }
    const top = (hits || []).slice(0, limit)
    let byId = new Map()
    if (top.length) {
      // search_kb is already published-only; re-checked here for metadata.
      const { data: rows, error: mErr } = await admin
        .from('kb_articles').select(KB_LIST_COLUMNS)
        .in('id', top.map(h => h.id)).eq('status', 'published')
      if (mErr) {
        console.error('bot kb search metadata:', mErr.message)
        return botFail(auth, req, 500, 'internal_error', 'Could not search the knowledge base.')
      }
      byId = new Map((rows || []).map(r => [r.id, r]))
    }
    const results = top
      .filter(h => byId.has(h.id))
      .map(h => shapeKbSummary(byId.get(h.id), { score: h.score }))
    return botJson(auth, req, {
      data: results,
      search: { q, max_results: SEARCH_MAX },
    }, { count: results.length })
  }

  const limit = intParam(sp, 'limit', 25, 1, 100)
  const offset = intParam(sp, 'offset', 0, 0, 1_000_000)
  const { data, count, error } = await admin
    .from('kb_articles')
    .select(KB_LIST_COLUMNS, { count: 'exact' })
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) {
    console.error('bot kb list:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load the knowledge base.')
  }
  const articles = (data || []).map(a => shapeKbSummary(a))
  return botJson(auth, req, {
    data: articles,
    pagination: { limit, offset, total: count ?? null },
  }, { count: articles.length })
}
