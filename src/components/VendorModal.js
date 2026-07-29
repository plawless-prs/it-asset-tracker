'use client'

import { useState } from 'react'
import { createClient } from '../lib/supabase'

// Minimal vendor add/edit for the Price Update Processor. Covers the fields
// matching needs (P21 supplier id + item prefix) plus name / email domains /
// active. Full vendor management + parse-profile listing comes in Phase 7.
export default function VendorModal({ vendor, onClose, onSaved }) {
  const supabase = createClient()
  const editing = !!vendor?.id
  const [form, setForm] = useState({
    name: vendor?.name || '',
    p21_supplier_id: vendor?.p21_supplier_id || '',
    p21_item_prefix: vendor?.p21_item_prefix || '',
    email_domains: (vendor?.email_domains || []).join(', '),
    active: vendor?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function set(key, value) { setForm(prev => ({ ...prev, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      p21_supplier_id: form.p21_supplier_id.trim() || null,
      p21_item_prefix: form.p21_item_prefix || null,   // keep literal (may have a trailing space)
      email_domains: form.email_domains.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      active: form.active,
    }
    const q = editing
      ? supabase.from('pu_vendors').update(payload).eq('id', vendor.id)
      : supabase.from('pu_vendors').insert(payload)
    const { error: e } = await q
    setSaving(false)
    if (e) { setError(e.message); return }
    onSaved?.()
  }

  const labelStyle = { display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }
  const inputStyle = { width: '100%', padding: '10px 14px', backgroundColor: '#131a24', border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8', fontSize: '13.5px', outline: 'none', boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px', padding: '28px', maxWidth: '480px', width: '100%',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 20px' }}>
          {editing ? 'Edit vendor' : 'New vendor'}
        </h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Gates Corporation" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>P21 supplier ID</label>
            <input style={inputStyle} value={form.p21_supplier_id} onChange={e => set('p21_supplier_id', e.target.value)} placeholder="e.g. 10638" />
          </div>
          <div>
            <label style={labelStyle}>P21 item prefix</label>
            <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.p21_item_prefix} onChange={e => set('p21_item_prefix', e.target.value)} placeholder="e.g. &quot;GAT &quot;" />
          </div>
        </div>
        <div style={{ fontSize: '11px', color: '#5a6e84', margin: '-8px 0 14px' }}>
          Both are needed to match this vendor to P21 items. The prefix is literal — include the trailing space if there is one (e.g. <code style={{ color: '#8aa0b8' }}>GAT </code>).
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Email domains</label>
          <input style={inputStyle} value={form.email_domains} onChange={e => set('email_domains', e.target.value)} placeholder="gates.com, contitech.com" />
          <div style={{ fontSize: '11px', color: '#5a6e84', marginTop: '4px' }}>Comma-separated. Used to auto-identify inbound price emails (Phase 6).</div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#c0cad8', cursor: 'pointer', marginBottom: '20px' }}>
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} style={{ accentColor: '#2563eb', width: '16px', height: '16px' }} />
          Active
        </label>

        {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500', backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600', backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
