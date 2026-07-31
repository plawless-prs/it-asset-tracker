// Server-side spreadsheet parse for the Price Update Processor.
// Given a pu_batch_files id, downloads the file from the private `price-files`
// bucket (service role) and extracts each sheet to a 2-D array of raw rows for
// the column-mapping UI. SheetJS handles .xlsx/.xls/.csv. Cells are read with
// raw:false so numbers/dates arrive as the formatted text the vendor sees; the
// client's buildLinesFromRows() does the defensive numeric parsing.
//
// Requires a valid Supabase access token (Bearer) whose profile has
// `priceupdates` access (admins always) — mirrors the /api/helpdesk/notify guard.
import { createAdminClient } from '../../../../lib/supabaseAdmin'
import * as XLSX from 'xlsx'

export const runtime = 'nodejs'

const MAX_ROWS = 20000   // safety cap on rows returned per sheet

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
  const fileId = body?.file_id
  if (!fileId) return Response.json({ error: 'file_id required' }, { status: 400 })

  const { data: file, error: fErr } = await supabase
    .from('pu_batch_files').select('id, storage_path, file_name').eq('id', fileId).single()
  if (fErr || !file) return Response.json({ error: 'file not found' }, { status: 404 })

  const { data: blob, error: dErr } = await supabase.storage.from('price-files').download(file.storage_path)
  if (dErr || !blob) return Response.json({ error: 'download failed' }, { status: 502 })

  let wb
  try {
    const buf = Buffer.from(await blob.arrayBuffer())
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch (e) {
    return Response.json({ error: 'Could not read this file as a spreadsheet: ' + String(e?.message || e) }, { status: 422 })
  }

  let truncated = false
  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name]
    let rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null, blankrows: false })
    if (rows.length > MAX_ROWS) { rows = rows.slice(0, MAX_ROWS); truncated = true }
    return { name, rows }
  })

  return Response.json({ file: { id: file.id, file_name: file.file_name }, sheets, truncated })
}
