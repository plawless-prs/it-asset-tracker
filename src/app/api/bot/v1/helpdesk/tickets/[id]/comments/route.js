// Bot API — add an INTERNAL note to a ticket (scope helpdesk:write).
// [id] = ticket uuid or number. Bots never post public comments (they'd be
// visible to the requester), and an internal note doesn't count as a first
// response, so first_responded_at is left alone. No email is sent.
//   POST { body, visibility?: 'internal' }  — Idempotency-Key required; ?dry_run=1
import { requireBotWrite, requireIdempotencyKey, botWriteJson, runWrite, replayIfCompleted } from '../../../../../../../../lib/botAuth'
import { findTicket, person, shapeComment } from '../../../../../../../../lib/botHelpdesk'
import {
  withValidation, readBody, allowKeys, strField, loadTicket, reject, LIMITS, COMMENT_COLUMNS,
} from '../../../../../../../../lib/botHelpdeskWrite'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const auth = await requireBotWrite(req, 'helpdesk:write', { targetType: 'comment' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await requireIdempotencyKey(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const t = (await findTicket(admin, rawId, 'id')).ticket; return t ? `POST /helpdesk/tickets/${t.id}/comments` : null }, body)
    if (replay) return replay
    allowKeys(body, ['body', 'visibility'])
    const text = strField(body, 'body', { required: true, max: LIMITS.text })
    if (body.visibility !== undefined && body.visibility !== 'internal') {
      if (body.visibility === 'public') {
        reject(422, 'public_comments_disabled', 'Bots can only add internal notes; public comments are disabled.')
      }
      reject(400, 'invalid_param', "'visibility' must be 'internal' (the only value accepted).")
    }
    const ticket = await loadTicket(admin, rawId, 'id, number')

    if (auth.dryRun) {
      return botWriteJson(auth, req, {
        data: { id: null, visibility: 'internal', author: person(actor), body: text, created_at: null },
        ticket: { id: ticket.id, number: ticket.number },
        dry_run: true,
      }, { summary: ctx.summary, targetIds: [ticket.id] })
    }

    const route = `POST /helpdesk/tickets/${ticket.id}/comments`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: c, error } = await admin.from('ticket_comments').insert({
        ticket_id: ticket.id, author_id: actor.id, body: text, is_internal: true, via_client_id: auth.client.id,
      }).select(COMMENT_COLUMNS).single()
      if (error) {
        console.error('bot ticket comment:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not add the comment.' }, targetIds: [ticket.id] }
      }
      return {
        status: 201,
        body: { data: shapeComment(c), ticket: { id: ticket.id, number: ticket.number } },
        targetIds: [c.id],
      }
    })
  })
}
