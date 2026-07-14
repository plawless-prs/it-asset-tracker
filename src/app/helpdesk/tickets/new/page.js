'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import {
  PRIORITY_ORDER, PRIORITY_META, SOURCE_OPTIONS, displayName, sendNotify,
} from '../../../../lib/helpdesk'

const CATEGORIES = ['hardware', 'software', 'access', 'network', 'billing', 'other']

const inputStyle = {
  width: '100%', padding: '10px 14px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '13.5px', outline: 'none', boxSizing: 'border-box',
}
const labelStyle = {
  display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
  textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
}

export default function NewTicket() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = useRole()
  const [profiles, setProfiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', requester_id: '', assignee_id: '',
    category: 'hardware', priority: 'medium', source: 'manual',
  })

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('profiles').select('id, full_name, email').order('full_name')
      setProfiles(data || [])
    }
    load()
  }, [])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Requester defaults to the current user until explicitly chosen.
  const requesterValue = form.requester_id || (user?.id ?? '')

  async function submit() {
    if (!form.title.trim()) return alert('Title is required')
    if (!form.description.trim()) return alert('Description is required')
    if (!requesterValue) return alert('Requester is required')
    setSaving(true)

    const { data, error } = await supabase.from('tickets').insert({
      title: form.title.trim(),
      description: form.description.trim(),
      requester_id: requesterValue,
      assignee_id: form.assignee_id || null,
      category: form.category,
      priority: form.priority,
      source: form.source,
    }).select('id, number').single()

    if (error) { setSaving(false); return alert('Error: ' + error.message) }

    await supabase.from('ticket_activity').insert({
      ticket_id: data.id, actor_id: user?.id, action: 'created', to_value: form.priority,
    })

    // Notify the assignee, if one was set.
    if (form.assignee_id) {
      const assignee = profiles.find(p => p.id === form.assignee_id)
      if (assignee?.email) {
        sendNotify(supabase, {
          to: assignee.email,
          subject: `Ticket #${data.number} assigned to you: ${form.title.trim()}`,
          body: `A Help Desk ticket has been assigned to you.\n\n${form.title.trim()}\n\n${form.description.trim()}\n\nOpen it: https://prstech.app/helpdesk/tickets/${data.id}`,
        })
      }
    }

    router.push(`/helpdesk/tickets/${data.id}`)
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '720px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>New ticket</h1>
      <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 22px' }}>Log a request on behalf of a requester.</p>

      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '22px' }}>
        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Subject *</label>
          <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Short summary of the issue" />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Description *</label>
          <textarea style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', fontFamily: 'inherit' }}
            value={form.description} onChange={e => set('description', e.target.value)} placeholder="What's happening, steps tried, impact…" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Requester *</label>
            <select style={inputStyle} value={requesterValue} onChange={e => set('requester_id', e.target.value)}>
              <option value="">Select…</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Assignee</label>
            <select style={inputStyle} value={form.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
              <option value="">Unassigned</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '22px' }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={form.category} onChange={e => set('category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={form.priority} onChange={e => set('priority', e.target.value)}>
              {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Source</label>
            <select style={inputStyle} value={form.source} onChange={e => set('source', e.target.value)}>
              {SOURCE_OPTIONS.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={() => router.push('/helpdesk/tickets')} style={{
            padding: '10px 20px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
            backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
            backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </div>
    </div>
  )
}
