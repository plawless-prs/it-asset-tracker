'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

export default function LocationModal({ location, onSave, onClose }) {
  const supabase = createClient()
  const isEditing = !!location

  const [form, setForm] = useState({
    name: location?.name || '',
    address: location?.address || '',
    notes: location?.notes || '',
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) return alert('Location name is required')
    setSaving(true)

    const record = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }

    let result
    if (isEditing) {
      result = await supabase.from('locations').update(record).eq('id', location.id).select().single()
    } else {
      result = await supabase.from('locations').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving location: ' + result.error.message)
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
          maxWidth: '480px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          {isEditing ? 'Edit Location' : 'Add Location'}
        </h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Tuscaloosa Headquarters" />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Address</label>
          <input style={inputStyle} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state" />
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

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
              backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
              backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Location')}
          </button>
        </div>
      </div>
    </div>
  )
}
