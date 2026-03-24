'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

export default function BudgetModal({ onSave, onClose }) {
  const supabase = createClient()
  const categories = ['Hardware', 'Software', 'Services', 'Infrastructure', 'Personnel', 'Other']

  const [form, setForm] = useState({
    category: 'Hardware',
    amount: '',
    period: 'Annual',
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    if (!form.amount) return alert('Amount is required')
    setSaving(true)

    const { data, error } = await supabase
      .from('budgets')
      .insert({
        category: form.category,
        amount: Number(form.amount),
        period: form.period,
      })
      .select()
      .single()

    if (error) {
      alert('Error saving budget: ' + error.message)
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
          Set Budget
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Amount ($)</label>
            <input style={inputStyle} type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" />
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Period</label>
          <select style={inputStyle} value={form.period} onChange={(e) => set('period', e.target.value)}>
            <option>Annual</option>
            <option>Quarterly</option>
            <option>Monthly</option>
          </select>
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
          }}>{saving ? 'Saving...' : 'Set Budget'}</button>
        </div>
      </div>
    </div>
  )
}