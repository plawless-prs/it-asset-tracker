// Bot API — link a KB article to a ticket (scope helpdesk:write).
// [id] = ticket uuid or number. Any article status may be linked (e.g. a draft
// the bot just wrote); the ticket GET still lists published articles only.
//   POST { article_id }  — already linked → 200 with already_linked: true.
//   Idempotency-Key optional; ?dry_run=1.
import { requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite } from '../../../../../../../../lib/botAuth'
import {
  withValidation, readBody, allowKeys, uuidField, loadTicket, reject,
} from '../../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'kb_link' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    allowKeys(body, ['article_id'])
    const articleId = uuidField(body, 'article_id', { required: true })
    const ticket = await loadTicket(admin, rawId, 'id, number')
    const { data: article, error: artErr } = await admin
      .from('kb_articles').select('id, slug, title, status').eq('id', articleId).maybeSingle()
    if (artErr) {
      console.error('bot kb-link article lookup:', artErr.message)
      reject(500, 'internal_error', 'Database error while validating the request.')
    }
    if (!article) reject(400, 'invalid_param', "'article_id' doesn't match a KB article.")

    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error

    const shape = link => ({
      id: link?.id ?? null,
      ticket: { id: ticket.id, number: ticket.number },
      article: { id: article.id, slug: article.slug, title: article.title, status: article.status },
      linked_at: link?.linked_at ?? null,
    })
    const findLink = () => admin.from('kb_article_tickets').select('id, linked_at')
      .eq('article_id', article.id).eq('ticket_id', ticket.id).maybeSingle()

    if (auth.dryRun) {
      const { data: existing, error } = await findLink()
      if (error) {
        console.error('bot kb-link lookup:', error.message)
        reject(500, 'internal_error', 'Database error while validating the request.')
      }
      return botWriteJson(auth, req, { data: shape(existing), already_linked: !!existing, dry_run: true },
        { summary: ctx.summary, targetIds: [ticket.id] })
    }

    const route = `POST /helpdesk/tickets/${ticket.id}/kb-links`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: link, error } = await admin.from('kb_article_tickets')
        .insert({ article_id: article.id, ticket_id: ticket.id, linked_by: actor.id })
        .select('id, linked_at').single()
      if (error?.code === '23505') {
        const { data: existing } = await findLink()
        return { status: 200, body: { data: shape(existing), already_linked: true }, targetIds: existing ? [existing.id] : [ticket.id] }
      }
      if (error) {
        console.error('bot kb-link insert:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not link the article.' }, targetIds: [ticket.id] }
      }
      return { status: 201, body: { data: shape(link), already_linked: false }, targetIds: [link.id] }
    })
  })
}
