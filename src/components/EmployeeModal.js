'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

export default function EmployeeModal({ employee, onSave, onClose }) {
  const supabase = createClient()
  const isEditing = !!employee

  const [form, setForm] = useState({
    first_name: employee?.first_name || '',
    last_name: employee?.last_name || '',
    email: employee?.email || '',
    department: employee?.department || '',
    title: employee?.title || '',
    manager_id: employee?.manager_id || '',
    location_id: employee?.location_id || '',
    room_id: employee?.room_id || '',
    status: employee?.status || 'active',
    notes: employee?.notes || '',
  })
  const [managers, setManagers] = useState([])
  const [locations, setLocations] = useState([])
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOptions()
  }, [])

  async function loadOptions() {
    const [{ data: emps }, { data: locs }, { data: rms }] = await Promise.all([
      supabase.from('employees').select('id, full_name').order('full_name'),
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('rooms').select('id, name, location_id').order('name'),
    ])
    // Can't be your own manager
    if (emps) setManagers(emps.filter(m => m.id !== employee?.id))
    if (locs) setLocations(locs)
    if (rms) setRooms(rms)
  }

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Changing branch clears the room (rooms belong to a specific location)
  function setLocation(locId) {
    setForm(prev => ({ ...prev, location_id: locId, room_id: '' }))
  }

  const roomsForLocation = rooms.filter(r => r.location_id === form.location_id)

  async function handleSubmit() {
    if (!form.first_name.trim()) return alert('First name is required')
    setSaving(true)

    const first = form.first_name.trim()
    const last = form.last_name.trim()

    const record = {
      first_name: first,
      last_name: last || null,
      full_name: [first, last].filter(Boolean).join(' '),
      email: form.email.trim() || null,
      department: form.department.trim() || null,
      title: form.title.trim() || null,
      manager_id: form.manager_id || null,
      location_id: form.location_id || null,
      room_id: form.room_id || null,
      status: form.status,
      notes: form.notes.trim() || null,
    }

    let result
    if (isEditing) {
      result = await supabase.from('employees').update(record).eq('id', employee.id).select().single()
    } else {
      result = await supabase.from('employees').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving employee: ' + result.error.message)
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
          maxWidth: '520px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          {isEditing ? 'Edit Employee' : 'Add Employee'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>First Name *</label>
            <input style={inputStyle} value={form.first_name} onChange={(e) => set('first_name', e.target.value)} placeholder="Jane" />
          </div>
          <div>
            <label style={labelStyle}>Last Name</label>
            <input style={inputStyle} value={form.last_name} onChange={(e) => set('last_name', e.target.value)} placeholder="Smith" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={inputStyle} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="jane@prs.com" />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Department</label>
            <input style={inputStyle} value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. Operations" />
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input style={inputStyle} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Warehouse Manager" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Location / Branch</label>
            <select style={inputStyle} value={form.location_id} onChange={(e) => setLocation(e.target.value)}>
              <option value="">— None —</option>
              {locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {locations.length === 0 && (
              <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
                No locations yet — add branches on the Locations page.
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle}>Room</label>
            <select
              style={{ ...inputStyle, opacity: form.location_id ? 1 : 0.5 }}
              value={form.room_id}
              onChange={(e) => set('room_id', e.target.value)}
              disabled={!form.location_id}
            >
              <option value="">— None —</option>
              {roomsForLocation.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {form.location_id && roomsForLocation.length === 0 && (
              <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
                No rooms for this branch yet — add them on the location page.
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Manager</label>
          <select style={inputStyle} value={form.manager_id} onChange={(e) => set('manager_id', e.target.value)}>
            <option value="">— None —</option>
            {managers.map(m => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
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
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Employee')}
          </button>
        </div>
      </div>
    </div>
  )
}
