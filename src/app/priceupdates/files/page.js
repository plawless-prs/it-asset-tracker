'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../../lib/supabase'
import { formatDate, formatBytes, slugify as slug, sanitizeFileName as sanitize } from '../../../lib/priceupdates'

// Phase 5.5: the price-file library. Historical vendor price files (bulk-
// imported via scripts/import-price-library.mjs) plus new in-app uploads,
// stored in `price-files` under library/<vendor>/<year>/. Metadata
// (vendor/year/batch link) lives on pu_library_files and is editable here —
// the storage key never changes after upload.
const PAGE_SIZE = 50

export default function PriceUpdatesFiles() {
  const supabase = createClient()
  const [files, setFiles] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [vendors, setVendors] = useState([])
  const [vendorFilter, setVendorFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [facets, setFacets] = useState({ years: [], dates: [] })
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [linkFile, setLinkFile] = useState(null)   // file whose batch link is being edited
  const [editFile, setEditFile] = useState(null)   // file whose vendor/year is being edited
  const searchTimer = useRef(null)

  useEffect(() => {
    supabase.from('pu_vendors').select('id, name').order('name').then(({ data }) => setVendors(data || []))
  }, [])

  async function load(p = page) {
    setLoading(true)
    let q = supabase
      .from('pu_library_files')
      .select('*, vendor:vendor_id(id, name), batch:batch_id(id, number)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((p - 1) * PAGE_SIZE, p * PAGE_SIZE - 1)
    if (vendorFilter) q = q.eq('vendor_id', vendorFilter)
    if (yearFilter) q = q.eq('year', Number(yearFilter))
    if (yearFilter && dateFilter) {
      // The "date" is the archive's folder after the year in the key.
      q = q.ilike('storage_path', `%/${yearFilter}/${dateFilter.replace(/[%,()]/g, ' ')}/%`)
    }
    if (search.trim()) {
      // Match the name or anywhere in the storage path, so archive subfolder
      // context (brand/customer/date folders) is searchable too.
      const term = search.trim().replace(/[%,()]/g, ' ')
      q = q.or(`file_name.ilike.%${term}%,storage_path.ilike.%${term}%`)
    }
    const { data, count, error: e } = await q
    if (e) setError(e.message)
    setFiles(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  // Facet dropdowns follow the vendor/year selection (folder-style: vendor ->
  // year -> date). Year changes clear the date pick; vendor changes clear both
  // if they're no longer valid (the facet reload handles the option lists).
  useEffect(() => {
    supabase.rpc('pu_library_facets', {
      p_vendor_id: vendorFilter || null,
      p_year: yearFilter ? Number(yearFilter) : null,
    }).then(({ data }) => {
      if (!data) return
      setFacets(data)
      if (yearFilter && !data.years.includes(Number(yearFilter))) setYearFilter('')
      if (dateFilter && !data.dates.includes(dateFilter)) setDateFilter('')
    })
  }, [vendorFilter, yearFilter])

  useEffect(() => { setPage(1); load(1) }, [vendorFilter, yearFilter, dateFilter])
  useEffect(() => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(1); load(1) }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  async function download(f) {
    const { data, error: e } = await supabase.storage
      .from('price-files').createSignedUrl(f.storage_path, 60, { download: f.file_name })
    if (e) { setError(e.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function removeFile(f) {
    if (!window.confirm(`Delete "${f.file_name}" from the library? This removes the stored file too.`)) return
    setError(''); setNotice('')
    const { error: sErr } = await supabase.storage.from('price-files').remove([f.storage_path])
    if (sErr) { setError(sErr.message); return }
    const { error: dErr } = await supabase.from('pu_library_files').delete().eq('id', f.id)
    if (dErr) { setError(dErr.message); return }
    setNotice(`Deleted ${f.file_name}.`)
    load()
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px' }
  const inputStyle = {
    padding: '8px 12px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
    borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none',
  }
  const thStyle = {
    textAlign: 'left', padding: '10px 14px', fontSize: '11px', fontWeight: '600',
    color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: '1px solid #182030', whiteSpace: 'nowrap',
  }
  const tdStyle = { padding: '10px 14px', fontSize: '13px', color: '#c0cad8', borderBottom: '1px solid #131a24' }
  const actionBtn = {
    background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer',
    color: '#60a5fa', fontSize: '12.5px',
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Files</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
            Vendor price-file library — {total.toLocaleString()} file{total === 1 ? '' : 's'}.
          </p>
        </div>
        <button onClick={() => setUploadOpen(true)} style={{
          padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
          backgroundColor: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
        }}>+ Upload files</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={inputStyle}>
          <option value="">All vendors</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => { setYearFilter(e.target.value); setDateFilter('') }} style={inputStyle}>
          <option value="">All years</option>
          {facets.years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
          disabled={!yearFilter || facets.dates.length === 0}
          style={{ ...inputStyle, opacity: (!yearFilter || facets.dates.length === 0) ? 0.5 : 1 }}
          title={!yearFilter ? 'Pick a year first' : facets.dates.length === 0 ? 'No date folders in this year' : ''}
        >
          <option value="">All dates</option>
          {facets.dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          placeholder="Search file names…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
        />
      </div>

      {notice && <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '10px', fontSize: '12.5px', backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #166534' }}>{notice}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '10px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>File</th>
                <th style={thStyle}>Vendor</th>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>Size</th>
                <th style={thStyle}>Added</th>
                <th style={thStyle}>Batch</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#5a6e84', padding: '32px' }}>Loading…</td></tr>
              ) : files.length === 0 ? (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#5a6e84', padding: '32px' }}>
                  No files{search || vendorFilter || yearFilter ? ' match the filters' : ' yet — upload some, or bulk-import the archive (scripts/import-price-library.mjs)'}.
                </td></tr>
              ) : files.map(f => (
                <tr key={f.id}>
                  <td style={{ ...tdStyle, maxWidth: '340px' }} title={f.storage_path}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</div>
                    {/* Subfolder context (e.g. the date folder from the archive) — key segments between library/<vendor>/ and the file name. */}
                    {f.storage_path.split('/').length > 3 && (
                      <div style={{ fontSize: '11px', color: '#5a6e84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {f.storage_path.split('/').slice(2, -1).join(' / ')}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {f.vendor?.name || <span style={{ color: '#f59e0b' }}>Unassigned</span>}
                  </td>
                  <td style={tdStyle}>{f.year || '—'}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatBytes(f.file_size)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatDate(f.created_at)}</td>
                  <td style={tdStyle}>
                    {f.batch ? (
                      <Link href={`/priceupdates/batches/${f.batch.id}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>
                        #{f.batch.number}
                      </Link>
                    ) : '—'}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button style={actionBtn} onClick={() => download(f)}>Download</button>
                    <button style={actionBtn} onClick={() => setEditFile(f)}>Edit</button>
                    <button style={actionBtn} onClick={() => setLinkFile(f)}>{f.batch ? 'Re-link' : 'Link batch'}</button>
                    <button style={{ ...actionBtn, color: '#f87171' }} onClick={() => removeFile(f)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderTop: '1px solid #182030' }}>
            <span style={{ fontSize: '12px', color: '#5a6e84' }}>Page {page} of {pageCount}</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button disabled={page <= 1} onClick={() => { setPage(page - 1); load(page - 1) }} style={{ ...actionBtn, color: page <= 1 ? '#31415a' : '#60a5fa' }}>← Prev</button>
              <button disabled={page >= pageCount} onClick={() => { setPage(page + 1); load(page + 1) }} style={{ ...actionBtn, color: page >= pageCount ? '#31415a' : '#60a5fa' }}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {uploadOpen && (
        <UploadModal
          supabase={supabase} vendors={vendors}
          onClose={() => setUploadOpen(false)}
          onDone={(msg) => { setUploadOpen(false); setNotice(msg); load() }}
        />
      )}
      {editFile && (
        <EditModal
          supabase={supabase} vendors={vendors} file={editFile}
          onClose={() => setEditFile(null)}
          onDone={() => { setEditFile(null); load() }}
        />
      )}
      {linkFile && (
        <LinkBatchModal
          supabase={supabase} file={linkFile}
          onClose={() => setLinkFile(null)}
          onDone={() => { setLinkFile(null); load() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

const modalBackdrop = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
}
const modalBox = {
  backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px',
  padding: '26px', maxWidth: '480px', width: '100%',
}
const modalLabel = {
  display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
  textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
}
const modalInput = {
  width: '100%', padding: '10px 14px', backgroundColor: '#131a24',
  border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8',
  fontSize: '13.5px', outline: 'none', boxSizing: 'border-box',
}
const modalBtnRow = { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }
const cancelBtn = {
  padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '500',
  backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
}
const primaryBtn = (busy) => ({
  padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
  backgroundColor: busy ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
  cursor: busy ? 'not-allowed' : 'pointer',
})

function UploadModal({ supabase, vendors, onClose, onDone }) {
  const [vendorId, setVendorId] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  async function handleUpload() {
    if (picked.length === 0) { setErr('Add at least one file.'); return }
    setBusy(true); setErr('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const vendor = vendors.find(v => v.id === vendorId)
      for (const file of picked) {
        const key = `library/${slug(vendor?.name)}/${year || 'unsorted'}/${Date.now()}-${sanitize(file.name)}`
        const { error: upErr } = await supabase.storage.from('price-files').upload(key, file)
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('pu_library_files').insert({
          vendor_id: vendorId || null,
          year: year ? Number(year) : null,
          file_name: file.name,
          storage_path: key,
          mime_type: file.type || null,
          file_size: file.size,
          source: 'upload',
          uploaded_by: user?.id || null,
        })
        if (insErr) throw insErr
      }
      onDone(`Uploaded ${picked.length} file${picked.length === 1 ? '' : 's'} to the library.`)
    } catch (e) {
      setErr(e.message || 'Upload failed')
      setBusy(false)
    }
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 18px' }}>Upload to library</h2>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={modalLabel}>Vendor</label>
            <select style={modalInput} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Unassigned</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ width: '110px' }}>
            <label style={modalLabel}>Year</label>
            <input type="number" style={modalInput} value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
        </div>
        <div
          onClick={() => inputRef.current?.click()}
          style={{
            border: '1.5px dashed #1e2d40', backgroundColor: '#131a24', borderRadius: '10px',
            padding: '22px 16px', textAlign: 'center', cursor: 'pointer', marginBottom: '12px',
          }}
        >
          <div style={{ fontSize: '13px', color: '#8aa0b8' }}>
            {picked.length ? `${picked.length} file${picked.length === 1 ? '' : 's'} selected` : 'Click to choose files'}
          </div>
        </div>
        <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
          onChange={(e) => setPicked(Array.from(e.target.files || []))} />
        {err && <div style={{ padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{err}</div>}
        <div style={modalBtnRow}>
          <button style={cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={primaryBtn(busy)} onClick={handleUpload} disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
      </div>
    </div>
  )
}

function EditModal({ supabase, vendors, file, onClose, onDone }) {
  const [vendorId, setVendorId] = useState(file.vendor_id || '')
  const [year, setYear] = useState(file.year ? String(file.year) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setBusy(true); setErr('')
    const { error: e } = await supabase.from('pu_library_files')
      .update({ vendor_id: vendorId || null, year: year ? Number(year) : null })
      .eq('id', file.id)
    if (e) { setErr(e.message); setBusy(false); return }
    onDone()
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalBox} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 6px' }}>Edit file</h2>
        <div style={{ fontSize: '12.5px', color: '#5a6e84', marginBottom: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.file_name}</div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={modalLabel}>Vendor</label>
            <select style={modalInput} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Unassigned</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ width: '110px' }}>
            <label style={modalLabel}>Year</label>
            <input type="number" style={modalInput} value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
        </div>
        {err && <div style={{ marginTop: '12px', padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{err}</div>}
        <div style={modalBtnRow}>
          <button style={cancelBtn} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={primaryBtn(busy)} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function LinkBatchModal({ supabase, file, onClose, onDone }) {
  const [batches, setBatches] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let q = supabase.from('pu_batches')
      .select('id, number, status, created_at, vendor:vendor_id(name)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (file.vendor_id) q = q.eq('vendor_id', file.vendor_id)
    q.then(({ data }) => setBatches(data || []))
  }, [])

  async function setLink(batchId) {
    setBusy(true); setErr('')
    const { error: e } = await supabase.from('pu_library_files')
      .update({ batch_id: batchId })
      .eq('id', file.id)
    if (e) { setErr(e.message); setBusy(false); return }
    onDone()
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={{ ...modalBox, maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 6px' }}>Link to batch</h2>
        <div style={{ fontSize: '12.5px', color: '#5a6e84', marginBottom: '14px' }}>
          {file.file_name}{file.vendor_id ? '' : ' — no vendor set, showing recent batches from all vendors'}
        </div>
        {file.batch_id && (
          <button style={{ ...cancelBtn, width: '100%', marginBottom: '10px' }} onClick={() => setLink(null)} disabled={busy}>
            Unlink current batch
          </button>
        )}
        <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #182030', borderRadius: '10px' }}>
          {batches === null ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#5a6e84', fontSize: '13px' }}>Loading…</div>
          ) : batches.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#5a6e84', fontSize: '13px' }}>No batches for this vendor yet.</div>
          ) : batches.map(b => (
            <button key={b.id} onClick={() => setLink(b.id)} disabled={busy} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
              padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid #131a24',
              cursor: busy ? 'not-allowed' : 'pointer', textAlign: 'left',
            }}>
              <span style={{ fontSize: '13px', color: '#c0cad8' }}>
                #{b.number} <span style={{ color: '#5a6e84' }}>· {b.vendor?.name || 'Unidentified'} · {b.status}</span>
              </span>
              <span style={{ fontSize: '12px', color: '#5a6e84' }}>{formatDate(b.created_at)}</span>
            </button>
          ))}
        </div>
        {err && <div style={{ marginTop: '12px', padding: '9px 12px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{err}</div>}
        <div style={modalBtnRow}>
          <button style={cancelBtn} onClick={onClose} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  )
}
