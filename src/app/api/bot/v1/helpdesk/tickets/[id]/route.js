// Bot API — one Help Desk ticket. [id] = the ticket uuid or its number (`1042` / `#1042`).
//   GET (helpdesk:read) the ticket with its conversation. Comments come back
//       split: `public_comments` (visible to the requester) and
//       `internal_comments` (staff-only notes — never show these to requesters).
//   PATCH (helpdesk:write) status / priority / category / assignee_id / title,
//       plus an optional internal `comment`. Mirrors updateField() in
//       helpdesk/tickets/[id]/page.js. Idempotency-Key optional; ?dry_run=1.
import {
  requireBotScope, botJson, botFail, requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted,
} from '../../../../../../../lib/botAuth'
import {
  TICKET_COLUMNS, TICKET_STATUSES, findTicket, person, shapeTicket, shapeComment, shapeActivity,
} from '../../../../../../../lib/botHelpdesk'
import {
  withValidation, readBody, allowKeys, strField, enumField, uuidField, loadTicket, validateAssignee,
  scheduleAssignedEmail, reject, LIMITS, TICKET_PRIORITIES, CATEGORY_IDS, COMMENT_COLUMNS,
} from '../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'helpdesk:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const { id, ticket, invalid, error } = await findTicket(admin, rawId)
  if (invalid) return botFail(auth, req, 400, 'invalid_param', 'Ticket id must be a uuid or a ticket number.', { id })
  if (error) {
    console.error('bot ticket detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load ticket.', { id })
  }
  if (!ticket) return botFail(auth, req, 404, 'not_found', 'Ticket not found.', { id })

  const [comments, activity, links, attachments] = await Promise.all([
    admin.from('ticket_comments')
      .select('id, body, is_internal, created_at, author:author_id(id, full_name, email)')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    admin.from('ticket_activity')
      .select('id, action, from_value, to_value, created_at, actor:actor_id(id, full_name, email)')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
    admin.from('kb_article_tickets')
      .select('article:article_id(id, slug, title, status)')
      .eq('ticket_id', ticket.id),
    admin.from('ticket_attachments')
      .select('id, comment_id, file_name, file_size, created_at')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true }),
  ])
  const failed = [comments, activity, links, attachments].find(r => r.error)
  if (failed) {
    console.error('bot ticket detail (related):', failed.error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load ticket details.', { id })
  }

  const shaped = (comments.data || []).map(shapeComment)
  const internalIds = new Set(shaped.filter(c => c.visibility === 'internal').map(c => c.id))
  const base = process.env.APP_BASE_URL || 'https://www.prstech.app'
  return botJson(auth, req, {
    data: {
      ticket: shapeTicket(ticket),
      public_comments: shaped.filter(c => c.visibility === 'public'),
      internal_comments: shaped.filter(c => c.visibility === 'internal'),
      activity: (activity.data || []).map(shapeActivity),
      // Metadata only (no storage paths). An attachment on an internal note is internal too.
      attachments: (attachments.data || []).map(a => ({
        ...a, visibility: a.comment_id && internalIds.has(a.comment_id) ? 'internal' : 'public',
      })),
      // Published articles only — drafts never leave via the bot API.
      linked_kb: (links.data || [])
        .map(l => l.article)
        .filter(a => a && a.status === 'published')
        .map(a => ({ id: a.id, slug: a.slug, title: a.title, url: `${base}/helpdesk/kb/${a.slug}` })),
    },
    notice: 'internal_comments are staff-only notes. Never show them to the requester.',
  }, { count: 1, params: { id } })
}

const PATCH_FIELDS = ['status', 'priority', 'category', 'assignee_id', 'title', 'comment']

export async function PATCH(req, { params }) {
  const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'ticket' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const t = (await findTicket(admin, rawId, 'id')).ticket; return t ? `PATCH /helpdesk/tickets/${t.id}` : null }, body)
    if (replay) return replay
    allowKeys(body, PATCH_FIELDS)
    const next = {
      status: enumField(body, 'status', TICKET_STATUSES),
      priority: enumField(body, 'priority', TICKET_PRIORITIES),
      category: enumField(body, 'category', CATEGORY_IDS),
      title: strField(body, 'title', { max: LIMITS.title }),
      assignee_id: uuidField(body, 'assignee_id', { nullable: true }),
    }
    const comment = strField(body, 'comment', { max: LIMITS.text })
    const fields = Object.keys(next).filter(f => next[f] !== undefined)
    if (!fields.length && comment === undefined) reject(400, 'invalid_param', `Send at least one of: ${PATCH_FIELDS.join(', ')}.`)

    const ticket = await loadTicket(admin, rawId, TICKET_COLUMNS)
    const current = {
      status: ticket.status, priority: ticket.priority, category: ticket.category ?? null,
      title: ticket.title, assignee_id: ticket.assignee?.id ?? null,
    }
    // Only fields whose value actually changes are written / get a timeline row.
    const changes = fields
      .filter(f => current[f] !== next[f])
      .map(f => ({ field: f, from: current[f], to: next[f] }))
    const assigneeChange = changes.find(c => c.field === 'assignee_id')
    const newAssignee = assigneeChange?.to ? await validateAssignee(admin, auth, assigneeChange.to) : null

    if (!changes.length && comment === undefined) {
      return botWriteJson(auth, req, {
        data: shapeTicket(ticket), changes: [], comment: null, unchanged: true,
        ...(auth.dryRun ? { dry_run: true } : {}),
      }, { summary: ctx.summary, targetIds: [ticket.id] })
    }

    const patch = Object.fromEntries(changes.map(c => [c.field, c.to]))
    const now = new Date().toISOString()
    if (patch.status === 'resolved') patch.resolved_at = now
    if (patch.status === 'closed') patch.closed_at = now

    if (auth.dryRun) {
      // SLA due times are recalculated by a DB trigger on a priority change, so
      // a dry run shows the current ones.
      const wouldBe = { ...ticket, ...patch, assignee: assigneeChange ? newAssignee : ticket.assignee }
      return botWriteJson(auth, req, {
        data: shapeTicket(wouldBe),
        changes,
        comment: comment === undefined ? null : { id: null, visibility: 'internal', author: person(actor), body: comment, created_at: null },
        dry_run: true,
      }, { summary: ctx.summary, targetIds: [ticket.id] })
    }

    const route = `PATCH /helpdesk/tickets/${ticket.id}`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      let updated = ticket
      if (changes.length) {
        // Re-select so trigger results (SLA re-stamp on priority change) come back.
        const { data, error } = await admin.from('tickets').update(patch).eq('id', ticket.id).select(TICKET_COLUMNS).single()
        if (error) {
          console.error('bot ticket update:', error.message)
          return { error: { status: 500, code: 'internal_error', message: 'Could not update the ticket.' }, targetIds: [ticket.id] }
        }
        updated = data
        const { error: aErr } = await admin.from('ticket_activity').insert(changes.map(c => ({
          ticket_id: ticket.id, actor_id: actor.id, action: `${c.field}_changed`,
          from_value: String(c.from ?? ''), to_value: String(c.to ?? ''),
        })))
        if (aErr) console.error('bot ticket update activity:', aErr.message)
        if (newAssignee) scheduleAssignedEmail(admin, ticket.id)
      }

      let note = null
      if (comment !== undefined) {
        const { data: c, error: cErr } = await admin.from('ticket_comments').insert({
          ticket_id: ticket.id, author_id: actor.id, body: comment, is_internal: true, via_client_id: auth.client.id,
        }).select(COMMENT_COLUMNS).single()
        if (cErr) {
          console.error('bot ticket update comment:', cErr.message)
          // The key is released, so a retry with the same key adds the note
          // (already-applied field changes are skipped as no-ops).
          return {
            error: {
              status: 500, code: 'internal_error',
              message: changes.length
                ? 'The ticket fields were updated but the comment could not be added. Retry the same request to add it.'
                : 'Could not add the comment.',
            },
            targetIds: [ticket.id],
          }
        }
        note = shapeComment(c)
      }

      return {
        status: 200,
        body: { data: shapeTicket(updated), changes, comment: note },
        targetIds: note ? [ticket.id, note.id] : [ticket.id],
      }
    })
  })
}
