'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../../../../lib/supabase'
import { useRole } from '../../../../../lib/useRole'
import { MAPPING_FIELDS, buildLinesFromRows, formatCurrency } from '../../../../../lib/priceupdates'
import { fetchParsedSheets, applyParse } from '../../../../../lib/priceupdatesParse'

const SPREADSHEET = /\.(xlsx|xls|csv)$/i

// Spreadsheet-style column label: 0->A, 25->Z, 26->AA …
function colLabel(i) {
  let s = ''
  let n = i
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return s
}

// Light auto-guessing so a fresh file lands mostly pre-mapped.
const FIELD_HINTS = {
  vendor_item_no: /item|part|sku|catalog|model|stock|product|number|\bno\.?\b|#/i,
  description:    /desc|description|name/i,
  uom:            /\buom\b|unit|measure/i,
  cost:           /\bcost\b|\bnet\b|your\s*price|dealer|buy/i,
  list:           /list|msrp|retail|sell/i,
}
function guessHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).filter(c => c !== null && c !== undefined && String(c).trim() !== '')
    const texty = cells.filter(c => isNaN(Number(String(c).replace(/[$,\s]/g, '')))).length
    if (cells.length >= 2 && texty >= Math.ceil(cells.length / 2)) return i
  }
  return 0
}
function guessColumns(headerCells) {
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

const inputStyle = {
  width: '100%', padding: '8px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
}
const labelStyle = {
  display: 'block', fontSize: '11px', fontWeight: '600', color: '#5a6e84',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px',
}

export default function MapBatch() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()
  const searchParams = useSearchParams()
  const { user } = useRole()

  const [batch, setBatch] = useState(null)
  const [files, setFiles] = useState([])
  const [fileId, setFileId] = useState(searchParams.get('file') || '')
  const [sheets, setSheets] = useState(null)
  const [truncated, setTruncated] = useState(false)
  const [sheetName, setSheetName] = useState('')
  const [headerRow, setHeaderRow] = useState(0)
  const [columns, setColumns] = useState({})
  const [transforms, setTransforms] = useState({ multiplier: '', discount_pct: '', strip_prefix: '' })
  const [saveProfile, setSaveProfile] = useState(true)
  const [profileLabel, setProfileLabel] = useState('')

  const [loading, setLoading] = useState(true)
  const [parseError, setParseError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  // Load batch + files
  useEffect(() => {
    async function load() {
      const { data: b } = await supabase
        .from('pu_batches').select('id, number, status, vendor_id, vendor:vendor_id(id, name)').eq('id', id).single()
      setBatch(b)
      const { data: f } = await supabase
        .from('pu_batch_files').select('id, file_name, parse_status, parse_profile_id').eq('batch_id', id).order('created_at')
      const sheetFiles = (f || []).filter(x => SPREADSHEET.test(x.file_name))
      setFiles(sheetFiles)
      if (!searchParams.get('file')) {
        const target = sheetFiles.find(x => x.parse_status !== 'parsed') || sheetFiles[0]
        if (target) setFileId(target.id)
      }
      setLoading(false)
    }
    load()
  }, [id])

  // Fetch + parse the chosen file
  useEffect(() => {
    if (!fileId) return
    let cancelled = false
    async function run() {
      setSheets(null); setParseError(''); setColumns({})
      try {
        const res = await fetchParsedSheets(supabase, fileId)
        if (cancelled) return
        setSheets(res.sheets)
        setTruncated(!!res.truncated)
        const first = res.sheets[0]
        setSheetName(first?.name || '')
        const hr = guessHeaderRow(first?.rows || [])
        setHeaderRow(hr)
        setColumns(guessColumns((first?.rows || [])[hr] || []))
        const fname = files.find(x => x.id === fileId)?.file_name || ''
        setProfileLabel(fname.replace(SPREADSHEET, '') || 'Default')
      } catch (e) {
        if (!cancelled) setParseError(e.message || 'Could not parse file')
      }
    }
    run()
    return () => { cancelled = true }
  }, [fileId, files.length])

  const activeSheet = useMemo(
    () => (sheets || []).find(s => s.name === sheetName) || (sheets || [])[0],
    [sheets, sheetName]
  )
  const rows = activeSheet?.rows || []
  const previewRows = rows.slice(0, 30)
  const maxCols = previewRows.reduce((m, r) => Math.max(m, (r || []).length), 0)
  const headerCells = rows[headerRow] || []

  const config = useMemo(() => ({
    sheet: sheetName,
    header_row: headerRow,
    skip_rows: 0,
    columns,
    transforms,
  }), [sheetName, headerRow, columns, transforms])

  const preview = useMemo(() => {
    if (!activeSheet) return { lines: [], skippedNoPrice: 0 }
    return buildLinesFromRows(rows, config)
  }, [activeSheet, rows, config])

  const hasItem = columns.vendor_item_no !== undefined && columns.vendor_item_no !== ''
  const hasPrice = ['cost', 'list'].some(k => columns[k] !== undefined && columns[k] !== '')
    || (transforms.discount_pct && columns.list !== undefined && columns.list !== '')
  const canApply = hasItem && hasPrice && preview.lines.length > 0 && !applying

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
        batch, file: files.find(x => x.id === fileId), sheets, config, userId: user?.id,
        saveProfile: (saveProfile && batch?.vendor_id) ? { label: profileLabel } : null,
      })
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

  const columnOptions = Array.from({ length: maxCols }, (_, c) => {
    const txt = headerRow >= 0 ? String(headerCells[c] ?? '').trim() : ''
    return { value: c, label: txt ? `${colLabel(c)} · ${txt}` : `Column ${colLabel(c)}` }
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1160px' }}>
      <Link href={`/priceupdates/batches/${id}`} style={{ fontSize: '12.5px', color: '#5a6e84', textDecoration: 'none' }}>
        ← Batch #{batch.number}
      </Link>
      <div style={{ margin: '10px 0 18px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Map columns</h1>
        <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
          {batch.vendor?.name || 'Unidentified vendor'} · tell the parser which column is which, then Apply.
        </p>
      </div>

      {/* File + sheet pickers */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        {files.length > 1 && (
          <select style={{ ...inputStyle, width: 'auto' }} value={fileId} onChange={e => setFileId(e.target.value)}>
            {files.map(f => <option key={f.id} value={f.id}>{f.file_name}{f.parse_status === 'parsed' ? ' (parsed)' : ''}</option>)}
          </select>
        )}
        {sheets && sheets.length > 1 && (
          <select style={{ ...inputStyle, width: 'auto' }} value={sheetName} onChange={e => { setSheetName(e.target.value); const s = sheets.find(x => x.name === e.target.value); const hr = guessHeaderRow(s?.rows || []); setHeaderRow(hr); setColumns(guessColumns((s?.rows || [])[hr] || [])) }}>
            {sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        )}
        {truncated && <span style={{ fontSize: '12px', color: '#fbbf24' }}>Showing first 20,000 rows.</span>}
      </div>

      {parseError ? (
        <div style={{ padding: '16px 18px', borderRadius: '12px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b', fontSize: '13px' }}>
          {parseError}
        </div>
      ) : !sheets ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Reading spreadsheet…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: '18px', alignItems: 'start' }}>
          {/* Left: grid */}
          <div>
            <div style={{ fontSize: '12px', color: '#8aa0b8', marginBottom: '8px' }}>
              Click the row that holds your column headers.
            </div>
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', overflow: 'auto', maxHeight: '520px' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, backgroundColor: '#0d1219', color: '#5a6e84', padding: '6px 8px', borderBottom: '1px solid #1e2d40', fontWeight: '600' }}>#</th>
                    {Array.from({ length: maxCols }, (_, c) => (
                      <th key={c} style={{ position: 'sticky', top: 0, backgroundColor: '#0d1219', color: '#7e93a8', padding: '6px 10px', borderBottom: '1px solid #1e2d40', borderLeft: '1px solid #131c28', fontWeight: '600', whiteSpace: 'nowrap', textAlign: 'left' }}>
                        {colLabel(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    const isHeader = i === headerRow
                    const isAbove = i < headerRow
                    return (
                      <tr
                        key={i}
                        onClick={() => { setHeaderRow(i); setColumns(guessColumns(rows[i] || [])) }}
                        style={{
                          cursor: 'pointer',
                          backgroundColor: isHeader ? '#10243f' : 'transparent',
                          opacity: isAbove ? 0.4 : 1,
                        }}
                      >
                        <td style={{ padding: '5px 8px', color: isHeader ? '#7fb4f5' : '#4a5a6e', borderBottom: '1px solid #131c28', whiteSpace: 'nowrap', fontWeight: isHeader ? '700' : '400' }}>
                          {isHeader ? '▸ ' : ''}{i + 1}
                        </td>
                        {Array.from({ length: maxCols }, (_, c) => (
                          <td key={c} style={{ padding: '5px 10px', color: isHeader ? '#d0d8e4' : '#8aa0b8', borderBottom: '1px solid #131c28', borderLeft: '1px solid #131c28', whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isHeader ? '600' : '400' }}>
                            {(r || [])[c] ?? ''}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: mapping + transforms + preview */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '12px' }}>Columns</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {MAPPING_FIELDS.map(field => (
                  <div key={field.key}>
                    <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#f87171' }}> *</span>}</label>
                    <select
                      style={{ ...inputStyle, borderColor: field.required && !hasItem ? '#991b1b' : '#1e2d40' }}
                      value={columns[field.key] ?? ''}
                      onChange={e => setCol(field.key, e.target.value)}
                    >
                      <option value="">— not mapped —</option>
                      {columnOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '4px' }}>Transforms <span style={{ color: '#5a6e84', fontWeight: '400' }}>(optional)</span></div>
              <div style={{ fontSize: '11.5px', color: '#5a6e84', marginBottom: '12px' }}>Applied to every line as each is parsed.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Cost multiplier</label>
                  <input style={inputStyle} value={transforms.multiplier} onChange={e => setTransforms(t => ({ ...t, multiplier: e.target.value }))} placeholder="e.g. 0.85" />
                </div>
                <div>
                  <label style={labelStyle}>Discount % off list</label>
                  <input style={inputStyle} value={transforms.discount_pct} onChange={e => setTransforms(t => ({ ...t, discount_pct: e.target.value }))} placeholder="e.g. 40 (used if no cost column)" />
                </div>
                <div>
                  <label style={labelStyle}>Strip prefix from item #</label>
                  <input style={inputStyle} value={transforms.strip_prefix} onChange={e => setTransforms(t => ({ ...t, strip_prefix: e.target.value }))} placeholder="e.g. GATES-" />
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8' }}>Preview</div>
                <div style={{ fontSize: '11.5px', color: preview.lines.length ? '#4ade80' : '#f87171' }}>
                  {preview.lines.length} lines · {preview.skippedNoPrice} skipped
                </div>
              </div>
              {preview.lines.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#4a5a6e' }}>Map an item # and a cost or list column to see parsed lines.</div>
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

            {/* Save profile + apply */}
            {batch.vendor_id && (
              <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#c0cad8', cursor: 'pointer', marginBottom: saveProfile ? '10px' : 0 }}>
                  <input type="checkbox" checked={saveProfile} onChange={e => setSaveProfile(e.target.checked)} style={{ accentColor: '#2563eb', width: '16px', height: '16px' }} />
                  Save as parse profile for {batch.vendor?.name}
                </label>
                {saveProfile && (
                  <input style={inputStyle} value={profileLabel} onChange={e => setProfileLabel(e.target.value)} placeholder="Profile label" />
                )}
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
      )}
    </div>
  )
}
