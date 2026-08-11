// Client-side helpers that drive the parse flow: fetch raw rows from the
// server parse route, and apply a mapping config to a file (write pu_lines,
// mark the file parsed, recompute batch counts, optionally save a parse
// profile). Kept separate from the pure lib/priceupdates.js because these touch
// the network + the Supabase client. Reused by the mapping UI and the batch
// page's one-click auto-parse.
import { buildLinesFromRows, slugify, sanitizeFileName, dateFolderMMDDYY } from './priceupdates'

// Upload files to a batch: object under `<batchId>/`, a pu_batch_files row
// each, then (best-effort) archive copies into the file library under the
// vendor's effective-date folder — library/<vendor>/<year>/<MM-DD-YY>/.
// Shared by the New Batch modal and the batch-detail "Add files" action so
// late-arriving files get the identical treatment. `vendor` is { id, name }
// or null (no archiving without one). Throws on upload/record failure.
export async function uploadBatchFiles(supabase, { batchId, vendor, effectiveDate, files, userId }) {
  const uploaded = []
  for (const file of files) {
    const safe = sanitizeFileName(file.name)
    const path = `${batchId}/${Date.now()}-${safe}`
    const { error: upErr } = await supabase.storage.from('price-files').upload(path, file)
    if (upErr) throw upErr
    const { error: fErr } = await supabase.from('pu_batch_files').insert({
      batch_id: batchId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
    })
    if (fErr) throw fErr
    uploaded.push({ path, safe, name: file.name, type: file.type, size: file.size })
  }

  if (vendor) {
    try {
      const eff = effectiveDate || new Date().toISOString().slice(0, 10)
      const year = Number(String(eff).slice(0, 4))
      const folder = `library/${slugify(vendor.name)}/${year}/${dateFolderMMDDYY(eff)}`
      for (const u of uploaded) {
        let dest = `${folder}/${u.safe}`
        const { error: cErr } = await supabase.storage.from('price-files').copy(u.path, dest)
        if (cErr) {  // same-named file already archived there — keep both
          dest = `${folder}/${Date.now()}-${u.safe}`
          const retry = await supabase.storage.from('price-files').copy(u.path, dest)
          if (retry.error) continue
        }
        await supabase.from('pu_library_files').insert({
          vendor_id: vendor.id, year, file_name: u.name, storage_path: dest,
          mime_type: u.type || null, file_size: u.size, batch_id: batchId,
          source: 'batch', uploaded_by: userId || null,
        })
      }
    } catch { /* library archiving is best-effort */ }
  }
  return uploaded.length
}

// POST the file to the server parse route -> { file, sheets:[{name,rows}], truncated }.
// The route windows big sheets at 20k rows per response (Vercel response-size
// cap), so this pages with `offset` until every sheet is complete — callers
// always receive full sheets (`truncated` is false unless something failed).
export async function fetchParsedSheets(supabase, fileId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  async function fetchWindow(offset) {
    const res = await fetch('/api/priceupdates/parse-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ file_id: fileId, offset }),
    })
    let json = null
    try { json = await res.json() } catch { /* non-JSON error */ }
    if (!res.ok) throw new Error(json?.error || `Parse failed (${res.status})`)
    return json
  }

  const first = await fetchWindow(0)
  const sheets = (first.sheets || []).map(s => ({ ...s, rows: [...s.rows] }))
  const windowSize = Math.max(...sheets.map(s => s.rows.length), 1)
  const maxTotal = Math.max(...sheets.map(s => s.total_rows ?? s.rows.length), 0)

  for (let offset = windowSize; offset < maxTotal; offset += windowSize) {
    const page = await fetchWindow(offset)
    for (const ps of page.sheets || []) {
      const target = sheets.find(s => s.name === ps.name)
      if (target && ps.rows.length) target.rows.push(...ps.rows)
    }
  }

  const complete = sheets.every(s => s.rows.length >= (s.total_rows ?? s.rows.length))
  return {
    file: first.file,
    sheets: sheets.map(({ name, rows }) => ({ name, rows })),
    truncated: !complete,
  }
}

function pickSheet(sheets, name) {
  return sheets.find(s => s.name === name) || sheets[0]
}

// Small helper to call a Bearer-authed priceupdates API route.
async function postWithSession(supabase, path, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body || {}),
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
  return json
}

// Run the matching pass for a batch (parse -> match, and re-runnable).
export function triggerMatch(supabase, batchId) {
  return postWithSession(supabase, '/api/priceupdates/match', { batch_id: batchId })
}

// Generate the P21 import file for an approved batch (Phase 5). Returns
// { export, row_count, file_name, signedUrl } — signedUrl is a short-lived
// download link for the generated .txt.
export function generateExport(supabase, batchId) {
  return postWithSession(supabase, '/api/priceupdates/export', { batch_id: batchId })
}

// Prove the Vercel→P21 connection + view/field names without writing anything.
// This is the fallback path only — real syncs run on the on-prem worker
// (worker/), requested via pu_settings.sync_requested_at.
export function testP21(supabase) {
  return postWithSession(supabase, '/api/p21/sync-items', { test: true })
}

// Apply a mapping `config` to a file's rows and persist the result.
//   - batch:  { id, vendor_id, status }
//   - file:   { id, parse_profile_id }
//   - sheets: as returned by fetchParsedSheets
//   - saveProfile: falsy, or { label } to save the config as a vendor profile
// Returns { inserted, skippedNoPrice, profileId }.
export async function applyParse(supabase, { batch, file, sheets, config, userId, saveProfile }) {
  const sheet = pickSheet(sheets, config.sheet)
  if (!sheet) throw new Error('Sheet not found in file')

  const { lines, skippedNoPrice } = buildLinesFromRows(sheet.rows, config)
  if (lines.length === 0) throw new Error('This mapping produced no usable price lines')

  // Save the profile first so the file can reference it. The header-row text
  // is stashed in the config as a fingerprint (`header_signature`) so future
  // email intake can recognize "this file looks like Gates' usual sheet" and
  // Phase 6b can pick the right profile automatically.
  let profileId = null
  if (saveProfile && batch.vendor_id) {
    const headerRow = sheet.rows[config.header_row] || []
    const configToSave = {
      ...config,
      header_signature: headerRow.map(c => String(c ?? '').trim()).filter(Boolean).slice(0, 30),
    }
    const { data: prof, error: pErr } = await supabase
      .from('pu_parse_profiles')
      .insert({ vendor_id: batch.vendor_id, label: saveProfile.label || 'Default', config: configToSave, created_by: userId })
      .select('id').single()
    if (pErr) throw pErr
    profileId = prof.id
  }

  // Re-parse is idempotent: clear this file's prior lines before inserting.
  await supabase.from('pu_lines').delete().eq('file_id', file.id)

  const rowsToInsert = lines.map(l => ({ ...l, batch_id: batch.id, file_id: file.id }))
  const CHUNK = 500
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const { error } = await supabase.from('pu_lines').insert(rowsToInsert.slice(i, i + CHUNK))
    if (error) throw error
  }

  await supabase.from('pu_batch_files').update({
    parse_status: 'parsed',
    parsed_rows: lines.length,
    parse_profile_id: profileId || file.parse_profile_id || null,
    error: null,
  }).eq('id', file.id)

  // Recompute the batch line_count from all its (possibly multi-file) lines.
  const { count } = await supabase
    .from('pu_lines').select('id', { count: 'exact', head: true }).eq('batch_id', batch.id)
  const advance = ['received', 'parsing', 'failed'].includes(batch.status)
  await supabase.from('pu_batches').update({
    line_count: count ?? lines.length,
    status: advance ? 'needs_review' : batch.status,
    error: null,
  }).eq('id', batch.id)

  return { inserted: lines.length, skippedNoPrice, profileId }
}
