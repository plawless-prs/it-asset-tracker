// On-arrival auto-parse (Phase 6b): when an email batch lands with spreadsheet
// attachments and an identified vendor, try to parse them with the vendor's
// saved parse profiles and run matching — so the batch reaches the queue
// already at needs_review, no clicks. Server-only (service role); triggered
// from graph-notify via next/server after() so Graph still gets its fast 2xx.
//
// Deliberately forgiving: any file it can't confidently parse is left
// `pending` with an activity note (the reviewer maps it manually, exactly as
// before) — auto-parse never marks a batch failed and never guesses between
// multiple profiles.
//
// Profile selection per file: each saved profile carries a header_signature
// (the header row's cell texts, stashed by applyParse when the profile was
// saved). The signature is scored against the first rows of each sheet — not
// just the profile's pinned header_row index — so a vendor adding or dropping
// a preamble row doesn't break recognition. Best signature score >= 0.8 wins;
// with no signature match, a vendor with exactly ONE profile falls back to it
// (same behavior as the batch page's one-click Auto-parse button).
import * as XLSX from 'xlsx'
import { createAdminClient } from './supabaseAdmin'
import { applyParse } from './priceupdatesParse'
import { matchBatch } from './matchBatch'

const SPREADSHEET = /\.(xlsx|xls|csv)$/i
const HEADER_SCAN_ROWS = 20
const MIN_SIGNATURE_SCORE = 0.8

const rowSignature = (row) => (row || []).map(c => String(c ?? '').trim()).filter(Boolean)

// Fraction of the saved signature's cells present in `row` (case-insensitive).
function signatureScore(signature, row) {
  if (!Array.isArray(signature) || signature.length === 0) return 0
  const have = new Set(rowSignature(row).map(s => s.toLowerCase()))
  const hits = signature.filter(s => have.has(String(s).toLowerCase())).length
  return hits / signature.length
}

// Pick the profile (and the header row it matches at) for a parsed file.
// Returns { profile, config } or null.
function pickProfile(profiles, sheets) {
  let best = null
  for (const p of profiles) {
    const cfg = p.config || {}
    const sheet = sheets.find(s => s.name === cfg.sheet) || sheets[0]
    if (!sheet) continue
    for (let r = 0; r < Math.min(sheet.rows.length, HEADER_SCAN_ROWS); r++) {
      const score = signatureScore(cfg.header_signature, sheet.rows[r])
      if (score >= MIN_SIGNATURE_SCORE && (!best || score > best.score)) {
        best = { score, profile: p, config: { ...cfg, sheet: sheet.name, header_row: r } }
      }
    }
  }
  if (best) return { profile: best.profile, config: best.config }
  if (profiles.length === 1) return { profile: profiles[0], config: profiles[0].config }
  return null
}

// Parse every pending spreadsheet on the batch with the vendor's profiles,
// then run matching. Best-effort throughout; returns a summary for logging.
export async function autoParseBatch(batchId) {
  const admin = createAdminClient()

  const { data: batch } = await admin
    .from('pu_batches').select('id, vendor_id, status, notes')
    .eq('id', batchId).single()
  if (!batch || !batch.vendor_id) return { skipped: 'no batch or no vendor' }
  if (!['received', 'parsing', 'needs_review', 'failed'].includes(batch.status)) {
    return { skipped: `status ${batch.status}` }
  }

  const { data: profiles } = await admin
    .from('pu_parse_profiles').select('id, label, config')
    .eq('vendor_id', batch.vendor_id).order('created_at', { ascending: false })
  if (!profiles || profiles.length === 0) return { skipped: 'vendor has no parse profiles' }

  const { data: allFiles } = await admin
    .from('pu_batch_files').select('id, file_name, storage_path, parse_status, parse_profile_id')
    .eq('batch_id', batchId).order('created_at')
  const files = (allFiles || []).filter(f => f.parse_status === 'pending' && SPREADSHEET.test(f.file_name))
  if (files.length === 0) return { skipped: 'no pending spreadsheet files' }

  const activity = []
  const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ')
  let parsedFiles = 0

  for (const f of files) {
    try {
      const { data: blob, error: dErr } = await admin.storage.from('price-files').download(f.storage_path)
      if (dErr || !blob) throw new Error(dErr?.message || 'download failed')
      const wb = XLSX.read(Buffer.from(await blob.arrayBuffer()), { type: 'buffer' })
      const sheets = wb.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null, blankrows: false }),
      }))

      const pick = pickProfile(profiles, sheets)
      if (!pick) {
        activity.push(`[${stamp()}] Auto-parse skipped ${f.file_name} — no saved profile fits this file's header. Map columns manually.`)
        continue
      }

      const { inserted, skippedNoPrice } = await applyParse(admin, {
        batch: { id: batch.id, vendor_id: batch.vendor_id, status: batch.status },
        file: { id: f.id, parse_profile_id: pick.profile.id },
        sheets,
        config: pick.config,
        saveProfile: null,
      })
      parsedFiles++
      activity.push(`[${stamp()}] Auto-parsed ${f.file_name} with profile "${pick.profile.label}" — ${inserted.toLocaleString()} lines${skippedNoPrice ? ` (${skippedNoPrice} skipped, no price)` : ''}.`)
    } catch (e) {
      activity.push(`[${stamp()}] Auto-parse could not read ${f.file_name} (${String(e?.message || e).slice(0, 120)}). Map columns manually.`)
    }
  }

  // Match everything that just parsed. Best-effort: a stale/empty mirror or a
  // vendor without a supplier id still leaves a reviewable parsed batch.
  // On-arrival is the riskiest moment for DB timing (the lines were bulk-
  // inserted seconds ago, the scoped mirror sync may just have churned the
  // mirror), so a failed pass gets one full retry — matchBatch is idempotent.
  let matchSummary = null
  if (parsedFiles > 0) {
    try {
      let r
      try {
        r = await matchBatch(admin, batchId)
      } catch {
        await new Promise(res => setTimeout(res, 5000))
        r = await matchBatch(admin, batchId)
      }
      matchSummary = r
      activity.push(`[${stamp()}] Auto-matched: ${r.matched} matched, ${r.ambiguous} ambiguous, ${r.unmatched} unmatched.${r.warning ? ` (${r.warning})` : ''}`)
    } catch (e) {
      activity.push(`[${stamp()}] Auto-match failed (${String(e?.message || e).slice(0, 120)}) — use Re-run matching on the batch.`)
    }
  }

  if (activity.length > 0) {
    const { data: fresh } = await admin.from('pu_batches').select('notes').eq('id', batchId).single()
    const existing = fresh?.notes ?? batch.notes
    const appended = activity.join('\n')
    await admin.from('pu_batches')
      .update({ notes: existing ? `${existing}\n${appended}` : appended })
      .eq('id', batchId)
  }

  return { parsedFiles, files: files.length, match: matchSummary }
}
