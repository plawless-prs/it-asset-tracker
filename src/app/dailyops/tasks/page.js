'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { useRole } from '../../../lib/useRole'
import { PRIORITY_META, PRIORITY_ORDER } from '../../../lib/helpdesk'
import { TASK_STATUS_META, personLabel } from '../../../lib/dailyops'
import { todayCentral, formatDate } from '../../../lib/priceupdates'

// One-off tasks that "appear" outside the recurring SOPs: create, assign,
// due date + priority, work them todo -> in progress -> done.
const OPEN_STATUSES = ['todo', 'in_progress']

export default function DailyOpsTasks() {
  const supabase = createClient()
  const { user } = useRole()
  const [tasks, setTasks] = useState(null)
  const [people, setPeople] = useState([])
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load(includeDone = showDone) {
    let q = supabase.from('tasks')
      .select('id, title, description, status, priority, assigned_to, due_date, created_at, completed_at, assignee:assigned_to(id, full_name, email), creator:created_by(full_name, email)')
      .order('created_at', { ascending: false })
    if (!includeDone) q = q.in('status', OPEN_STATUSES)
    const { data, error: e } = await q
    if (e) setError(e.message)
    setTasks(data || [])
  }

  useEffect(() => {
    load()
    supabase.from('profiles').select('id, full_name, email').order('full_name')
      .then(({ data }) => setPeople(data || []))
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(showDone) }, [showDone])   // eslint-disable-line react-hooks/exhaustive-deps

  async function createTask() {
    if (!form.title.trim()) { setError('Title is required.'); return }
    setSaving(true); setError('')
    const { error: e } = await supabase.from('tasks').insert({
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      assigned_to: form.assigned_to || null,
      due_date: form.due_date || null,
      created_by: user?.id,
    })
    setSaving(false)
    if (e) { setError(e.message); return }
    setForm({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '' })
    setCreating(false)
    load()
  }

  async function setStatus(t, status) {
    const patch = { status, completed_at: status === 'done' ? new Date().toISOString() : null }
    const { error: e } = await supabase.from('tasks').update(patch).eq('id', t.id)
    if (e) { setError(e.message); return }
    load()
  }

  const today = todayCentral()
  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px' }
  const inputStyle = {
    width: '100%', padding: '9px 12px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
    borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontSize: '11px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }
  const miniBtn = (bg, color) => ({
    padding: '4px 10px', borderRadius: '7px', fontSize: '11.5px', fontWeight: '600',
    backgroundColor: bg, color, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: '880px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Tasks</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>One-off work outside the recurring checklists.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#8aa0b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ accentColor: '#2563eb' }} />
            Show finished
          </label>
          <button onClick={() => setCreating(v => !v)} style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '9px 16px', borderRadius: '10px',
            fontWeight: '600', fontSize: '13px', border: 'none', cursor: 'pointer',
          }}>+ New task</button>
        </div>
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

      {creating && (
        <div style={{ ...card, padding: '16px 18px', marginBottom: '14px' }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus placeholder="e.g. Replace UPS battery in rack 2" />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>Details</label>
            <textarea style={{ ...inputStyle, height: '56px', resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <div style={{ minWidth: '130px' }}>
              <label style={labelStyle}>Priority</label>
              <select style={inputStyle} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
            <div style={{ minWidth: '180px' }}>
              <label style={labelStyle}>Assign to</label>
              <select style={inputStyle} value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                <option value="">Unassigned</option>
                {people.map(p => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
              </select>
            </div>
            <div style={{ minWidth: '150px' }}>
              <label style={labelStyle}>Due date</label>
              <input type="date" style={{ ...inputStyle, colorScheme: 'dark' }} value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => setCreating(false)} disabled={saving} style={{ ...miniBtn('#131a24', '#8aa0b8'), padding: '8px 16px', border: '1px solid #1e2d40' }}>Cancel</button>
            <button onClick={createTask} disabled={saving} style={{ ...miniBtn('#2563eb', '#fff'), padding: '8px 16px' }}>{saving ? 'Saving…' : 'Create task'}</button>
          </div>
        </div>
      )}

      {tasks === null ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px', color: '#4a5a6e', fontSize: '13px' }}>
          {showDone ? 'No tasks yet.' : 'No open tasks — nice.'}
        </div>
      ) : (
        <div style={{ ...card, overflow: 'hidden' }}>
          {tasks.map(t => {
            const pm = PRIORITY_META[t.priority] || PRIORITY_META.medium
            const sm = TASK_STATUS_META[t.status] || TASK_STATUS_META.todo
            const overdue = t.due_date && OPEN_STATUSES.includes(t.status) && t.due_date < today
            return (
              <div key={t.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 16px', borderBottom: '1px solid #131c28', flexWrap: 'wrap' }}>
                <span title={pm.label} style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: pm.dot, marginTop: '6px', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '13.5px', fontWeight: '600', color: t.status === 'done' ? '#5a6e84' : '#d0d8e4', textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                  {t.description && <div style={{ fontSize: '12px', color: '#5a6e84', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{t.description}</div>}
                  <div style={{ fontSize: '11.5px', color: '#4a5a6e', marginTop: '4px' }}>
                    {t.assignee ? personLabel(t.assignee) : 'Unassigned'}
                    {t.due_date && <span style={{ color: overdue ? '#f87171' : '#4a5a6e' }}> · due {formatDate(t.due_date)}{overdue ? ' (overdue)' : ''}</span>}
                    {t.completed_at && <span> · finished {formatDate(t.completed_at)}</span>}
                  </div>
                </div>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: sm.pillBg, color: sm.pillText, marginTop: '3px' }}>{sm.label}</span>
                <div style={{ display: 'flex', gap: '6px', marginTop: '1px' }}>
                  {t.status === 'todo' && <button onClick={() => setStatus(t, 'in_progress')} style={miniBtn('#332300', '#fbbf24')}>Start</button>}
                  {OPEN_STATUSES.includes(t.status) && <button onClick={() => setStatus(t, 'done')} style={miniBtn('#0d3320', '#4ade80')}>Done</button>}
                  {t.status === 'done' && <button onClick={() => setStatus(t, 'todo')} style={miniBtn('#131a24', '#8aa0b8')}>Reopen</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
