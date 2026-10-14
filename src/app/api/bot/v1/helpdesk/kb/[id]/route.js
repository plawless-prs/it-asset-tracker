// Bot API — one published KB article (read-only, scope helpdesk:read).
// [id] = the article uuid or its slug. Drafts/archived articles 404.
import { requireBotScope, botJson, botFail } from '../../../../../../../lib/botAuth'
import { KB_DETAIL_COLUMNS, isUuid, shapeKbArticle } from '../../../../../../../lib/botHelpdesk'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const id = decodeURIComponent(String(rawId || '')).trim()
  let query = admin.from('kb_articles').select(KB_DETAIL_COLUMNS).eq('status', 'published')
  if (isUuid(id)) query = query.eq('id', id)
  else if (/^[a-z0-9-]{1,200}$/i.test(id)) query = query.eq('slug', id.toLowerCase())
  else return botFail(auth, req, 400, 'invalid_param', 'Article id must be a uuid or a slug.', { id })

  const { data: article, error } = await query.maybeSingle()
  if (error) {
    console.error('bot kb detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load article.', { id })
  }
  if (!article) return botFail(auth, req, 404, 'not_found', 'Article not found.', { id })

  return botJson(auth, req, { data: shapeKbArticle(article) }, { count: 1, params: { id } })
}
