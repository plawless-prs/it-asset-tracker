// Bot API — check an asset out to an employee. [id] = numeric id or asset tag.
//   POST (assets:write) { employee_id } (an active employee). Same patch as
//       confirmCheckout() in tracker/assets/page.js: status 'Deployed' +
//       assignment. Refused for rack-mountable assets and assets that are
//       already Deployed (AssetDetail's Check Out gating), and for Disposed /
//       Lost/Stolen ones. Idempotency-Key optional; ?dry_run=1. See docs/bot-api.md.
import { requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite, replayIfCompleted } from '../../../../../../../../lib/botAuth'
import { withValidation, readBody, allowKeys, uuidField, reject } from '../../../../../../../../lib/botWrite'
import {
  ASSET_DETAIL_COLUMNS, findAsset, shapeAssetDetail, loadAsset, assertNotLocked, loadActiveEmployee,
  botActorLabel, logAssetHistory,
} from '../../../../../../../../lib/botTracker'

export const runtime = 'nodejs'

export async function POST(req, { params }) {
  const auth = await requireBotWrite(req, 'assets:write', { targetType: 'asset' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    // Exact replays are answered before any state-dependent check (see replayIfCompleted).
    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const replay = await replayIfCompleted(auth, req, idem.key, async () => { const a = (await findAsset(admin, rawId, 'id')).asset; return a ? `POST /tracker/assets/${a.id}/checkout` : null }, body)
    if (replay) return replay
    allowKeys(body, ['employee_id'])
    const employeeId = uuidField(body, 'employee_id', { required: true })

    const asset = await loadAsset(admin, rawId)
    assertNotLocked(asset)
    if (asset.rack_mountable) {
      reject(409, 'not_checkoutable', 'Rack-mountable assets are infrastructure and can\'t be checked out to a person.')
    }
    if (asset.status === 'Deployed') {
      reject(409, 'not_checkoutable', `This asset is already deployed${asset.assigned_to ? ` (to ${asset.assigned_to})` : ''}. Check it in first.`)
    }
    const employee = await loadActiveEmployee(admin, employeeId)

    const targetIds = [String(asset.id)]

    const now = new Date().toISOString()
    const patch = {
      status: 'Deployed',
      assigned_employee_id: employee.id,
      assigned_to: employee.full_name,
      assigned_date: now,
      updated_at: now,
    }

    if (auth.dryRun) {
      const wouldBe = { ...asset, ...patch, employee }
      return botWriteJson(auth, req, { data: shapeAssetDetail(wouldBe), dry_run: true }, { summary: ctx.summary, targetIds })
    }

    const route = `POST /tracker/assets/${asset.id}/checkout`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      // Guarded on the validated state so a concurrent checkout/dispose isn't overwritten.
      const { data: updated, error } = await admin
        .from('assets').update(patch)
        .eq('id', asset.id).eq('status', asset.status).eq('rack_mountable', false)
        .select(ASSET_DETAIL_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot asset checkout:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not check out the asset.' }, targetIds }
      }
      if (!updated) {
        return { error: { status: 409, code: 'conflict', message: 'The asset changed while checking out. Re-read it and retry.' }, targetIds }
      }
      await logAssetHistory(admin, actor, asset.id, 'checked_out',
        `"${updated.name}" checked out to ${employee.full_name} by ${botActorLabel(actor)}`)
      return { status: 200, body: { data: shapeAssetDetail(updated) }, targetIds }
    })
  })
}
