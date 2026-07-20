'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase'
import RackModal from '../../../components/RackModal'

export default function RacksPage() {
  const supabase = createClient()
  const router = useRouter()
  const [racks, setRacks] = useState([])
  const [stats, setStats] = useState({}) // rackId -> { devices, uUsed, watts }
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: rks }, { data: assets }] = await Promise.all([
      supabase.from('racks').select('*, location:locations(name), room:rooms(name)').order('name'),
      supabase.from('assets').select('rack_id, u_position, u_height, watts').not('rack_id', 'is', null),
    ])
    if (rks) setRacks(rks)
    if (assets) {
      const s = {}
      for (const a of assets) {
        if (!a.rack_id) continue
        const row = s[a.rack_id] || { devices: 0, uUsed: 0, watts: 0 }
        row.devices += 1
        // Only mounted devices (u_position set) consume U space
        if (a.u_position != null) row.uUsed += (a.u_height || 1)
        row.watts += (a.watts || 0)
        s[a.rack_id] = row
      }
      setStats(s)
    }
    setLoading(false)
  }

  function handleSaved() {
    setShowAddModal(false)
    loadData()
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', flexWrap: 'wrap', gap: '12px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          Racks
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '10px 22px',
            borderRadius: '10px', fontWeight: '600', fontSize: '13.5px', border: 'none', cursor: 'pointer',
          }}
        >
          + Add Rack
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>Loading racks...</div>
      ) : racks.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
          textAlign: 'center', padding: '48px', color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🗄️</div>
          <div style={{ fontSize: '14px' }}>No racks yet. Click "+ Add Rack" to get started.</div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 180px 90px 110px 110px',
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            <span>Rack</span>
            <span>Location</span>
            <span>Devices</span>
            <span>U Used</span>
            <span>Power</span>
          </div>

          {racks.map(rack => {
            const s = stats[rack.id] || { devices: 0, uUsed: 0, watts: 0 }
            const locText = rack.location?.name
              ? `${rack.location.name}${rack.room?.name ? ` · ${rack.room.name}` : ''}`
              : '—'
            return (
              <div
                key={rack.id}
                onClick={() => router.push(`/tracker/racks/${rack.id}`)}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 180px 90px 110px 110px',
                  padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28',
                  cursor: 'pointer', fontSize: '13.5px',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{rack.name}</div>
                <span style={{ color: '#6a7e94' }}>{locText}</span>
                <span style={{ color: '#8aa0b8' }}>{s.devices}</span>
                <span style={{ color: '#8aa0b8' }}>{s.uUsed} / {rack.u_height}U</span>
                <span style={{ color: '#8aa0b8' }}>{s.watts ? `${s.watts} W` : '—'}</span>
              </div>
            )
          })}
        </div>
      )}

      {showAddModal && (
        <RackModal
          rack={null}
          onSave={handleSaved}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
