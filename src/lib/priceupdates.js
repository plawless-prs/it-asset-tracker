// Shared constants + helpers for the Price Update Processor (app id `priceupdates`).
// Mirrors lib/helpdesk.js / lib/tracker.js — import from here instead of
// re-declaring these inline in the app's pages/components.
// Colors follow the PRS Apps dark theme used across the hub.

// --- Batch status (the workflow) --------------------------------------------
// received -> parsing -> needs_review -> approved -> exported -> applied
// plus failed / archived.
export const BATCH_STATUS_META = {
  received:     { label: 'Received',     dot: '#3b82f6', pillBg: '#10243f', pillText: '#7fb4f5' },
  parsing:      { label: 'Parsing',      dot: '#9aa6b4', pillBg: '#1b2533', pillText: '#aebacc' },
  needs_review: { label: 'Needs review', dot: '#f59e0b', pillBg: '#332300', pillText: '#fbbf24' },
  approved:     { label: 'Approved',     dot: '#22c55e', pillBg: '#0d3320', pillText: '#4ade80' },
  exported:     { label: 'Exported',     dot: '#818cf8', pillBg: '#1a1a2e', pillText: '#a78bfa' },
  applied:      { label: 'Applied',      dot: '#6b7280', pillBg: '#1a1a1a', pillText: '#9aa6b4' },
  failed:       { label: 'Failed',       dot: '#ef4444', pillBg: '#330d0d', pillText: '#f87171' },
  archived:     { label: 'Archived',     dot: '#6b7280', pillBg: '#1a1a1a', pillText: '#737373' },
}

export const BATCH_STATUS_ORDER = [
  'received', 'parsing', 'needs_review', 'approved', 'exported', 'applied', 'failed', 'archived',
]

// Statuses that still need someone's attention (not a terminal/parked state).
export const OPEN_STATUSES = ['received', 'parsing', 'needs_review', 'approved', 'exported']

export function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status)
}

// --- Source (email vs. manual upload) ---------------------------------------
export const SOURCE_META = {
  email:  { label: 'Email',  icon: '✉' },
  upload: { label: 'Upload', icon: '⬆' },
}

// --- Line match status ------------------------------------------------------
export const MATCH_META = {
  matched:   { label: 'Matched',   pillBg: '#0d3320', pillText: '#4ade80' },
  unmatched: { label: 'Unmatched', pillBg: '#330d0d', pillText: '#f87171' },
  ambiguous: { label: 'Ambiguous', pillBg: '#332300', pillText: '#fbbf24' },
  new_item:  { label: 'New item',  pillBg: '#10243f', pillText: '#7fb4f5' },
}

// --- Line flag (guardrails) -------------------------------------------------
export const FLAG_META = {
  ok:             { label: 'OK',              dot: '#22c55e' },
  large_increase: { label: 'Large increase',  dot: '#ef4444' },
  decrease:       { label: 'Decrease',        dot: '#f59e0b' },
  cost_over_list: { label: 'Cost over list',  dot: '#ef4444' },
  new:            { label: 'New',             dot: '#3b82f6' },
  review:         { label: 'Review',          dot: '#9aa6b4' },
}

// --- Derived "attention" pill for the queue ---------------------------------
// The status-vs-derived-state idea from Help Desk's SLA pills: computed from the
// batch's line counts rather than stored. Returns a pill meta or null.
// --- Scheduling (calendar) helpers ------------------------------------------

// Business dates run on Central time (the company timezone) so a batch flips
// to "due today" at midnight in the office, not at midnight UTC.
export function todayCentral() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

// Whole days from `fromISO` to `toISO` (both 'YYYY-MM-DD'); negative = past.
export function daysUntil(toISO, fromISO = todayCentral()) {
  const [fy, fm, fd] = String(fromISO).split('-').map(Number)
  const [ty, tm, td] = String(toISO).slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000)
}

// Derived readiness of a scheduled batch (never stored — same idea as SLA
// state): ready = fully prepped for its effective date; prep = work remains.
export function batchReadiness(batch) {
  if (!batch) return null
  if (['applied', 'archived'].includes(batch.status)) return 'done'
  if (['approved', 'exported'].includes(batch.status)) return 'ready'
  return 'prep'
}

export function attentionPill(batch) {
  if (!batch) return null
  const unmatched = (batch.line_count || 0) - (batch.matched_count || 0)
  if (batch.status === 'failed') {
    return { label: 'Failed', pillBg: '#330d0d', pillText: '#f87171' }
  }

  // A placeholder batch created from a price-update notification before the
  // vendor released the file (file_count comes from a pu_batch_files(count)
  // embed — undefined when the caller didn't fetch it).
  const awaitingFile = batch.file_count === 0 && batch.status === 'received'

  // Effective-date awareness: an unapplied batch at/past its date outranks
  // everything below; a near-future one that isn't prepped gets a warning.
  if (batch.effective_date && !['applied', 'archived'].includes(batch.status)) {
    const d = daysUntil(batch.effective_date)
    const ready = batchReadiness(batch) === 'ready'
    const why = awaitingFile ? 'awaiting file' : 'not ready'
    if (d < 0) {
      return ready
        ? { label: `Overdue ${-d}d — load into P21`, pillBg: '#330d0d', pillText: '#f87171' }
        : { label: `Overdue ${-d}d — ${why}`, pillBg: '#330d0d', pillText: '#f87171' }
    }
    if (d === 0) {
      return ready
        ? { label: 'Load into P21 today', pillBg: '#1a1a2e', pillText: '#a78bfa' }
        : { label: `Due today — ${why}`, pillBg: '#330d0d', pillText: '#f87171' }
    }
    if (d <= 7 && !ready) {
      return { label: `Due in ${d}d — ${awaitingFile ? 'awaiting file' : 'needs prep'}`, pillBg: '#332300', pillText: '#fbbf24' }
    }
  }

  if (awaitingFile) {
    return { label: 'Awaiting file', pillBg: '#13202e', pillText: '#7fb4f5' }
  }
  if (batch.status === 'exported') {
    return { label: 'Awaiting P21 load', pillBg: '#1a1a2e', pillText: '#a78bfa' }
  }
  if (batch.flagged_count > 0) {
    return { label: `${batch.flagged_count} flagged`, pillBg: '#332300', pillText: '#fbbf24' }
  }
  if (batch.line_count > 0 && unmatched > 0) {
    return { label: `${unmatched} unmatched`, pillBg: '#330d0d', pillText: '#f87171' }
  }
  return null
}

// --- Formatters -------------------------------------------------------------
export function formatCurrency(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Library storage-key helpers (Phase 5.5): keys look like
// library/<vendor-slug>/<year>/<MM-DD-YY>/<file>, matching the archive's
// folder conventions.
export const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unassigned'
export const sanitizeFileName = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_')
// "2026-09-05" -> "09-05-26" (the archive's date-folder convention)
export function dateFolderMMDDYY(isoDate) {
  const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}-${m[3]}-${m[1].slice(2)}` : null
}

// "148 KB" / "2.4 MB"
export function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// "22 min ago" / "3h ago" / "2d ago" / "Jul 3" (copied from lib/helpdesk.js).
export function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const then = new Date(dateStr).getTime()
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Signed percent, e.g. "+12.5%" / "-4.0%".
export function formatPct(n) {
  if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '—'
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

// --- Parsing / column mapping (Phase 2) -------------------------------------
// The target fields a spreadsheet column can be mapped to. `key` matches both
// the parse-profile `columns` config keys and (mostly) the pu_lines columns.
// Effective date is NOT here — it's set once at batch creation (one date per
// batch), not mapped per line. buildLinesFromRows() still honors an
// effective_date column if a config supplies one, so per-line dates remain
// possible later without a code change.
export const MAPPING_FIELDS = [
  { key: 'vendor_item_no', label: 'Vendor item #', required: true },
  { key: 'description',    label: 'Description' },
  { key: 'uom',            label: 'UOM' },
  { key: 'cost',           label: 'Cost' },
  { key: 'list',           label: 'List' },
]

// Spreadsheet-style column label: 0->A, 25->Z, 26->AA … (shared by the
// mapping UI and the PDF quick-entry grid).
export function colLabel(i) {
  let s = ''
  let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

// Light auto-guessing so a fresh file/paste lands mostly pre-mapped.
const FIELD_HINTS = {
  vendor_item_no: /item|part|sku|catalog|model|stock|product|number|\bno\.?\b|#/i,
  description:    /desc|description|name/i,
  uom:            /\buom\b|unit|measure/i,
  cost:           /\bcost\b|\bnet\b|your\s*price|dealer|buy/i,
  list:           /list|msrp|retail|sell/i,
}
export function guessHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).filter(c => c !== null && c !== undefined && String(c).trim() !== '')
    const texty = cells.filter(c => isNaN(Number(String(c).replace(/[$,\s]/g, '')))).length
    if (cells.length >= 2 && texty >= Math.ceil(cells.length / 2)) return i
  }
  return 0
}
export function guessColumns(headerCells) {
  const cols = {}
  const taken = new Set()
  for (const field of MAPPING_FIELDS) {
    const rx = FIELD_HINTS[field.key]
    for (let c = 0; c < headerCells.length; c++) {
      if (taken.has(c)) continue
      const txt = String(headerCells[c] ?? '')
      if (txt.trim() && rx.test(txt)) { cols[field.key] = c; taken.add(c); break }
    }
  }
  return cols
}

// Defensive numeric parse: strips $, commas, spaces, and accounting parens.
// Blank / non-numeric returns null (blank is NOT zero).
export function parseNumber(v) {
  if (v === null || v === undefined) return null
  let s = String(v).trim()
  if (s === '') return null
  const negative = /^\(.*\)$/.test(s)          // (123.45) = -123.45
  s = s.replace(/[(),$\s]/g, '')               // drop parens, commas, $, whitespace
  s = s.replace(/[^0-9.\-]/g, '')              // drop any other stray currency/unit chars
  if (s === '' || s === '-' || s === '.') return null
  const n = Number(s)
  if (isNaN(n)) return null
  return negative ? -n : n
}

// Best-effort date parse -> 'YYYY-MM-DD' (or null). Cells arrive already
// formatted (the parse route reads with raw:false), so most vendor date strings
// parse cleanly; anything ambiguous is left null rather than guessed wrong.
export function parseDateish(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (s === '') return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function textOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function isBlankRow(row) {
  return !row || row.every(c => c === null || c === undefined || String(c).trim() === '')
}

// Turn a sheet's 2-D rows into pu_lines-shaped objects using a mapping config:
//   { sheet, header_row, skip_rows, columns:{field->colIndex}, transforms }
// transforms: { multiplier, discount_pct, strip_prefix }
//   - discount_pct: net cost = list * (1 - pct/100), used only when no cost column
//   - multiplier:   net cost = cost * multiplier
//   - strip_prefix: removed from the start of vendor_item_no
// Returns { lines, skippedNoPrice, dataRows }. Lines with no usable price
// (both cost and list null) are skipped and counted — blank is not zero.
export function buildLinesFromRows(rows, config = {}) {
  const cols = config.columns || {}
  const t = config.transforms || {}
  const headerRow = Number.isInteger(config.header_row) ? config.header_row : -1
  const skip = Number(config.skip_rows) || 0
  const startIdx = (headerRow >= 0 ? headerRow + 1 : 0) + skip

  const cellOf = (row, key) => {
    const idx = cols[key]
    if (idx === undefined || idx === null || idx === '') return null
    const v = row[Number(idx)]
    return v === undefined ? null : v
  }

  const discount = parseNumber(t.discount_pct)
  const mult = parseNumber(t.multiplier)
  const prefix = t.strip_prefix ? String(t.strip_prefix) : ''

  const lines = []
  let skippedNoPrice = 0

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i] || []
    if (isBlankRow(row)) continue

    let vendorItem = textOrNull(cellOf(row, 'vendor_item_no'))
    if (prefix && vendorItem && vendorItem.startsWith(prefix)) {
      vendorItem = vendorItem.slice(prefix.length).trim() || null
    }

    let newCost = parseNumber(cellOf(row, 'cost'))
    let newList = parseNumber(cellOf(row, 'list'))

    if (newCost === null && discount !== null && newList !== null) {
      newCost = newList * (1 - discount / 100)
    }
    if (mult !== null && newCost !== null) newCost = newCost * mult

    if (newCost !== null) newCost = Math.round(newCost * 10000) / 10000
    if (newList !== null) newList = Math.round(newList * 10000) / 10000

    if (newCost === null && newList === null) { skippedNoPrice++; continue }

    lines.push({
      row_number: i + 1,
      raw: row,
      vendor_item_no: vendorItem,
      description: textOrNull(cellOf(row, 'description')),
      uom: textOrNull(cellOf(row, 'uom')),
      new_cost: newCost,
      new_list: newList,
      effective_date: parseDateish(cellOf(row, 'effective_date')),
    })
  }

  return { lines, skippedNoPrice, dataRows: Math.max(0, rows.length - startIdx) }
}

// --- Matching / flags (Phase 3) ---------------------------------------------
// Normalize a part number for comparison: trim, uppercase, strip whitespace and
// dashes. Slashes/dots/etc. are kept — they're meaningful in part numbers.
export function normalizePart(s) {
  if (s === null || s === undefined) return ''
  return String(s).trim().toUpperCase().replace(/[\s-]/g, '')
}

// Pick the closest P21 candidate when a part number matches more than one
// mirror row (the "ambiguous" case). Deterministic scoring, best first:
//   +8  supplier_part_no is exactly the vendor's part (P21's own cross-ref)
//   +4  p21_item_id is exactly "<vendor prefix><part>" (the id-bridge form)
//   +2  p21_item_id starts with the vendor's prefix at all
//   +1  the row carries a current cost (live supplier-cost record)
// Ties break to the shorter item id, then alphabetical, so re-runs always pick
// the same row. Returns the winning candidate (never null for non-empty input).
export function pickBestCandidate(candidates, { normalizedPart, prefix = '' } = {}) {
  if (!candidates || candidates.length === 0) return null
  const target = normalizedPart || ''
  const prefixed = normalizePart(prefix + ' ' + target)
  const score = c => {
    let s = 0
    if (target && normalizePart(c.supplier_part_no) === target) s += 8
    if (target && normalizePart(c.p21_item_id) === prefixed) s += 4
    if (prefix && String(c.p21_item_id || '').startsWith(prefix)) s += 2
    if (c.current_cost !== null && c.current_cost !== undefined) s += 1
    return s
  }
  return [...candidates].sort((a, b) =>
    score(b) - score(a) ||
    String(a.p21_item_id || '').length - String(b.p21_item_id || '').length ||
    String(a.p21_item_id || '').localeCompare(String(b.p21_item_id || ''))
  )[0]
}

// Percent change old -> new cost, rounded to 2dp. Null when there's no usable
// baseline (unknown or zero old cost).
export function costChangePct(oldCost, newCost) {
  const o = Number(oldCost), n = Number(newCost)
  if (!isFinite(o) || o === 0 || oldCost === null || oldCost === undefined) return null
  if (!isFinite(n) || newCost === null || newCost === undefined) return null
  return Math.round(((n - o) / o) * 10000) / 100
}

// Guardrail flag for a (matched) line given pu_settings. Priority:
// large_increase > cost_over_list > decrease > ok. Only 'ok' is "clean".
//   settings: { large_increase_pct, flag_decreases, flag_cost_over_list }
export function computeFlag(line, settings = {}) {
  const { new_cost, new_list, old_cost } = line
  const largePct = Number(settings.large_increase_pct ?? 20)
  const pct = costChangePct(old_cost, new_cost)

  if (pct !== null && pct > largePct) return 'large_increase'
  if ((settings.flag_cost_over_list ?? true) && new_cost != null && new_list != null && Number(new_cost) > Number(new_list)) {
    return 'cost_over_list'
  }
  if ((settings.flag_decreases ?? true) && pct !== null && pct < 0) return 'decrease'
  return 'ok'
}
