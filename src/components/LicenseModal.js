'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

export default function LicenseModal({ license, onSave, onClose }) {
  const supabase = createClient()
  const isEditing = !!license

  const [form, setForm] = useState({
    name: license?.name || '',
    vendor: license?.vendor || '',
    product_key: license?.product_key || '',
    total_seats: license?.total_seats || '',
    seats_used: license?.seats_used || '',
    expiration_date: license?.expiration_date || '',
    annual_cost: license?.annual_cost || '',
  })

  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.name.trim()) return alert('Software name is required')
    setSaving(true)

    const record = {
      name: form.name.trim(),
      vendor: form.vendor.trim() || null,
      product_key: form.product_key.trim() || null,
      total_seats: form.total_seats ? Number(form.total_seats) : null,
      seats_used: form.seats_used ? Number(form.seats_used) : 0,
      expiration_date: form.expiration_date || null,
      annual_cost: form.annual_cost ? Number(form.annual_cost) : null,
    }

    let result
    if (isEditing) {
      result = await supabase.from('licenses').update(record).eq('id', license.id).select().single()
    } else {
      result = await supabase.from('licenses').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving license: ' + result.error.message)
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
          {isEditing ? 'Edit License' : 'Add Software License'}
        </h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Software Name *</label>
          <input
            style={inputStyle}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Microsoft 365 Business"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Vendor</label>
            <input
              style={inputStyle}
              value={form.vendor}
              onChange={(e) => set('vendor', e.target.value)}
              placeholder="e.g. Microsoft"
            />
          </div>
          <div>
            <label style={labelStyle}>Product Key</label>
            <input
              style={inputStyle}
              value={form.product_key}
              onChange={(e) => set('product_key', e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Total Seats</label>
            <input
              style={inputStyle}
              type="number"
              value={form.total_seats}
              onChange={(e) => set('total_seats', e.target.value)}
              placeholder="e.g. 25"
            />
          </div>
          <div>
            <label style={labelStyle}>Seats Used</label>
            <input
              style={inputStyle}
              type="number"
              value={form.seats_used}
              onChange={(e) => set('seats_used', e.target.value)}
              placeholder="e.g. 18"
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>Expiration Date</label>
            <input
              style={inputStyle}
              type="date"
              value={form.expiration_date}
              onChange={(e) => set('expiration_date', e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Annual Cost ($)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.annual_cost}
              onChange={(e) => set('annual_cost', e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>

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
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add License')}
          </button>
        </div>
      </div>
    </div>
  )
}