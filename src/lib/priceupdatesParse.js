// Client-side helpers that drive the parse flow: fetch raw rows from the
// server parse route, and apply a mapping config to a file (write pu_lines,
// mark the file parsed, recompute batch counts, optionally save a parse
// profile). Kept separate from the pure lib/priceupdates.js because these touch
// the network + the Supabase client. Reused by the mapping UI and the batch
// page's one-click auto-parse.
import { buildLinesFromRows } from './priceupdates'

// POST the file to the server parse route -> { file, sheets:[{name,rows}], truncated }
export async function fetchParsedSheets(supabase, fileId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  const res = await fetch('/api/priceupdates/parse-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ file_id: fileId }),
  })
  let json = null
  try { json = await res.json() } catch { /* non-JSON error */ }
  if (!res.ok) throw new Error(json?.error || `Parse failed (${res.status})`)
  return json
}

function pickSheet(sheets, name) {
  return sheets.find(s => s.name === name) || sheets[0]
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

  // Save the profile first so the file can reference it.
  let profileId = null
  if (saveProfile && batch.vendor_id) {
    const { data: prof, error: pErr } = await supabase
      .from('pu_parse_profiles')
      .insert({ vendor_id: batch.vendor_id, label: saveProfile.label || 'Default', config, created_by: userId })
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
