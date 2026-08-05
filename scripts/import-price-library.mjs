// Bulk-import the historical price-file archive into the app's file library
// (Phase 5.5). Run on whatever machine holds the archive folders — no npm
// install needed (Node 20+ only, uses built-in fetch).
//
//   node import-price-library.mjs "C:\path\to\archive" --dry
//   node import-price-library.mjs "C:\path\to\archive"
//
// Expects the archive laid out as a folder per vendor, with any subfolder
// structure below that (e.g. <archive>\<Vendor>\<year>\<date>\<files>).
//
// Per file: vendor = top-level folder (matched case-insensitively against
// pu_vendors.name, ignoring punctuation, with unambiguous-prefix shorthand
// like "Parker" allowed; unmatched folders still import, with vendor left
// unassigned for fixing in the app), year = first 4-digit year in its
// subfolder path, else in the file name, else the file's modified year.
// Object key mirrors the folder structure: library/<vendor-slug>/<subfolders
// as-is>/<file name> in the private `price-files` bucket — so same-named
// files in different date folders never collide — with one pu_library_files
// row each (source 'bulk_import').
//
// Idempotent: a file whose storage key already has a library row with the
// same size is skipped, so re-runs only pick up what's new. A same-named file
// with a different size gets a numbered suffix.
//
// Config: .env next to this script (or process env):
//   SUPABASE_URL=            (or NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY=

import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, extname } from 'path'
import { fileURLToPath } from 'url'

// --- config ----------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
try {
  // Strip a leading UTF-8 BOM — Notepad/PowerShell often save .env with one,
  // which would otherwise corrupt the first line's key name.
  for (const line of readFileSync(join(here, '.env'), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const k = t.slice(0, t.indexOf('=')).trim()
    if (!(k in process.env)) process.env[k] = t.slice(t.indexOf('=') + 1).trim()
  }
} catch { /* no .env — rely on process env */ }

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const root = args.find(a => !a.startsWith('--'))

if (!root) { console.error('Usage: node import-price-library.mjs <archive-folder> [--dry]'); process.exit(1) }
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (put them in .env next to this script)'); process.exit(1) }

const MIME = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const SKIP_FILES = /^(~\$|\.|thumbs\.db$|desktop\.ini$)/i

// --- helpers ---------------------------------------------------------------

async function sb(method, path, body, headers = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...headers },
    body,
  })
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${r.status}: ${await r.text()}`)
  const text = await r.text()
  return text ? JSON.parse(text) : null
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unassigned'
const sanitize = (s) => s.replace(/[^a-zA-Z0-9._-]/g, '_')

function yearOf(relDirs, fileName, mtime) {
  const isYear = (s) => /^(19|20)\d{2}$/.test(s)
  for (const d of relDirs) if (isYear(d)) return Number(d)
  const m = fileName.match(/(19|20)\d{2}/)
  if (m) return Number(m[0])
  return mtime.getFullYear()
}

function* walk(dir, rel = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_FILES.test(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full, [...rel, entry.name])
    else if (entry.isFile()) yield { full, rel, name: entry.name }
  }
}

// --- main ------------------------------------------------------------------

const vendors = await sb('GET', '/rest/v1/pu_vendors?select=id,name')
const byNorm = new Map(vendors.map(v => [norm(v.name), v]))

// Exact normalized match first; otherwise a folder that's an unambiguous
// prefix of one vendor (or vice versa) matches too — archives tend to use
// shorthand like "Parker" for "Parker Hannifin". Ambiguity = no match.
function matchVendor(folderName) {
  const n = norm(folderName)
  if (byNorm.has(n)) return byNorm.get(n)
  const candidates = vendors.filter(v => {
    const vn = norm(v.name)
    return vn.startsWith(n) || n.startsWith(vn)
  })
  return candidates.length === 1 ? candidates[0] : null
}

const existing = new Map() // storage_path -> file_size
let from = 0
while (true) {
  let page
  try {
    page = await sb('GET', `/rest/v1/pu_library_files?select=storage_path,file_size&order=storage_path&limit=1000&offset=${from}`)
  } catch (e) {
    if (String(e).includes('pu_library_files')) {
      console.error('The pu_library_files table does not exist yet — run supabase/16_pu_library_files.sql in the Supabase SQL Editor first.')
      process.exit(1)
    }
    throw e
  }
  for (const r of page) existing.set(r.storage_path, r.file_size)
  if (page.length < 1000) break
  from += 1000
}
console.log(`${vendors.length} vendors, ${existing.size} files already in the library${DRY ? ' — DRY RUN, nothing will be uploaded' : ''}`)

let uploaded = 0, skipped = 0, failed = 0
const unmatchedFolders = new Set()

for (const topEntry of readdirSync(root, { withFileTypes: true })) {
  if (!topEntry.isDirectory() || SKIP_FILES.test(topEntry.name)) continue
  const vendor = matchVendor(topEntry.name)
  if (!vendor) unmatchedFolders.add(topEntry.name)
  const vslug = vendor ? slug(vendor.name) : slug(topEntry.name)

  for (const f of walk(join(root, topEntry.name))) {
    const st = statSync(f.full)
    if (st.size === 0) { skipped++; continue }
    const year = yearOf(f.rel, f.name, st.mtime)

    // Key mirrors the folder path under the vendor, so files only share a key
    // when they're genuinely the same file (same subfolder + name). Skip if
    // identical (same key + size); suffix in the rare remaining collision
    // (e.g. two names that sanitize identically).
    const relDir = f.rel.map(sanitize).join('/')
    let key, n = 0, identical = false
    do {
      const base = sanitize(f.name)
      const suffixed = n === 0 ? base : base.replace(/(\.[^.]*)?$/, m => `-${n + 1}${m || ''}`)
      key = `library/${vslug}/${relDir ? relDir + '/' : ''}${suffixed}`
      if (existing.has(key) && existing.get(key) === st.size) { identical = true; break }
      n++
    } while (existing.has(key))

    if (identical) { skipped++; continue }

    console.log(`${DRY ? '[dry] ' : ''}${topEntry.name}${vendor ? '' : ' (vendor unmatched)'} · ${year} · ${f.name} -> ${key}`)
    if (DRY) { uploaded++; continue }

    try {
      const bytes = readFileSync(f.full)
      await sb('POST', `/storage/v1/object/price-files/${key}`, bytes,
        { 'Content-Type': MIME[extname(f.name).toLowerCase()] || 'application/octet-stream' })
      await sb('POST', '/rest/v1/pu_library_files', JSON.stringify({
        vendor_id: vendor?.id || null,
        year,
        file_name: f.name,
        storage_path: key,
        mime_type: MIME[extname(f.name).toLowerCase()] || null,
        file_size: st.size,
        source: 'bulk_import',
      }), { 'Content-Type': 'application/json', Prefer: 'return=minimal' })
      existing.set(key, st.size)
      uploaded++
    } catch (e) {
      failed++
      console.error(`  FAILED: ${String(e?.message || e)}`)
    }
  }
}

console.log(`\n${DRY ? 'Would upload' : 'Uploaded'} ${uploaded} · skipped ${skipped} (already imported or empty) · failed ${failed}`)
if (unmatchedFolders.size) {
  console.log(`Folders with no matching vendor (imported unassigned — set the vendor on the Files page, or add the vendor first and re-run):`)
  for (const d of unmatchedFolders) console.log(`  - ${d}`)
}
