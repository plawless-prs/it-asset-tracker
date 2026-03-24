'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

export default function SubscriptionModal({ onSave, onClose }) {
  const supabase = createClient()

  const [form, setForm] = useState({
    name: '',
    vendor: '',
    monthly_cost: '',
    renewal_date: '',
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.monthly_cost) return alert('Name and monthly cost are required')
    setSaving(true)

    const { data, error } = await supabase
      .from('subscriptions')
      .insert({
        name: form.name.trim(),
        vendor: form.vendor.trim() || null,
        monthly_cost: Number(form.monthly_cost),
        renewal_date: form.renewal_date || null,
      })
      .select()
      .single()

    if (error) {
      alert('Error saving subscription: ' + error.message)
    } else {
      onSave(data)
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
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40',
        borderRadius: '16px', padding: '28px', maxWidth: '460px', width: '100%',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          Add Subscription
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Service Name *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. AWS, Slack, Zoom" />
          </div>
          <div>
            <label style={labelStyle}>Vendor</label>
            <input style={inputStyle} value={form.vendor} onChange={(e) => set('vendor', e.target.value)} placeholder="e.g. Amazon" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label style={labelStyle}>Monthly Cost ($) *</label>
            <input style={inputStyle} type="number" value={form.monthly_cost} onChange={(e) => set('monthly_cost', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={labelStyle}>Renewal Date</label>
            <input style={inputStyle} type="date" value={form.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
            backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
            backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Saving...' : 'Add Subscription'}</button>
        </div>
      </div>
    </div>
  )
}