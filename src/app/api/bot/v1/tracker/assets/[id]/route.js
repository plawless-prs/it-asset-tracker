// Bot API — one IT Tracker asset. [id] = the numeric asset id or its asset tag
// (`PRS-00042`, case-insensitive).
//   GET (assets:read) the asset (detail fields) + its last 20 History entries.
//   PATCH (assets:write) edit allow-listed fields (same rules as AssetModal).
//       Assignment goes through /checkout + /checkin, never PATCH.
//       Idempotency-Key optional; ?dry_run=1.
// Cost fields and photos are never returned or accepted. See docs/bot-api.md.
import {
  requireBotScope, botJson, botFail, requireBotWrite, idempotencyKeyFrom, botWriteJson, runWrite,
} from '../../../../../../../lib/botAuth'
import { withValidation, readBody, invalid } from '../../../../../../../lib/botWrite'
import {
  ASSET_DETAIL_COLUMNS, ASSET_WRITE_FIELDS, findAsset, shapeAssetDetail, readAssetFields, checkTypeRules,
  checkLocationRoom, checkDuplicateSerial, loadAsset, assertNotLocked, botActorLabel, logAssetHistory,
} from '../../../../../../../lib/botTracker'

export const runtime = 'nodejs'

export async function GET(req, { params }) {
  const auth = await requireBotScope(req, 'assets:read')
  if (auth.error) return auth.error
  const { admin } = auth

  const { id: rawId } = await params
  const { id, asset, invalid: bad, error } = await findAsset(admin, rawId)
  if (bad) return botFail(auth, req, 400, 'invalid_param', "Asset id must be a numeric id or an asset tag like 'PRS-00042'.", { id })
  if (error) {
    console.error('bot asset detail:', error.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load asset.', { id })
  }
  if (!asset) return botFail(auth, req, 404, 'not_found', 'Asset not found.', { id })

  const { data: history, error: hErr } = await admin
    .from('audit_log')
    .select('action, detail, created_at')
    .eq('entity_type', 'asset')
    .eq('entity_id', asset.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (hErr) {
    console.error('bot asset history:', hErr.message)
    return botFail(auth, req, 500, 'internal_error', 'Could not load asset history.', { id })
  }

  return botJson(auth, req, {
    data: { asset: shapeAssetDetail(asset), history: history || [] },
  }, { count: 1, params: { id } })
}

const EDIT_FIELDS = ASSET_WRITE_FIELDS.filter(f => f !== 'allow_duplicate_serial')

export async function PATCH(req, { params }) {
  const auth = await requireBotWrite(req, 'assets:write', { targetType: 'asset' })
  if (auth.error) return auth.error
  const { admin, actor } = auth
  const { id: rawId } = await params

  return withValidation(auth, req, async (ctx) => {
    const body = await readBody(req, ctx)
    const { fields, allowDuplicateSerial } = readAssetFields(body, { create: false })
    if (!EDIT_FIELDS.some(f => fields[f] !== undefined)) invalid(`Send at least one of: ${EDIT_FIELDS.join(', ')}.`)

    const asset = await loadAsset(admin, rawId)
    assertNotLocked(asset)
    if (fields.status === 'Deployed' && asset.status !== 'Deployed') {
      invalid("To deploy an asset, use POST /tracker/assets/{id}/checkout (assignment and status change together).")
    }
    checkTypeRules(fields, asset)
    // Changing location clears a room from the old location (AssetModal's setLocation).
    if (fields.location_id !== undefined && fields.location_id !== (asset.location_id ?? null)
      && fields.room_id === undefined && asset.room_id) {
      fields.room_id = null
    }
    const { location, room } = await checkLocationRoom(admin, fields, asset)

    // Only fields whose value actually changes are written.
    const changed = EDIT_FIELDS.filter(f => fields[f] !== undefined && (asset[f] ?? null) !== fields[f])
    const serialChanged = changed.includes('serial_number')
      && String(asset.serial_number || '').toLowerCase() !== String(fields.serial_number || '').toLowerCase()
    if (serialChanged) {
      await checkDuplicateSerial(admin, fields.serial_number, { excludeId: asset.id, allow: allowDuplicateSerial })
    }

    const idem = await idempotencyKeyFrom(auth, req)
    if (idem.error) return idem.error
    const targetIds = [String(asset.id)]

    if (!changed.length) {
      return botWriteJson(auth, req, {
        data: shapeAssetDetail(asset), changed: [], unchanged: true,
        ...(auth.dryRun ? { dry_run: true } : {}),
      }, { summary: ctx.summary, targetIds })
    }

    const patch = Object.fromEntries(changed.map(f => [f, fields[f]]))
    patch.updated_at = new Date().toISOString()

    if (auth.dryRun) {
      const wouldBe = {
        ...asset, ...patch,
        location_obj: 'location_id' in patch ? (location ?? null) : asset.location_obj,
        room: 'room_id' in patch ? (room ?? null) : asset.room,
      }
      return botWriteJson(auth, req, { data: shapeAssetDetail(wouldBe), changed, dry_run: true }, { summary: ctx.summary, targetIds })
    }

    const route = `PATCH /tracker/assets/${asset.id}`
    return runWrite(auth, req, { route, body, idemKey: idem.key, summary: ctx.summary }, async () => {
      // Guarded on the status we validated against, so a concurrent dispose /
      // checkout isn't overwritten.
      let q = admin.from('assets').update(patch).eq('id', asset.id)
      q = asset.status == null ? q.is('status', null) : q.eq('status', asset.status)
      const { data: updated, error } = await q.select(ASSET_DETAIL_COLUMNS).maybeSingle()
      if (error) {
        console.error('bot asset update:', error.message)
        return { error: { status: 500, code: 'internal_error', message: 'Could not update the asset.' }, targetIds }
      }
      if (!updated) {
        return { error: { status: 409, code: 'conflict', message: 'The asset changed while updating. Re-read it and retry.' }, targetIds }
      }
      await logAssetHistory(admin, actor, asset.id, 'updated',
        `Asset "${updated.name}" updated by ${botActorLabel(actor)} (${changed.join(', ')})`)
      return { status: 200, body: { data: shapeAssetDetail(updated), changed }, targetIds }
    })
  })
}
