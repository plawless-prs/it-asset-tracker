'use client'

import { useState, useRef } from 'react'
import { createClient } from '../lib/supabase'

export default function AssetModal({ asset, onSave, onClose }) {
  const supabase = createClient()
  const fileRef = useRef(null)
  const isEditing = !!asset

  const [form, setForm] = useState({
    name: asset?.name || '',
    category: asset?.category || 'Hardware',
    serial_number: asset?.serial_number || '',
    make: asset?.make || '',
    model: asset?.model || '',
    status: asset?.status || 'Ready to Deploy',
    purchase_cost: asset?.purchase_cost || '',
    purchase_date: asset?.purchase_date || '',
    warranty_expiry: asset?.warranty_expiry || '',
    useful_life_months: asset?.useful_life_months || '60',
    assigned_to: asset?.assigned_to || '',
    location: asset?.location || '',
    notes: asset?.notes || '',
    photo_url: asset?.photo_url || '',
  })

  const [photoPreview, setPhotoPreview] = useState(asset?.photo_url || '')
  const [photoFile, setPhotoFile] = useState(null)
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    // Show a preview immediately
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!form.name.trim()) return alert('Asset name is required')
    setSaving(true)

    let photoUrl = form.photo_url

    // Upload photo if a new one was selected
    if (photoFile) {
      const fileExt = photoFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('it-asset-photos')
        .upload(fileName, photoFile)

      if (uploadError) {
        alert('Photo upload failed: ' + uploadError.message)
        setSaving(false)
        return
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from('it-asset-photos')
        .getPublicUrl(fileName)

      photoUrl = urlData.publicUrl
    }

    const record = {
      name: form.name.trim(),
      category: form.category,
      serial_number: form.serial_number.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      status: form.status,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
      purchase_date: form.purchase_date || null,
      warranty_expiry: form.warranty_expiry || null,
      useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : 60,
      assigned_to: form.assigned_to.trim() || null,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      photo_url: photoUrl || null,
      updated_at: new Date().toISOString(),
    }

    let result
    if (isEditing) {
      result = await supabase.from('assets').update(record).eq('id', asset.id).select().single()
    } else {
      result = await supabase.from('assets').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving asset: ' + result.error.message)
    } else {
      onSave(result.data, !isEditing)
    }

    setSaving(false)
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    backgroundColor: '#131a24',
    border: '1px solid #1e2d40',
    borderRadius: '8px',
    color: '#c0cad8',
    fontSize: '13.5px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle = {
    display: 'block',
    fontSize: '11.5px',
    fontWeight: '600',
    color: '#5a6e84',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    marginBottom: '6px',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0f1620',
          border: '1px solid #1e2d40',
          borderRadius: '16px',
          padding: '28px',
          maxWidth: '560px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          {isEditing ? 'Edit Asset' : 'Add New Asset'}
        </h2>

        {/* Photo Upload */}
        <div style={{ marginBottom: '18px' }}>
          <label style={labelStyle}>Asset Photo</label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: photoPreview ? '1px solid #1e2d40' : '2px dashed #1e2d40',
              borderRadius: '12px',
              padding: photoPreview ? '0' : '24px',
              textAlign: 'center',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            {photoPreview ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={photoPreview}
                  alt="Asset preview"
                  style={{
                    width: '100%',
                    height: '180px',
                    objectFit: 'cover',
                    display: 'block',
                    borderRadius: '10px',
                  }}
                />
                <div style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#8aa0b8',
                }}>
                  Click to change
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '28px', color: '#2a3a4e', marginBottom: '6px' }}>
                  📷
                </div>
                <div style={{ fontSize: '13px', color: '#4a5a6e' }}>
                  Click to upload a photo of this asset
                </div>
                <div style={{ fontSize: '11px', color: '#3a4a5e', marginTop: '4px' }}>
                  JPG, PNG up to 5MB
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
        </div>

        {/* Form Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Asset Name *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. MacBook Pro 16″" />
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {['Hardware', 'Software', 'Peripheral', 'Network', 'Mobile', 'Other'].map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Serial Number</label>
            <input style={inputStyle} value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder="SN-XXXX-XXXX" />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {['Ready to Deploy', 'Deployed', 'Pending', 'In Repair', 'Archived', 'Lost/Stolen', 'Disposed'].map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Make</label>
            <input style={inputStyle} value={form.make} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Apple" />
          </div>
          <div>
            <label style={labelStyle}>Model</label>
            <input style={inputStyle} value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. A2141" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Purchase Cost ($)</label>
            <input style={inputStyle} type="number" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={labelStyle}>Purchase Date</label>
            <input style={inputStyle} type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Warranty Expiry</label>
            <input style={inputStyle} type="date" value={form.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Useful Life (months)</label>
            <input style={inputStyle} type="number" value={form.useful_life_months} onChange={(e) => set('useful_life_months', e.target.value)} placeholder="60" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Assigned To</label>
            <input style={inputStyle} value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Employee name" />
          </div>
          <div>
            <label style={labelStyle}>Location</label>
            <input style={inputStyle} value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Office / Room" />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Any additional details..."
          />
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 22px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: '500',
              backgroundColor: '#131a24',
              color: '#8aa0b8',
              border: '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '10px 22px',
              borderRadius: '10px',
              fontSize: '13.5px',
              fontWeight: '600',
              backgroundColor: saving ? '#1e40af' : '#2563eb',
              color: '#fff',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Asset')}
          </button>
        </div>
      </div>
    </div>
  )
}