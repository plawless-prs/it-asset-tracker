// Bot API — check a deployed asset back in. [id] = numeric id or asset tag.
//   POST (assets:write) empty body (or {}). Same patch as handleCheckin() in
//       tracker/assets/page.js: status 'Ready to Deploy', assignment cleared.
//       Only for Deployed assets. Idempotency-Key optional; ?dry_run=1.
// See docs/bot-api.md.
import { requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted } from '../../../../../../../../lib/botAuth'
import { withValidation, readEmptyBody, reject } from '../../../../../../../../lib/botWrite'
import {
  ASSET_DETAIL_COLUMNS, findAsset, shapeAssetDetail, loadAsset, assertNotLocked, botActorLabel, logAssetHistory,
} from '../../../../../../../../lib/botTracker'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const auth = await requireBotWrite(req, 'assets:write', { targetType: 'asset' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readEmptyBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const a = (await findAsset(admin, rawId, 'id')).asset; return a ? `POST /tracker/assets/${a.id}/checkin` : null }, body)
    if (replay) return replay

    const asset = await loadAsset(admin, rawId)
    assertNotLocked(asset)
    if (asset.status !== 'Deployed') {
      reject(409, 'not_checked_out', `This asset isn't checked out (status '${asset.status}').`)
    }

    const targetIds = [String(asset.id)]

    const patch = {
      status: 'Ready to Deploy',
      assigned_employee_id: null,
      assigned_to: null,
      assigned_date: null,
      updated_at: new Date().toISOString(),
    }

    if (auth.dryRun) {
      const wouldBe = { ...asset, ...patch, employee: null }
      return botWriteJson(auth, req, { data: shapeAssetDetail(wouldBe), dry_run: true }, { summary: ctx.summary, targetIds })
    }

    const route = `POST /tracker/assets/${asset.id}/checkin`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      const { data: updated, error } = await admin
        .from('assets').update(patch)
        .eq('id', asset.id).eq('status', 'Deployed')
        .select(ASSET_DETAIL_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot asset checkin:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not check in the asset.' }, targetIds }
      }
      if (!updated) {
        return { error: { status: 409, code: 'conflict', message: 'The asset changed while checking in. Re-read it and retry.' }, targetIds }
      }
      await logAssetHistory(admin, actor, asset.id, 'checked_in', `"${updated.name}" checked in by ${botActorLabel(actor)}`)
      return { status: 200, body: { data: shapeAssetDetail(updated) }, targetIds }
    })
  })
}
