// Shared server-side helper: turn an inbound priceupdate@ email into a
// pu_batches row (Phase 6a) — the price-update counterpart of emailTicket.js.
// De-duplicates on email_message_id so repeated Graph notifications never
// create a second batch. Never import into a client component.
//
// What it does, mirroring a manual batch creation as closely as possible:
//   - vendor auto-identified by the sender's domain vs pu_vendors.email_domains
//   - attachments (xlsx/xls/csv/pdf/txt, non-inline) land in price-files as
//     pu_batch_files; PDFs are marked parse_status 'manual' (no OCR — the
//     Phase 6b split view will handle them)
//   - attachment copies are archived to the file library under the vendor's
//     received-date folder (effective date isn't known from the email)
//   - an identified vendor with a P21 supplier id queues a scoped mirror sync
//   - a body-only email (no usable attachment) becomes a fileless placeholder
//     batch with the body preserved — same workflow as manual placeholders
import { createAdminClient } from './supabaseAdmin'
import { fetchAttachments } from './graph'
import { slugify, sanitizeFileName, dateFolderMMDDYY } from './priceupdates'

const USABLE_FILE = /\.(xlsx|xls|csv|pdf|txt)$/i
const BODY_MAX = 20000

// Domains that can never identify a vendor: our own, and freemail providers.
const NON_VENDOR_DOMAINS = new Set([
  'powerandrubber.com', 'prstech.app',
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'msn.com', 'live.com', 'comcast.net', 'att.net',
])

// Generic words that appear in many company names — a match on these alone
// proves nothing ("Acme Rubber" should match on "acme", never on "rubber").
const NAME_STOPWORDS = new Set([
  'rubber', 'supply', 'company', 'corporation', 'incorporated', 'industries',
  'industrial', 'international', 'america', 'american', 'group', 'products',
  'manufacturing', 'sales', 'service', 'services', 'power', 'north', 'south',
  'east', 'west',
  // Product-category words: a price letter's body naturally mentions these
  // ("...applies to all couplings and chain"), so they must never identify a
  // vendor by themselves (learned from a real Tsubaki letter matching
  // "PT Coupling" via the word "coupling").
  'hose', 'hoses', 'belt', 'belts', 'seal', 'seals', 'gasket', 'gaskets',
  'coupling', 'couplings', 'chain', 'chains', 'bearing', 'bearings',
  'fitting', 'fittings', 'valve', 'valves', 'pump', 'pumps', 'clamp', 'clamps',
  'sprocket', 'sprockets', 'pulley', 'pulleys', 'sheave', 'sheaves',
])

const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')

// Tiered vendor identification (most→least reliable, first confident hit wins):
//   1. sender domain — direct vendor emails
//   2. any email address quoted in the body — nails the internal-forward
//      workflow, where the original "From: x@gates.com" line rides along
//   3. a UNIQUE vendor-name mention across subject + attachment names + body
//      (distinctive name tokens only; two plausible vendors = no guess)
// Returns { vendor, method } — method is null for tier 1 (nothing inferred)
// and a human-readable explanation for tiers 2–3 (recorded on the batch).
function identifyVendor(vendors, { from, subject, bodyText, attachmentNames }) {
  const byDomain = (d) => vendors.find(v => (v.email_domains || []).includes(d)) || null

  const fromDomain = from.includes('@') ? from.split('@')[1] : null
  if (fromDomain && !NON_VENDOR_DOMAINS.has(fromDomain)) {
    const v = byDomain(fromDomain)
    if (v) return { vendor: v, method: null }
  }

  const quoted = [...new Set(
    (String(bodyText || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .map(a => a.toLowerCase().split('@')[1])
      .filter(d => d && !NON_VENDOR_DOMAINS.has(d))
  )]
  for (const d of quoted) {
    const v = byDomain(d)
    if (v) return { vendor: v, method: `forwarded email headers (${d})` }
  }

  // Two passes, narrow to wide: the subject + file names are deliberate,
  // high-signal text (a unique hit there wins even if the body's prose
  // mentions other vendor-ish words); the body is the wide fallback.
  const findUnique = (hay) => {
    const hits = []
    for (const v of vendors) {
      const tokens = normText(v.name).split(' ').filter(t => t.length >= 4 && !NAME_STOPWORDS.has(t))
      const token = tokens.find(t => hay.includes(` ${t} `) || hay.includes(` ${t}`))
      if (token) hits.push({ v, token })
    }
    return [...new Set(hits.map(h => h.v.id))].length === 1 ? hits[0] : null
  }
  const narrow = findUnique(` ${normText(`${subject} ${(attachmentNames || []).join(' ')}`)} `)
  if (narrow) {
    return { vendor: narrow.v, method: `name mention ("${narrow.token}" in the subject/file name)` }
  }
  const wide = findUnique(` ${normText(`${subject} ${(attachmentNames || []).join(' ')} ${String(bodyText || '').slice(0, 4000)}`)} `)
  if (wide) {
    return { vendor: wide.v, method: `name mention ("${wide.token}" in the subject/body/file name)` }
  }
  return { vendor: null, method: null }
}

function bodyToText(msg) {
  const raw = msg?.body?.content || ''
  if (!raw) return msg?.bodyPreview || ''
  if (msg.body.contentType !== 'html') return raw.slice(0, BODY_MAX)
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BODY_MAX)
}

export async function createEmailBatch({ mailbox, messageId, msg }) {
  const supabase = createAdminClient()

  const from = String(msg?.from?.emailAddress?.address || '').trim().toLowerCase()
  const bodyText = bodyToText(msg)

  // Attachments come first: their names are an identification clue.
  let usableAtts = []
  if (msg?.hasAttachments) {
    try {
      usableAtts = (await fetchAttachments(mailbox, messageId))
        .filter(a => !a.isInline && a.name && USABLE_FILE.test(a.name) && a.contentBytes)
    } catch (e) {
      console.error('emailBatch attachments fetch:', e)
    }
  }

  const { data: vendors } = await supabase
    .from('pu_vendors')
    .select('id, name, p21_supplier_id, email_domains')
  const { vendor, method } = identifyVendor(vendors || [], {
    from,
    subject: msg?.subject || '',
    bodyText,
    attachmentNames: usableAtts.map(a => a.name),
  })

  // Create the batch, ignoring duplicates by Graph message id. An inferred
  // vendor (tier 2/3) is recorded in notes so the reviewer knows to verify.
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const { data: rows, error } = await supabase
    .from('pu_batches')
    .upsert({
      vendor_id: vendor?.id || null,
      source: 'email',
      status: 'received',
      email_message_id: messageId,
      email_from: from || null,
      email_subject: String(msg?.subject || '').trim() || null,
      email_body: bodyText || null,
      ...(method ? { notes: `[${stamp}] Vendor auto-identified from ${method} — verify before approving.` } : {}),
    }, { onConflict: 'email_message_id', ignoreDuplicates: true })
    .select('id, number')
  if (error) return { error }
  const batch = rows?.[0]
  if (!batch) return { duplicate: true }

  // Attachments -> batch files (+ library archive, best-effort).
  let files = 0
  {
    try {
      for (const a of usableAtts) {
        const buf = Buffer.from(a.contentBytes, 'base64')
        if (buf.length === 0) continue
        const safe = sanitizeFileName(a.name)
        const path = `${batch.id}/${Date.now()}-${safe}`
        const { error: upErr } = await supabase.storage.from('price-files')
          .upload(path, buf, { contentType: a.contentType || 'application/octet-stream' })
        if (upErr) continue
        const isPdf = /\.pdf$/i.test(a.name)
        const { error: fErr } = await supabase.from('pu_batch_files').insert({
          batch_id: batch.id,
          storage_path: path,
          file_name: a.name,
          mime_type: a.contentType || null,
          file_size: buf.length,
          ...(isPdf ? { parse_status: 'manual' } : {}),
        })
        if (fErr) continue
        files++

        if (vendor) {
          try {
            const received = new Date().toISOString().slice(0, 10)
            const folder = `library/${slugify(vendor.name)}/${Number(received.slice(0, 4))}/${dateFolderMMDDYY(received)}`
            let dest = `${folder}/${safe}`
            const { error: cErr } = await supabase.storage.from('price-files').copy(path, dest)
            if (cErr) {
              dest = `${folder}/${Date.now()}-${safe}`
              const retry = await supabase.storage.from('price-files').copy(path, dest)
              if (retry.error) continue
            }
            await supabase.from('pu_library_files').insert({
              vendor_id: vendor.id, year: Number(received.slice(0, 4)), file_name: a.name,
              storage_path: dest, mime_type: a.contentType || null, file_size: buf.length,
              batch_id: batch.id, source: 'batch',
            })
          } catch { /* library archiving is best-effort */ }
        }
      }
    } catch (e) {
      console.error('emailBatch attachments:', e)
    }
  }

  // Fresh mirror data for the vendor by the time someone reviews the batch.
  if (vendor?.p21_supplier_id) {
    try {
      await supabase.from('pu_sync_requests').insert({
        supplier_id: String(vendor.p21_supplier_id).trim(),
        reason: 'batch_created',
      })
    } catch { /* sync request is best-effort */ }
  }

  return { data: batch, vendor: vendor?.name || null, files }
}
