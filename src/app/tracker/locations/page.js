'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import LocationModal from '../../../components/LocationModal'

export default function LocationsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [locations, setLocations] = useState([])
  const [counts, setCounts] = useState({ rooms: {}, employees: {}, assets: {} })
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: locs }, { data: rooms }, { data: emps }, { data: assets }] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('rooms').select('location_id'),
      supabase.from('employees').select('location_id'),
      supabase.from('assets').select('location_id'),
    ])
    if (locs) setLocations(locs)
    const tally = (rows) => {
      const m = {}
      for (const r of rows || []) if (r.location_id) m[r.location_id] = (m[r.location_id] || 0) + 1
      return m
    }
    setCounts({ rooms: tally(rooms), employees: tally(emps), assets: tally(assets) })
    setLoading(false)
  }

  function handleSaved(loc, isNew) {
    setShowAddModal(false)
    if (isNew && loc?.id) {
      router.push(`/tracker/locations/${loc.id}`)   // jump in to add its rooms
    } else {
      loadData()
    }
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', flexWrap: 'wrap', gap: '12px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          Locations
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '10px 22px',
            borderRadius: '10px', fontWeight: '600', fontSize: '13.5px', border: 'none', cursor: 'pointer',
          }}
        >
          + Add Location
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>Loading locations...</div>
      ) : locations.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
          textAlign: 'center', padding: '48px', color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>📍</div>
          <div style={{ fontSize: '14px' }}>No locations yet. Click "+ Add Location" to add your branches.</div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 90px 110px 90px',
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            <span>Location</span>
            <span>Rooms</span>
            <span>Employees</span>
            <span>Assets</span>
          </div>

          {locations.map(loc => (
            <div
              key={loc.id}
              onClick={() => router.push(`/tracker/locations/${loc.id}`)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 90px 110px 90px',
                padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28',
                cursor: 'pointer', fontSize: '13.5px',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <div>
                <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{loc.name}</div>
                <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>{loc.address || '—'}</div>
              </div>
              <span style={{ color: '#8aa0b8' }}>{counts.rooms[loc.id] || 0}</span>
              <span style={{ color: '#8aa0b8' }}>{counts.employees[loc.id] || 0}</span>
              <span style={{ color: '#8aa0b8' }}>{counts.assets[loc.id] || 0}</span>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <LocationModal
          location={null}
          onSave={handleSaved}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
