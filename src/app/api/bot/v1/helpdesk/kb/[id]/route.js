// Bot API — one KB article. [id] = the article uuid or its slug.
//   GET (helpdesk:read) published articles only; drafts/archived 404.
//   PATCH (kb:write) edit title / body / tags / category_id of a DRAFT only
//     (published/archived → 409 not_draft). Never changes status, published_at,
//     slug or author. Idempotency-Key optional; ?dry_run=1.
import {
  requireBotScope, botJson, botFail, requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted,
} from '../../../../../../../lib/botAuth'
import { KB_DETAIL_COLUMNS, findKbArticle, shapeKbArticle } from '../../../../../../../lib/botHelpdesk'
import {
  withValidation, readBody, allowKeys, strField, uuidField, tagsField, loadKbArticle, loadKbCategory,
  reject, shapeKbDraft, LIMITS, KB_DRAFT_DETAIL_COLUMNS,
} from '../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const { id, article, invalid, error } = await findKbArticle(admin, rawId, KB_DETAIL_COLUMNS, { status: 'published' })
  if (invalid) return botFail(auth, req, 400, 'invalid_param', 'Article id must be a uuid or a slug.', { id })
  if (error) {
    console.error('bot kb detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load article.', { id })
  }
  if (!article) return botFail(auth, req, 404, 'not_found', 'Article not found.', { id })

  return botJson(auth, req, { data: shapeKbArticle(article) }, { count: 1, params: { id } })
}

const PATCH_FIELDS = ['title', 'body', 'tags', 'category_id']
const NOT_EDITABLE = "Bots can only edit a draft's title, body, tags and category_id; status, published_at, slug and author stay with humans."
const PATCH_COLUMNS = `${KB_DRAFT_DETAIL_COLUMNS}, category_id`
const notDraft = () => reject(409, 'not_draft', 'Only draft articles can be edited through the bot API.')

export async function PATCH(req, { params }) {
  const auth = await requireBotWrite(req, 'kb:write', { targetType: 'kb_article' })
  if (auth.error) return auth.error
  const { admin } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const a = (await findKbArticle(admin, rawId, 'id')).article; return a ? `PATCH /helpdesk/kb/${a.id}` : null }, body)
    if (replay) return replay
    allowKeys(body, PATCH_FIELDS,
      { status: NOT_EDITABLE, published_at: NOT_EDITABLE, slug: NOT_EDITABLE, author_id: NOT_EDITABLE })
    const next = {
      title: strField(body, 'title', { max: LIMITS.title }),
      body: strField(body, 'body', { max: LIMITS.kbBody }),
      tags: tagsField(body),
      category_id: uuidField(body, 'category_id', { nullable: true }),
    }
    const fields = PATCH_FIELDS.filter(f => next[f] !== undefined)
    if (!fields.length) reject(400, 'invalid_param', `Send at least one of: ${PATCH_FIELDS.join(', ')}.`)

    const article = await loadKbArticle(admin, rawId, PATCH_COLUMNS)
    if (article.status !== 'draft') notDraft()

    const same = (f) => f === 'tags'
      ? JSON.stringify(article.tags || []) === JSON.stringify(next.tags)
      : (article[f] ?? null) === next[f]
    const changed = fields.filter(f => !same(f))
    let category = article.category
    if (changed.includes('category_id')) {
      const c = next.category_id ? await loadKbCategory(admin, next.category_id) : null
      category = c ? { name: c.name, slug: c.slug } : null
    }

    if (!changed.length) {
      return botWriteJson(auth, req, {
        data: shapeKbDraft(article), changed: [], unchanged: true, ...(auth.dryRun ? { dry_run: true } : {}),
      }, { summary: ctx.summary, targetIds: [article.id] })
    }

    const patch = Object.fromEntries(changed.map(f => [f, next[f]]))
    if (auth.dryRun) {
      return botWriteJson(auth, req, {
        data: shapeKbDraft({ ...article, ...patch, category }), changed, dry_run: true,
      }, { summary: ctx.summary, targetIds: [article.id] })
    }

    const route = `PATCH /helpdesk/kb/${article.id}`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      // status re-checked in the update itself, in case a human published it meanwhile.
      const { data, error } = await admin.from('kb_articles')
        .update(patch).eq('id', article.id).eq('status', 'draft')
        .select(KB_DRAFT_DETAIL_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot kb update:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not update the article.' }, targetIds: [article.id] }
      }
      if (!data) {
        return { error: { status: 409, code: 'not_draft', message: 'Only draft articles can be edited through the bot API.' }, targetIds: [article.id] }
      }
      return { status: 200, body: { data: shapeKbDraft(data), changed }, targetIds: [article.id] }
    })
  })
}
