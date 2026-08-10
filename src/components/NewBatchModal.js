'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '../lib/supabase'
import { slugify, sanitizeFileName, dateFolderMMDDYY } from '../lib/priceupdates'

// New price-update batch: pick or create a vendor, drag-drop one or more files.
// Creates a `pu_batches` row (source 'upload', status 'received'), uploads the
// files to the private `price-files` bucket, and records `pu_batch_files` rows.
// Calls onCreated(batch) on success. `defaultEffectiveDate` ('YYYY-MM-DD')
// prefills the effective date — the calendar passes the clicked day.
export default function NewBatchModal({ onClose, onCreated, defaultEffectiveDate }) {
  const supabase = createClient()
  const fileInputRef = useRef(null)
  const [vendors, setVendors] = useState([])
  const [vendorId, setVendorId] = useState('')
  const [newVendorName, setNewVendorName] = useState('')
  const [creatingVendor, setCreatingVendor] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState(defaultEffectiveDate || '')
  const [files, setFiles] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('pu_vendors')
        .select('id, name, p21_supplier_id')
        .eq('active', true)
        .order('name')
      setVendors(data || [])
    }
    load()
  }, [])

  function addFiles(fileList) {
    const incoming = Array.from(fileList || [])
    if (incoming.length === 0) return
    setFiles(prev => {
      // De-dupe by name+size so a double drop doesn't stack the same file.
      const seen = new Set(prev.map(f => `${f.name}:${f.size}`))
      return [...prev, ...incoming.filter(f => !seen.has(`${f.name}:${f.size}`))]
    })
  }

  function removeFile(idx) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleCreate() {
    setError('')
    if (files.length === 0) { setError('Add at least one file.'); return }
    if (creatingVendor && !newVendorName.trim()) { setError('Enter a vendor name.'); return }
    setSaving(true)

    try {
      // 1. Resolve the vendor (create one if the user typed a new name).
      let resolvedVendorId = vendorId || null
      if (creatingVendor) {
        const { data: v, error: vErr } = await supabase
          .from('pu_vendors')
          .insert({ name: newVendorName.trim() })
          .select('id')
          .single()
        if (vErr) throw vErr
        resolvedVendorId = v.id
      }

      // 2. Create the batch.
      const { data: batch, error: bErr } = await supabase
        .from('pu_batches')
        .insert({ vendor_id: resolvedVendorId, source: 'upload', status: 'received', effective_date: effectiveDate || null })
        .select('id, number')
        .single()
      if (bErr) throw bErr

      // 3. Upload files + record pu_batch_files rows.
      const uploaded = []
      for (const file of files) {
        const safe = sanitizeFileName(file.name)
        const path = `${batch.id}/${Date.now()}-${safe}`
        const { error: upErr } = await supabase.storage.from('price-files').upload(path, file)
        if (upErr) throw upErr
        const { error: fErr } = await supabase.from('pu_batch_files').insert({
          batch_id: batch.id,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          file_size: file.size,
        })
        if (fErr) throw fErr
        uploaded.push({ path, safe, name: file.name, type: file.type, size: file.size })
      }

      // 3b. Archive copies into the file library under the vendor's date
      // folder (library/<vendor>/<year>/<MM-DD-YY>/, from the effective date,
      // else today) so the Files page keeps growing like the historical
      // archive. Best-effort — a failure here must not block the batch.
      const vendorRec = vendors.find(v => v.id === resolvedVendorId) ||
        (creatingVendor && resolvedVendorId ? { id: resolvedVendorId, name: newVendorName.trim() } : null)
      if (vendorRec) {
        try {
          const eff = effectiveDate || new Date().toISOString().slice(0, 10)
          const year = Number(eff.slice(0, 4))
          const folder = `library/${slugify(vendorRec.name)}/${year}/${dateFolderMMDDYY(eff)}`
          const { data: { user } } = await supabase.auth.getUser()
          for (const u of uploaded) {
            let dest = `${folder}/${u.safe}`
            let { error: cErr } = await supabase.storage.from('price-files').copy(u.path, dest)
            if (cErr) {  // same-named file already archived there — keep both
              dest = `${folder}/${Date.now()}-${u.safe}`
              const retry = await supabase.storage.from('price-files').copy(u.path, dest)
              if (retry.error) continue
            }
            await supabase.from('pu_library_files').insert({
              vendor_id: vendorRec.id, year, file_name: u.name, storage_path: dest,
              mime_type: u.type || null, file_size: u.size, batch_id: batch.id,
              source: 'batch', uploaded_by: user?.id || null,
            })
          }
        } catch { /* library archiving is best-effort */ }
      }

      // 4. Queue a supplier-scoped mirror sync so matching sees fresh P21 data
      // by the time the reviewer gets there. Best-effort: the nightly full
      // sync is the backstop, so a failure here must not block the batch.
      const supplierId = vendors.find(v => v.id === resolvedVendorId)?.p21_supplier_id
      if (supplierId) {
        try {
          const { data: { user } } = await supabase.auth.getUser()
          await supabase.from('pu_sync_requests').insert({
            supplier_id: String(supplierId),
            reason: 'batch_created',
            requested_by: user?.id || null,
          })
        } catch { /* ignore */ }
      }

      onCreated?.(batch)
    } catch (e) {
      setError(e.message || 'Something went wrong creating the batch.')
      setSaving(false)
    }
  }

  const labelStyle = {
    display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
    textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
  }
  const inputStyle = {
    width: '100%', padding: '10px 14px', backgroundColor: '#131a24',
    border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8',
    fontSize: '13.5px', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40',
        borderRadius: '16px', padding: '28px', maxWidth: '520px', width: '100%',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 20px' }}>
          New price-update batch
        </h2>

        {/* Vendor picker */}
        <div style={{ marginBottom: '18px' }}>
          <label style={labelStyle}>Vendor</label>
          {!creatingVendor ? (
            <>
              <select
                style={inputStyle}
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">Unidentified (set later)</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button
                type="button"
                onClick={() => { setCreatingVendor(true); setVendorId('') }}
                style={{
                  marginTop: '8px', background: 'none', border: 'none', padding: 0,
                  color: '#60a5fa', fontSize: '12.5px', cursor: 'pointer',
                }}
              >
                + Add a new vendor
              </button>
            </>
          ) : (
            <>
              <input
                style={inputStyle}
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="Vendor name"
                autoFocus
              />
              <button
                type="button"
                onClick={() => { setCreatingVendor(false); setNewVendorName('') }}
                style={{
                  marginTop: '8px', background: 'none', border: 'none', padding: 0,
                  color: '#8aa0b8', fontSize: '12.5px', cursor: 'pointer',
                }}
              >
                ← Pick an existing vendor
              </button>
            </>
          )}
        </div>

        {/* Effective date — one date for the whole batch */}
        <div style={{ marginBottom: '18px' }}>
          <label style={labelStyle}>Effective date <span style={{ color: '#5a6e84', fontWeight: '400', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input
            type="date"
            style={{ ...inputStyle, colorScheme: 'dark' }}
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
          <div style={{ fontSize: '11.5px', color: '#5a6e84', marginTop: '5px' }}>
            When these prices take effect. Can be left blank and set later.
          </div>
        </div>

        {/* Drop zone */}
        <div style={{ marginBottom: '18px' }}>
          <label style={labelStyle}>Files</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
            style={{
              border: `1.5px dashed ${dragOver ? '#2563eb' : '#1e2d40'}`,
              backgroundColor: dragOver ? '#111d2e' : '#131a24',
              borderRadius: '10px', padding: '26px 16px', textAlign: 'center',
              cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s',
            }}
          >
            <div style={{ fontSize: '13.5px', color: '#8aa0b8', marginBottom: '4px' }}>
              Drop Excel / CSV / PDF files here
            </div>
            <div style={{ fontSize: '12px', color: '#5a6e84' }}>or click to browse</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".xlsx,.xls,.csv,.pdf"
            onChange={(e) => addFiles(e.target.files)}
            style={{ display: 'none' }}
          />
          {files.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {files.map((f, i) => (
                <div key={`${f.name}:${f.size}`} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: '10px', padding: '8px 12px', backgroundColor: '#131a24',
                  border: '1px solid #182030', borderRadius: '8px',
                }}>
                  <span style={{ fontSize: '12.5px', color: '#c0cad8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    style={{ background: 'none', border: 'none', color: '#5a6e84', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: '8px', marginBottom: '16px',
            fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
            backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>Cancel</button>
          <button onClick={handleCreate} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
            backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Creating…' : 'Create batch'}</button>
        </div>
      </div>
    </div>
  )
}
