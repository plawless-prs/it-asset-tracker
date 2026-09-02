'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { useRole } from '../../../lib/useRole'
import { FREQUENCY_META } from '../../../lib/dailyops'

// Checklist template CRUD (admin/agent-only per the spec — RLS enforces it
// too). Items are edited inline in the modal: label + optional instructions,
// required flag, reorder with up/down.
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'adhoc']

export default function DailyOpsTemplates() {
  const supabase = createClient()
  const { isAdmin } = useRole()
  const [templates, setTemplates] = useState(null)
  const [editing, setEditing] = useState(null)   // template object or {} for new
  const [error, setError] = useState('')

  async function load() {
    const { data, error: e } = await supabase
      .from('sop_templates')
      .select('id, title, description, frequency, active, sort_order, items:sop_template_items(id, label, instructions, required, sort_order)')
      .order('sort_order')
    if (e) setError(e.message)
    setTemplates((data || []).map(t => ({ ...t, items: [...(t.items || [])].sort((a, b) => a.sort_order - b.sort_order) })))
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '880px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Templates</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
            Recurring checklists — daily runs appear every day, weekly on Mondays, monthly on the 1st.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setEditing({})} style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '9px 16px', borderRadius: '10px',
            fontWeight: '600', fontSize: '13px', border: 'none', cursor: 'pointer',
          }}>+ New template</button>
        )}
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

      {templates === null ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px', color: '#4a5a6e', fontSize: '13px' }}>
          No templates yet{isAdmin ? ' — create the first checklist.' : '.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {templates.map(t => {
            const fm = FREQUENCY_META[t.frequency] || FREQUENCY_META.daily
            return (
              <div
                key={t.id}
                onClick={() => isAdmin && setEditing(t)}
                style={{ ...card, padding: '14px 18px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', cursor: isAdmin ? 'pointer' : 'default', opacity: t.active ? 1 : 0.55 }}
              >
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#e0e7f0' }}>{t.title}</div>
                  {t.description && <div style={{ fontSize: '12px', color: '#5a6e84', marginTop: '2px' }}>{t.description}</div>}
                </div>
                <span style={{ fontSize: '12px', color: '#8aa0b8' }}>{t.items.length} step{t.items.length === 1 ? '' : 's'}</span>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: fm.pillBg, color: fm.pillText }}>{fm.label}</span>
                {!t.active && <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: '#1a1a1a', color: '#737373' }}>Inactive</span>}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <TemplateModal
          supabase={supabase}
          template={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function TemplateModal({ supabase, template, onClose, onSaved }) {
  const { user } = useRole()
  const editingExisting = !!template?.id
  const [form, setForm] = useState({
    title: template?.title || '',
    description: template?.description || '',
    frequency: template?.frequency || 'daily',
    active: template?.active ?? true,
  })
  // Items are edited as a local list and reconciled on save.
  const [items, setItems] = useState((template?.items || []).map(i => ({ ...i })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputStyle = {
    width: '100%', padding: '9px 12px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
    borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontSize: '11px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }

  function moveItem(idx, dir) {
    setItems(list => {
      const next = [...list]
      const j = idx + dir
      if (j < 0 || j >= next.length) return list
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function save() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    const usable = items.filter(i => i.label.trim())
    if (usable.length === 0) { setError('Add at least one step.'); return }
    setSaving(true); setError('')
    try {
      let templateId = template?.id
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        frequency: form.frequency,
        active: form.active,
      }
      if (editingExisting) {
        const { error: e } = await supabase.from('sop_templates').update(payload).eq('id', templateId)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('sop_templates')
          .insert({ ...payload, created_by: user?.id }).select('id').single()
        if (e) throw e
        templateId = data.id
      }

      // Reconcile items: update kept rows, insert new ones, delete removed.
      // sort_order = position in the list.
      const keptIds = usable.filter(i => i.id).map(i => i.id)
      const removed = (template?.items || []).filter(i => !keptIds.includes(i.id))
      if (removed.length) {
        // Past runs' check-state references items — delete their status rows
        // first (sop_item_status.template_item_id has no cascade).
        const { error: sErr } = await supabase.from('sop_item_status')
          .delete().in('template_item_id', removed.map(i => i.id))
        if (sErr) throw sErr
        const { error: dErr } = await supabase.from('sop_template_items')
          .delete().in('id', removed.map(i => i.id))
        if (dErr) throw dErr
      }
      for (let idx = 0; idx < usable.length; idx++) {
        const i = usable[idx]
        const row = {
          label: i.label.trim(),
          instructions: (i.instructions || '').trim() || null,
          required: i.required ?? true,
          sort_order: idx,
        }
        if (i.id) {
          const { error: e } = await supabase.from('sop_template_items').update(row).eq('id', i.id)
          if (e) throw e
        } else {
          const { error: e } = await supabase.from('sop_template_items').insert({ ...row, template_id: templateId })
          if (e) throw e
        }
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px', padding: '24px',
        maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 16px' }}>
          {editingExisting ? 'Edit template' : 'New template'}
        </h2>

        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Title *</label>
          <input style={inputStyle} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Morning opening checklist" autoFocus />
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', marginBottom: '16px' }}>
          <div style={{ minWidth: '140px' }}>
            <label style={labelStyle}>Frequency</label>
            <select style={inputStyle} value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
              {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_META[f].label}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#c0cad8', cursor: 'pointer', paddingBottom: '9px' }}>
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} style={{ accentColor: '#2563eb', width: '16px', height: '16px' }} />
            Active
          </label>
        </div>

        <div style={{ borderTop: '1px solid #182030', paddingTop: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>Steps ({items.length})</div>
          {items.map((i, idx) => (
            <div key={i.id || `new-${idx}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: '6px' }}>
                <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} style={{ background: 'none', border: 'none', color: idx === 0 ? '#31415a' : '#8aa0b8', cursor: idx === 0 ? 'default' : 'pointer', padding: 0, fontSize: '11px', lineHeight: 1 }}>▲</button>
                <button onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1} style={{ background: 'none', border: 'none', color: idx === items.length - 1 ? '#31415a' : '#8aa0b8', cursor: idx === items.length - 1 ? 'default' : 'pointer', padding: 0, fontSize: '11px', lineHeight: 1 }}>▼</button>
              </div>
              <div style={{ flex: 1 }}>
                <input
                  style={{ ...inputStyle, marginBottom: '4px' }}
                  value={i.label}
                  placeholder={`Step ${idx + 1}`}
                  onChange={e => setItems(list => list.map((x, xi) => xi === idx ? { ...x, label: e.target.value } : x))}
                />
                <input
                  style={{ ...inputStyle, fontSize: '12px', color: '#8aa0b8' }}
                  value={i.instructions || ''}
                  placeholder="Instructions (optional)"
                  onChange={e => setItems(list => list.map((x, xi) => xi === idx ? { ...x, instructions: e.target.value } : x))}
                />
              </div>
              <label title="Required to complete the checklist" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#5a6e84', cursor: 'pointer', paddingTop: '10px' }}>
                <input type="checkbox" checked={i.required ?? true} onChange={e => setItems(list => list.map((x, xi) => xi === idx ? { ...x, required: e.target.checked } : x))} style={{ accentColor: '#2563eb' }} />
                req
              </label>
              <button onClick={() => setItems(list => list.filter((_, xi) => xi !== idx))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '14px', paddingTop: '8px' }}>✕</button>
            </div>
          ))}
          <button onClick={() => setItems(list => [...list, { label: '', instructions: '', required: true }])} style={{
            background: 'none', border: '1px dashed #1e2d40', borderRadius: '8px', color: '#60a5fa',
            fontSize: '12.5px', fontWeight: '600', cursor: 'pointer', padding: '8px 14px', width: '100%',
          }}>+ Add step</button>
        </div>

        {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '500', backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </div>
  )
}
