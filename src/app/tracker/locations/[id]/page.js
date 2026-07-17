'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import LocationModal from '../../../../components/LocationModal'
import RoomModal from '../../../../components/RoomModal'

export default function LocationDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()

  const [location, setLocation] = useState(null)
  const [rooms, setRooms] = useState([])
  const [roomCounts, setRoomCounts] = useState({ employees: {}, assets: {} })
  const [loading, setLoading] = useState(true)
  const [editingLocation, setEditingLocation] = useState(false)
  const [showAddRoom, setShowAddRoom] = useState(false)
  const [editingRoom, setEditingRoom] = useState(null)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    const [{ data: loc }, { data: rms }, { data: emps }, { data: assets }] = await Promise.all([
      supabase.from('locations').select('*').eq('id', id).single(),
      supabase.from('rooms').select('*').eq('location_id', id).order('name'),
      supabase.from('employees').select('room_id').eq('location_id', id),
      supabase.from('assets').select('room_id').eq('location_id', id),
    ])
    setLocation(loc || null)
    setRooms(rms || [])
    const tally = (rows) => {
      const m = {}
      for (const r of rows || []) if (r.room_id) m[r.room_id] = (m[r.room_id] || 0) + 1
      return m
    }
    setRoomCounts({ employees: tally(emps), assets: tally(assets) })
    setLoading(false)
  }

  async function handleDeleteRoom(room) {
    const inUse = (roomCounts.employees[room.id] || 0) + (roomCounts.assets[room.id] || 0)
    const msg = inUse > 0
      ? `Delete "${room.name}"? ${inUse} employee/asset record(s) will keep this location but lose the room.`
      : `Delete "${room.name}"?`
    if (!window.confirm(msg)) return
    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    if (error) alert('Error deleting room: ' + error.message)
    loadData()
  }

  function handleLocationSaved() {
    setEditingLocation(false)
    loadData()
  }

  function handleRoomSaved() {
    setShowAddRoom(false)
    setEditingRoom(null)
    loadData()
  }

  const btnStyle = {
    padding: '8px 16px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
    cursor: 'pointer', border: '1px solid #1e2d40', backgroundColor: '#131a24', color: '#8aa0b8',
  }

  if (loading) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!location) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ color: '#5a6e84' }}>Location not found.</div>
        <button style={{ ...btnStyle, marginTop: '16px' }} onClick={() => router.push('/tracker/locations')}>
          ← Back to Locations
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <button
        onClick={() => router.push('/tracker/locations')}
        style={{ ...btnStyle, marginBottom: '18px' }}
      >
        ← Locations
      </button>

      {/* Location header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '24px', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
            {location.name}
          </h1>
          <div style={{ fontSize: '13px', color: '#5a6e84', marginTop: '6px' }}>
            {location.address || 'No address on file'}
          </div>
          {location.notes && (
            <div style={{ fontSize: '13px', color: '#6a7e94', marginTop: '8px', lineHeight: '1.6' }}>
              {location.notes}
            </div>
          )}
        </div>
        <button style={btnStyle} onClick={() => setEditingLocation(true)}>Edit Location</button>
      </div>

      {/* Rooms section */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px',
      }}>
        <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#c0cad8', margin: 0 }}>
          Rooms
        </h2>
        <button
          onClick={() => setShowAddRoom(true)}
          style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '8px 18px',
            borderRadius: '8px', fontWeight: '600', fontSize: '12.5px', border: 'none', cursor: 'pointer',
          }}
        >
          + Add Room
        </button>
      </div>

      {rooms.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
          textAlign: 'center', padding: '40px', color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '30px', marginBottom: '10px' }}>🚪</div>
          <div style={{ fontSize: '13.5px' }}>No rooms yet. Add the rooms in this branch (e.g. IT Department, Inside Sales Office).</div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 90px 120px',
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            <span>Room</span>
            <span>Employees</span>
            <span>Assets</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {rooms.map(room => (
            <div
              key={room.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 90px 120px',
                padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28', fontSize: '13.5px',
              }}
            >
              <div>
                <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{room.name}</div>
                {room.notes && <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>{room.notes}</div>}
              </div>
              <span style={{ color: '#8aa0b8' }}>{roomCounts.employees[room.id] || 0}</span>
              <span style={{ color: '#8aa0b8' }}>{roomCounts.assets[room.id] || 0}</span>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setEditingRoom(room)}
                  style={{ ...btnStyle, padding: '5px 12px', fontSize: '12px' }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteRoom(room)}
                  style={{ ...btnStyle, padding: '5px 12px', fontSize: '12px', color: '#f87171', borderColor: '#3a1a1a' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingLocation && (
        <LocationModal
          location={location}
          onSave={handleLocationSaved}
          onClose={() => setEditingLocation(false)}
        />
      )}

      {(showAddRoom || editingRoom) && (
        <RoomModal
          room={editingRoom}
          locationId={location.id}
          onSave={handleRoomSaved}
          onClose={() => { setShowAddRoom(false); setEditingRoom(null) }}
        />
      )}
    </div>
  )
}
