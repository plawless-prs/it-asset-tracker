'use client'

// PDF quick-entry split view (Phase 6b). PDFs never auto-parse (no OCR in v1)
// — this screen puts the rendered PDF (signed Storage URL) beside a
// paste-friendly entry grid: copy rows out of the PDF, paste them in, assign
// columns exactly like the spreadsheet mapping UI, and Apply writes pu_lines
// through the same applyParse/triggerMatch path. Re-applying replaces the
// file's previous lines (applyParse is idempotent per file).

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../../../../lib/supabase'
import { useRole } from '../../../../../lib/useRole'
import {
  MAPPING_FIELDS, buildLinesFromRows, formatCurrency, colLabel, guessColumns, parseNumber,
} from '../../../../../lib/priceupdates'
import { applyParse, triggerMatch } from '../../../../../lib/priceupdatesParse'

const PDF = /\.pdf$/i

// Pasted PDF text -> token rows. Tabs win when present (some viewers emit
// them); otherwise runs of 2+ spaces are column gaps; a single-spaced line
// falls back to splitting every space (descriptions may fragment — the
// reviewer sees it live and can leave description unmapped).
function tokenizeText(text) {
  const rows = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let cells
    if (line.includes('\t')) cells = line.split('\t')
    else {
      const t = line.trim()
      cells = /\s{2,}/.test(t) ? t.split(/\s{2,}/) : t.split(/\s+/)
    }
    rows.push(cells.map(c => c.trim()))
  }
  return rows
}

const inputStyle = {
  width: '100%', padding: '8px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
}
const labelStyle = {
  display: 'block', fontSize: '11px', fontWeight: '600', color: '#5a6e84',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px',
}
const cardStyle = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px' }

export default function PdfEntry() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()
  const searchParams = useSearchParams()
  const { user } = useRole()

  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [fileId, setFileId] = useState(searchParams.get('file') || '')
  // Keyed by file id so switching files shows "loading" (derived) without a
  // synchronous state reset in the effect.
  const [pdf, setPdf] = useState({ fileId: null, url: '', error: '' })

  const [text, setText] = useState('')
  const [hasHeader, setHasHeader] = useState(false)
  const [columns, setColumns] = useState({})
  const [transforms, setTransforms] = useState({ multiplier: '', discount_pct: '', strip_prefix: '' })

  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: b } = await supabase
        .from('pu_batches').select('id, number, status, vendor_id, vendor:vendor_id(id, name)').eq('id', id).single()
      setBatch(b)
      const { data: f } = await supabase
        .from('pu_batch_files').select('id, file_name, storage_path, parse_status, parsed_rows').eq('batch_id', id).order('created_at')
      const pdfs = (f || []).filter(x => PDF.test(x.file_name))
      setFiles(pdfs)
      if (!searchParams.get('file')) {
        const target = pdfs.find(x => x.parse_status !== 'parsed') || pdfs[0]
        if (target) setFileId(target.id)
      }
      setLoading(false)
    }
    load()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Signed URL for the PDF viewer (long enough for a full entry session).
  useEffect(() => {
    if (!fileId) return
    const f = files.find(x => x.id === fileId)
    if (!f) return
    let cancelled = false
    supabase.storage.from('price-files').createSignedUrl(f.storage_path, 3600).then(({ data, error }) => {
      if (cancelled) return
      setPdf({
        fileId,
        url: data?.signedUrl || '',
        error: (error || !data?.signedUrl) ? (error?.message || 'Could not load the PDF') : '',
      })
    })
    return () => { cancelled = true }
  }, [fileId, files]) // eslint-disable-line react-hooks/exhaustive-deps

  const { url: pdfUrl, error: pdfError } = pdf.fileId === fileId ? pdf : { url: '', error: '' }

  const rows = useMemo(() => tokenizeText(text), [text])
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)

  // First paste into an empty grid: detect a header line (no parseable
  // numbers in row 0) and pre-guess the column mapping from it.
  function handleTextChange(next) {
    const wasEmpty = rows.length === 0
    setText(next)
    if (wasEmpty) {
      const first = tokenizeText(next)[0]
      if (first && first.length >= 2 && first.every(c => parseNumber(c) === null)) {
        setHasHeader(true)
        setColumns(guessColumns(first))
      }
    }
  }

  const config = useMemo(() => ({
    sheet: 'pasted',
    header_row: hasHeader ? 0 : -1,
    skip_rows: 0,
    columns,
    transforms,
  }), [hasHeader, columns, transforms])

  const preview = useMemo(() => buildLinesFromRows(rows, config), [rows, config])

  const editable = batch && ['received', 'parsing', 'needs_review', 'failed'].includes(batch.status)
  const hasItem = columns.vendor_item_no !== undefined && columns.vendor_item_no !== ''
  const hasPrice = ['cost', 'list'].some(k => columns[k] !== undefined && columns[k] !== '')
    || (transforms.discount_pct && columns.list !== undefined && columns.list !== '')
  const canApply = editable && hasItem && hasPrice && preview.lines.length > 0 && !applying

  function setCol(field, value) {
    setColumns(prev => {
      const next = { ...prev }
      if (value === '') delete next[field]
      else next[field] = Number(value)
      return next
    })
  }

  async function handleApply() {
    setApplyError('')
    setApplying(true)
    try {
      await applyParse(supabase, {
        batch,
        file: files.find(x => x.id === fileId),
        sheets: [{ name: 'pasted', rows }],
        config,
        userId: user?.id,
        saveProfile: null,
      })
      try { await triggerMatch(supabase, id) } catch { /* non-fatal */ }
      router.push(`/priceupdates/batches/${id}`)
    } catch (e) {
      setApplyError(e.message || 'Apply failed')
      setApplying(false)
    }
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  if (!batch) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      Batch not found. <Link href="/priceupdates/batches" style={{ color: '#60a5fa' }}>Back</Link>
    </div>
  )
  if (files.length === 0) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      This batch has no PDF files.{' '}
      <Link href={`/priceupdates/batches/${id}`} style={{ color: '#60a5fa' }}>Back to batch</Link>
    </div>
  )

  const activeFile = files.find(x => x.id === fileId)
  const headerCells = hasHeader ? (rows[0] || []) : []
  const columnOptions = Array.from({ length: maxCols }, (_, c) => {
    const txt = String(headerCells[c] ?? '').trim()
    return { value: c, label: txt ? `${colLabel(c)} · ${txt}` : `Column ${colLabel(c)}` }
  })
  const previewRows = rows.slice(0, 12)

  return (
    <div style={{ padding: '24px 28px' }}>
      <Link href={`/priceupdates/batches/${id}`} style={{ fontSize: '12.5px', color: '#5a6e84', textDecoration: 'none' }}>
        ← Batch #{batch.number}
      </Link>
      <div style={{ margin: '10px 0 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Enter lines from PDF</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
            {batch.vendor?.name || 'Unidentified vendor'} · copy rows in the PDF, paste them on the right, map the columns, Apply.
          </p>
        </div>
        {files.length > 1 && (
          <select style={{ ...inputStyle, width: 'auto' }} value={fileId} onChange={e => setFileId(e.target.value)}>
            {files.map(f => <option key={f.id} value={f.id}>{f.file_name}{f.parse_status === 'parsed' ? ` (${f.parsed_rows} lines entered)` : ''}</option>)}
          </select>
        )}
      </div>

      {!editable && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#332300', color: '#fbbf24', border: '1px solid #78500e', marginBottom: '14px' }}>
          This batch is {batch.status} — line entry is locked.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 440px', gap: '18px', alignItems: 'start' }}>
        {/* Left: the PDF */}
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', overflow: 'hidden', height: 'calc(100vh - 210px)', minHeight: '480px' }}>
          {pdfError ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#f87171', fontSize: '13px' }}>{pdfError}</div>
          ) : pdfUrl ? (
            <iframe src={pdfUrl} title={activeFile?.file_name || 'PDF'} style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }} />
          ) : (
            <div style={{ padding: '32px', textAlign: 'center', color: '#5a6e84', fontSize: '13px' }}>Loading PDF…</div>
          )}
        </div>

        {/* Right: paste + map + preview + apply */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: 'calc(100vh - 210px)', overflowY: 'auto' }}>
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8' }}>Pasted rows</div>
              <div style={{ fontSize: '11.5px', color: rows.length ? '#4ade80' : '#5a6e84' }}>{rows.length} rows</div>
            </div>
            <textarea
              value={text}
              onChange={e => handleTextChange(e.target.value)}
              placeholder={'Paste rows copied from the PDF — one line per item.\nTabs or multiple spaces separate columns.\nPaste page by page; rows accumulate here.'}
              spellCheck={false}
              disabled={!editable}
              style={{ ...inputStyle, height: '120px', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: '#c0cad8', cursor: 'pointer', marginTop: '10px' }}>
              <input type="checkbox" checked={hasHeader} onChange={e => {
                setHasHeader(e.target.checked)
                if (e.target.checked && rows[0]) setColumns(guessColumns(rows[0]))
              }} style={{ accentColor: '#2563eb', width: '15px', height: '15px' }} />
              First pasted row is column headers
            </label>
          </div>

          {rows.length > 0 && (
            <div style={{ ...cardStyle, padding: 0, overflow: 'auto', maxHeight: '200px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '11.5px', width: '100%' }}>
                <thead>
                  <tr>
                    {Array.from({ length: maxCols }, (_, c) => (
                      <th key={c} style={{ position: 'sticky', top: 0, backgroundColor: '#0d1219', color: '#7e93a8', padding: '5px 8px', borderBottom: '1px solid #1e2d40', borderLeft: c ? '1px solid #131c28' : 'none', fontWeight: '600', whiteSpace: 'nowrap', textAlign: 'left' }}>
                        {colLabel(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} style={{ backgroundColor: hasHeader && i === 0 ? '#10243f' : 'transparent', opacity: 1 }}>
                      {Array.from({ length: maxCols }, (_, c) => (
                        <td key={c} style={{ padding: '4px 8px', color: hasHeader && i === 0 ? '#7fb4f5' : '#8aa0b8', borderBottom: '1px solid #131c28', borderLeft: c ? '1px solid #131c28' : 'none', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > previewRows.length && (
                <div style={{ padding: '5px 8px', fontSize: '11px', color: '#4a5a6e' }}>… {rows.length - previewRows.length} more rows</div>
              )}
            </div>
          )}

          <div style={cardStyle}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '12px' }}>Columns</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {MAPPING_FIELDS.map(field => (
                <div key={field.key}>
                  <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#f87171' }}> *</span>}</label>
                  <select
                    style={{ ...inputStyle, borderColor: field.required && !hasItem ? '#991b1b' : '#1e2d40' }}
                    value={columns[field.key] ?? ''}
                    onChange={e => setCol(field.key, e.target.value)}
                    disabled={!editable}
                  >
                    <option value="">— not mapped —</option>
                    {columnOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '4px' }}>Transforms <span style={{ color: '#5a6e84', fontWeight: '400' }}>(optional)</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
              <div>
                <label style={labelStyle}>Cost multiplier</label>
                <input style={inputStyle} value={transforms.multiplier} onChange={e => setTransforms(t => ({ ...t, multiplier: e.target.value }))} placeholder="e.g. 0.85" disabled={!editable} />
              </div>
              <div>
                <label style={labelStyle}>Discount % off list</label>
                <input style={inputStyle} value={transforms.discount_pct} onChange={e => setTransforms(t => ({ ...t, discount_pct: e.target.value }))} placeholder="e.g. 40 (used if no cost column)" disabled={!editable} />
              </div>
              <div>
                <label style={labelStyle}>Strip prefix from item #</label>
                <input style={inputStyle} value={transforms.strip_prefix} onChange={e => setTransforms(t => ({ ...t, strip_prefix: e.target.value }))} placeholder="e.g. GATES-" disabled={!editable} />
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8' }}>Preview</div>
              <div style={{ fontSize: '11.5px', color: preview.lines.length ? '#4ade80' : '#f87171' }}>
                {preview.lines.length} lines · {preview.skippedNoPrice} skipped
              </div>
            </div>
            {preview.lines.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#4a5a6e' }}>Paste rows and map an item # plus a cost or list column.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {preview.lines.slice(0, 6).map((l, i) => (
                  <div key={i} style={{ fontSize: '11.5px', color: '#8aa0b8', display: 'flex', justifyContent: 'space-between', gap: '8px', borderBottom: '1px solid #131c28', paddingBottom: '4px' }}>
                    <span style={{ color: '#c0cad8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.vendor_item_no || '—'}
                    </span>
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {formatCurrency(l.new_cost)}{l.new_list != null ? ` / ${formatCurrency(l.new_list)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {activeFile?.parse_status === 'parsed' && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '12px', backgroundColor: '#13202e', color: '#7fb4f5', border: '1px solid #1e3a5f' }}>
              This PDF already has {activeFile.parsed_rows} entered lines — applying replaces them.
            </div>
          )}

          {applyError && (
            <div style={{ padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>
              {applyError}
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={!canApply}
            style={{
              padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
              backgroundColor: canApply ? '#2563eb' : '#1a2433', color: canApply ? '#fff' : '#5a6e84',
              border: 'none', cursor: canApply ? 'pointer' : 'not-allowed',
            }}
          >
            {applying ? 'Applying…' : `Apply — write ${preview.lines.length} lines`}
          </button>
        </div>
      </div>
    </div>
  )
}
