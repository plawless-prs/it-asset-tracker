// Bot API — one DRAFT KB article with its full body (scope kb:write).
// [id] = article uuid or slug. Published/archived articles 404 here (use
// GET /helpdesk/kb/{id} with helpdesk:read for published ones).
import { requireBotScope, botJson, botFail } from '../../../../../../../../lib/botAuth'
import { findKbArticle } from '../../../../../../../../lib/botHelpdesk'
import { KB_DRAFT_DETAIL_COLUMNS, shapeKbDraft } from '../../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'kb:write')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const { id, article, invalid, error } = await findKbArticle(admin, rawId, KB_DRAFT_DETAIL_COLUMNS, { status: 'draft' })
  if (invalid) return botFail(auth, req, 400, 'invalid_param', 'Article id must be a uuid or a slug.', { id })
  if (error) {
    console.error('bot kb draft detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load article.', { id })
  }
  if (!article) return botFail(auth, req, 404, 'not_found', 'Draft not found.', { id })

  return botJson(auth, req, { data: shapeKbDraft(article) }, { count: 1, params: { id } })
}
