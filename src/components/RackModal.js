'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

// Add/edit a server rack. Racks live at a location and optionally a room; the
// u_height is the rack size in U (device power/height are summed elsewhere).
export default function RackModal({ rack, onSave, onClose }) {
  const supabase = createClient()
  const isEditing = !!rack

  const [form, setForm] = useState({
    name: rack?.name || '',
    location_id: rack?.location_id || '',
    room_id: rack?.room_id || '',
    u_height: rack?.u_height ?? 42,
    notes: rack?.notes || '',
  })
  const [locations, setLocations] = useState([])
  const [rooms, setRooms] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadOptions()
  }, [])

  async function loadOptions() {
    const [{ data: locs }, { data: rms }] = await Promise.all([
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('rooms').select('id, name, location_id').order('name'),
    ])
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
    if (!form.name.trim()) return alert('Rack name is required')
    const uHeight = Number(form.u_height)
    if (!uHeight || uHeight < 1 || uHeight > 60) return alert('U-height must be between 1 and 60')
    setSaving(true)

    const record = {
      name: form.name.trim(),
      location_id: form.location_id || null,
      room_id: form.room_id || null,
      u_height: uHeight,
      notes: form.notes.trim() || null,
    }

    let result
    if (isEditing) {
      result = await supabase.from('racks').update(record).eq('id', rack.id).select().single()
    } else {
      result = await supabase.from('racks').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving rack: ' + result.error.message)
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
        zIndex: 1050,
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
          {isEditing ? 'Edit Rack' : 'Add Rack'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Rack Name *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Server Room Rack A" />
          </div>
          <div>
            <label style={labelStyle}>Size (U)</label>
            <input style={inputStyle} type="number" value={form.u_height} onChange={(e) => set('u_height', e.target.value)} placeholder="42" />
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
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Rack')}
          </button>
        </div>
      </div>
    </div>
  )
}
