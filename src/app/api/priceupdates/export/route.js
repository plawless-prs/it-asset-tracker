// Generates the P21-ready import file for an approved batch (Phase 5).
// Layout matches price-update-processor/samples/GAT2026.txt exactly: a
// tab-delimited .txt with CRLF line endings, a header row, and columns in this
// fixed order — Item ID, List Price, New Cost, Supplier ID. P21's import tool
// reads columns by POSITION, not by header name, so the order must never change.
// File name is `<vendor P21 prefix><effective year>.txt` (e.g. GAT2026.txt).
//
// Only lines that are included AND matched are exported. P21 treats a blank
// cell as "no change", so a cost-only / list-only line leaves the other price
// column empty rather than restating the mirror's current value.
//
// Auth mirrors /api/priceupdates/parse-file: Bearer token whose profile has
// `priceupdates` access (admins always). Writes the file to the private
// `price-files` bucket via the service role and returns a short-lived signed
// URL for immediate download.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import { slugify, dateFolderMMDDYY } from '../../../../lib/priceupdates'

export const runtime = 'nodejs'

const PAGE = 1000   // PostgREST caps un-ranged selects at 1000 — always page

// Emit numerics the way the sample does: plain, no padding, no trailing zeros
// ("51028.7", not "51028.70"). Null/blank stays an empty cell.
function cell(v) {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return isNaN(n) ? '' : String(n)
}

export async function POST(req) {
  const accessToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: { user }, error: uErr } = await supabase.auth.getUser(accessToken)
  if (uErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles').select('role, app_access').eq('id', user.id).single()
  const access = Array.isArray(profile?.app_access) ? profile.app_access : []
  const allowed = profile?.role === 'admin' || access.includes('priceupdates')
  if (!allowed) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body
  try { body = await req.json() } catch { return Response.json({ error: 'invalid json' }, { status: 400 }) }
  const batchId = body?.batch_id
  if (!batchId) return Response.json({ error: 'batch_id required' }, { status: 400 })

  const { data: batch, error: bErr } = await supabase
    .from('pu_batches')
    .select('id, number, status, effective_date, notes, vendor:vendor_id(id, name, p21_supplier_id, p21_item_prefix)')
    .eq('id', batchId).single()
  if (bErr || !batch) return Response.json({ error: 'batch not found' }, { status: 404 })

  if (!['approved', 'exported'].includes(batch.status)) {
    return Response.json({ error: `batch is ${batch.status} — approve it before exporting` }, { status: 409 })
  }
  const supplierId = String(batch.vendor?.p21_supplier_id || '').trim()
  if (!supplierId) {
    return Response.json({ error: 'the batch vendor has no P21 supplier id — set it on the vendor first' }, { status: 422 })
  }

  // Included + matched lines only, ordered like the sample (new cost, high→low).
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pu_lines')
      .select('p21_item_id, new_cost, new_list')
      .eq('batch_id', batchId).eq('include', true).eq('match_status', 'matched')
      .order('new_cost', { ascending: false, nullsFirst: false }).order('id')
      .range(from, from + PAGE - 1)
    if (error) return Response.json({ error: `reading lines failed: ${error.message}` }, { status: 502 })
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  if (rows.length === 0) {
    return Response.json({ error: 'no included matched lines to export' }, { status: 422 })
  }

  const lines = ['Item ID\tList Price\tNew Cost\tSupplier ID']
  for (const r of rows) {
    lines.push(`${r.p21_item_id || ''}\t${cell(r.new_list)}\t${cell(r.new_cost)}\t${supplierId}`)
  }
  const content = lines.join('\r\n') + '\r\n'

  const prefix = String(batch.vendor.p21_item_prefix || batch.vendor.name || 'EXPORT')
    .trim().replace(/\s+/g, '').toUpperCase()
  const year = batch.effective_date
    ? String(batch.effective_date).slice(0, 4)
    : String(new Date().getFullYear())
  const fileName = `${prefix}${year}.txt`
  const storagePath = `exports/${batch.id}/${Date.now()}-${fileName}`

  const { error: upErr } = await supabase.storage
    .from('price-files')
    .upload(storagePath, Buffer.from(content, 'utf8'), { contentType: 'text/plain' })
  if (upErr) return Response.json({ error: `upload failed: ${upErr.message}` }, { status: 502 })

  const { data: exp, error: eErr } = await supabase
    .from('pu_exports')
    .insert({ batch_id: batch.id, storage_path: storagePath, file_name: fileName, row_count: rows.length, created_by: user.id })
    .select('id, file_name, row_count, created_at').single()
  if (eErr) return Response.json({ error: `recording export failed: ${eErr.message}` }, { status: 502 })

  // Archive a copy into the file library under the vendor's date folder
  // (same place the batch's inbound files were archived at creation), so the
  // Files page holds the outgoing file next to the incoming one. Regenerating
  // replaces the previous archived export. Best-effort — the export itself
  // already succeeded.
  try {
    const eff = batch.effective_date || new Date().toISOString().slice(0, 10)
    const folder = `library/${slugify(batch.vendor.name)}/${Number(String(eff).slice(0, 4))}/${dateFolderMMDDYY(eff)}`
    const { data: prior } = await supabase
      .from('pu_library_files').select('id, storage_path')
      .eq('batch_id', batch.id).eq('source', 'batch_export')
    if (prior?.length) {
      await supabase.storage.from('price-files').remove(prior.map(p => p.storage_path))
      await supabase.from('pu_library_files').delete().in('id', prior.map(p => p.id))
    }
    const dest = `${folder}/${fileName}`
    await supabase.storage.from('price-files').remove([dest]) // clear any stale object
    const { error: cErr } = await supabase.storage.from('price-files').copy(storagePath, dest)
    if (!cErr) {
      await supabase.from('pu_library_files').insert({
        vendor_id: batch.vendor.id, year: Number(String(eff).slice(0, 4)),
        file_name: fileName, storage_path: dest, mime_type: 'text/plain',
        file_size: Buffer.byteLength(content, 'utf8'), batch_id: batch.id,
        source: 'batch_export', uploaded_by: user.id,
      })
    }
  } catch { /* library archiving is best-effort */ }

  const stamp = new Date().toISOString()
  const activity = `[${stamp.slice(0, 16).replace('T', ' ')}] Export generated by ${user.email || 'unknown'} — ${rows.length} lines (${fileName}).`
  await supabase.from('pu_batches').update({
    status: 'exported',
    exported_at: stamp,
    notes: batch.notes ? `${batch.notes}\n${activity}` : activity,
  }).eq('id', batch.id)

  const { data: signed } = await supabase.storage
    .from('price-files')
    .createSignedUrl(storagePath, 300, { download: fileName })

  return Response.json({
    export: exp,
    row_count: rows.length,
    file_name: fileName,
    signedUrl: signed?.signedUrl || null,
  })
}
