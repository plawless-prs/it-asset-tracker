// Bot API — Help Desk knowledge base.
//   GET (helpdesk:read) published articles only.
//     ?q=<text>  → ranked search via search_kb() (migration 02; returns at
//                  most 5 hits — limit can only lower that)
//     (no q)     → newest-updated first, &limit=25 (max 100) &offset=0
//   POST (kb:write) create a DRAFT article (never published by a bot), optionally
//     linked to a ticket. Idempotency-Key required; ?dry_run=1.
import {
  requireBotScope, botJson, botFail, requireBotWrite, requireIdempotencyKey, botWriteJson, runWrite,
} from '../../../../../../lib/botAuth'
import { KB_LIST_COLUMNS, intParam, shapeKbSummary } from '../../../../../../lib/botHelpdesk'
import { slugify } from '../../../../../../lib/kb'
import {
  withValidation, readBody, allowKeys, strField, uuidField, tagsField, loadKbCategory, loadReferencedTicket,
  shapeKbDraft, LIMITS, KB_DRAFT_DETAIL_COLUMNS,
} from '../../../../../../lib/botHelpdeskWrite'

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

const CREATE_FIELDS = ['title', 'body', 'tags', 'category_id', 'ticket_id']
const DRAFT_ONLY = "Bot KB articles are always created as drafts with a generated slug; 'status', 'published_at' and 'slug' can't be set."

export async function POST(req) {
  const auth = await requireBotWrite(req, 'kb:write', { targetType: 'kb_article' })
  if (auth.error) return auth.error
  const { admin, actor } = auth

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    allowKeys(body, CREATE_FIELDS, { status: DRAFT_ONLY, published_at: DRAFT_ONLY, slug: DRAFT_ONLY })
    const title = strField(body, 'title', { required: true, max: LIMITS.title })
    const text = strField(body, 'body', { required: true, max: LIMITS.kbBody })
    const tags = tagsField(body) ?? []
    const categoryId = uuidField(body, 'category_id', { nullable: true })
    const category = categoryId ? await loadKbCategory(admin, categoryId) : null
    const ticket = body.ticket_id != null ? await loadReferencedTicket(admin, 'ticket_id', body.ticket_id) : null

    const idem = await requireIdempotencyKey(auth, req)
    if (idem.error) return idem.error

    const baseSlug = slugify(title)
    const row = {
      title, body: text, tags, category_id: category?.id ?? null,
      status: 'draft', published_at: null, author_id: actor.id, via_client_id: auth.client.id,
    }
    const linkedTicket = ticket ? { id: ticket.id, number: ticket.number } : null

    if (auth.dryRun) {
      const wouldBe = shapeKbDraft({
        ...row, id: null, slug: baseSlug,
        category: category ? { name: category.name, slug: category.slug } : null,
        created_at: null, updated_at: null,
      })
      return botWriteJson(auth, req, { data: { ...wouldBe, url: null }, linked_ticket: linkedTicket, dry_run: true },
        { summary: ctx.summary })
    }

    return runWrite(auth, req, { route: 'POST /helpdesk/kb', body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const insert = slug => admin.from('kb_articles').insert({ ...row, slug }).select(KB_DRAFT_DETAIL_COLUMNS).single()
      // Same duplicate-slug retry as /helpdesk/kb/manage.
      let res = await insert(baseSlug)
      if (res.error?.code === '23505') res = await insert(`${baseSlug}-${Date.now().toString(36).slice(-4)}`)
      if (res.error) {
        console.error('bot kb create:', res.error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not create the article.' } }
      }
      const article = res.data

      // The article exists either way, so a link failure is reported, not returned as an error.
      const warnings = []
      let linked = null
      if (ticket) {
        const { error: lErr } = await admin.from('kb_article_tickets')
          .insert({ article_id: article.id, ticket_id: ticket.id, linked_by: actor.id })
        if (lErr) {
          console.error('bot kb create link:', lErr.message)
          warnings.push(`Draft created, but linking ticket #${ticket.number} failed. Link it with POST /helpdesk/tickets/${ticket.number}/kb-links.`)
        } else linked = linkedTicket
      }
      return {
        status: 201,
        body: { data: shapeKbDraft(article), linked_ticket: linked, ...(warnings.length ? { warnings } : {}) },
        targetIds: [article.id],
      }
    })
  })
}
