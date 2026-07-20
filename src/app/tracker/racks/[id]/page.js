'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { statusColor } from '../../../../lib/tracker'
import RackModal from '../../../../components/RackModal'
import AssetModal from '../../../../components/AssetModal'
import PlaceDeviceModal from '../../../../components/PlaceDeviceModal'
import RackDeviceFace from '../../../../components/RackDeviceFace'

const ROW_PX = 30 // to-scale: pixels per rack unit (U)

export default function RackDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()

  const [rack, setRack] = useState(null)
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingRack, setEditingRack] = useState(false)
  const [editingDevice, setEditingDevice] = useState(null)
  const [placingAtU, setPlacingAtU] = useState(null) // U slot chosen to place into
  const [hoverDev, setHoverDev] = useState(null)      // device id hovered (shows unmount)
  const [hoverU, setHoverU] = useState(null)          // empty U slot hovered

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    const [{ data: rk }, { data: devs }] = await Promise.all([
      supabase.from('racks').select('*, location:locations(name), room:rooms(name)').eq('id', id).single(),
      supabase.from('assets').select('*').eq('rack_id', id).order('u_position', { ascending: false }),
    ])
    setRack(rk || null)
    setDevices(devs || [])
    setLoading(false)
  }

  function handleRackSaved() {
    setEditingRack(false)
    loadData()
  }
  function handleDeviceSaved() {
    setEditingDevice(null)
    loadData()
  }
  function handlePlaced() {
    setPlacingAtU(null)
    loadData()
  }

  // Take a mounted device off the rack grid (stays associated, u_position null)
  async function unmount(device) {
    await supabase.from('assets')
      .update({ u_position: null, updated_at: new Date().toISOString() })
      .eq('id', device.id)
    loadData()
  }

  const btnStyle = {
    padding: '8px 16px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
    cursor: 'pointer', border: '1px solid #1e2d40', backgroundColor: '#131a24', color: '#8aa0b8',
  }

  if (loading) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!rack) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ color: '#5a6e84' }}>Rack not found.</div>
        <button style={{ ...btnStyle, marginTop: '16px' }} onClick={() => router.push('/tracker/racks')}>
          ← Back to Racks
        </button>
      </div>
    )
  }

  const mounted = devices.filter(d => d.u_position != null)
  const offRack = devices.filter(d => d.u_position == null)

  const totalWatts = devices.reduce((sum, d) => sum + (d.watts || 0), 0)
  const uUsed = mounted.reduce((sum, d) => sum + (d.u_height || 1), 0)

  // Map each U to the device occupying it (for rendering the grid)
  const occupancy = {}
  for (const d of mounted) {
    const height = d.u_height || 1
    for (let u = d.u_position; u < d.u_position + height; u++) occupancy[u] = d
  }

  const locText = rack.location?.name
    ? `${rack.location.name}${rack.room?.name ? ` · ${rack.room.name}` : ''}`
    : 'No location set'

  const rackPx = rack.u_height * ROW_PX

  // Center column: stack device blocks + open slots top-down (highest U on top).
  const slots = []
  let u = rack.u_height
  while (u >= 1) {
    const dev = occupancy[u]
    const isDeviceTop = dev && u === dev.u_position + (dev.u_height || 1) - 1
    if (dev && isDeviceTop) {
      const height = dev.u_height || 1
      slots.push(
        <div
          key={`dev-${dev.id}`}
          onClick={() => setEditingDevice(dev)}
          onMouseEnter={() => setHoverDev(dev.id)}
          onMouseLeave={() => setHoverDev(null)}
          title={`${dev.name}${dev.asset_tag ? ` · ${dev.asset_tag}` : ''}${dev.watts ? ` · ${dev.watts}W` : ''} — click to edit`}
          style={{ position: 'relative', height: `${height * ROW_PX}px`, padding: '1px 2px', cursor: 'pointer' }}
        >
          <RackDeviceFace device={dev} showName={hoverDev === dev.id} />
          {hoverDev === dev.id && (
            <button
              onClick={(e) => { e.stopPropagation(); unmount(dev) }}
              title="Unmount (keep in rack, off-grid)"
              style={{
                position: 'absolute', right: '26px', top: '50%', transform: 'translateY(-50%)',
                padding: '2px 8px', borderRadius: '5px', fontSize: '10.5px', fontWeight: 600, cursor: 'pointer',
                backgroundColor: 'rgba(10,14,20,0.85)', color: '#c0cad8', border: '1px solid #2a333f',
              }}
            >
              Unmount
            </button>
          )}
        </div>
      )
      u -= height
    } else {
      const hovered = hoverU === u
      slots.push(
        <div
          key={`u-${u}`}
          onClick={() => setPlacingAtU(u)}
          onMouseEnter={() => setHoverU(u)}
          onMouseLeave={() => setHoverU(null)}
          title={`Place a device at U${u}`}
          style={{
            height: `${ROW_PX}px`, padding: '1px 2px', cursor: 'pointer',
          }}
        >
          <div style={{
            height: '100%', borderRadius: '2px',
            border: hovered ? '1px solid #2563eb' : '1px solid #14181e',
            background: hovered
              ? 'rgba(37,99,235,0.12)'
              : 'linear-gradient(180deg,#0c1015,#090c10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10.5px', color: hovered ? '#6ea8ff' : '#243244',
          }}>
            {hovered ? `＋ place at U${u}` : ''}
          </div>
        </div>
      )
      u -= 1
    }
  }

  // Left U-number gutter (one cell per U, highest on top)
  const uLabels = []
  for (let n = rack.u_height; n >= 1; n--) {
    uLabels.push(
      <div key={n} style={{
        height: `${ROW_PX}px`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        paddingRight: '6px', fontSize: '9px', color: '#4a5a6e', fontVariantNumeric: 'tabular-nums',
      }}>
        {n}
      </div>
    )
  }

  // A metal mounting rail with regularly-spaced holes
  const rail = (
    <div style={{
      width: '14px', height: `${rackPx}px`, borderRadius: '2px',
      background: `radial-gradient(circle, rgba(0,0,0,0.7) 1.4px, transparent 1.8px) 0 ${ROW_PX / 4}px / 100% ${ROW_PX / 2}px,
        linear-gradient(90deg,#1c222a,#333c47 45%,#252c35 55%,#1a1f26)`,
      border: '1px solid #0b0e12',
    }} />
  )

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <button onClick={() => router.push('/tracker/racks')} style={{ ...btnStyle, marginBottom: '18px' }}>
        ← Racks
      </button>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '20px', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>{rack.name}</h1>
          <div style={{ fontSize: '13px', color: '#5a6e84', marginTop: '6px' }}>{locText}</div>
          {rack.notes && (
            <div style={{ fontSize: '13px', color: '#6a7e94', marginTop: '8px', lineHeight: '1.6' }}>{rack.notes}</div>
          )}
        </div>
        <button style={btnStyle} onClick={() => setEditingRack(true)}>Edit Rack</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '22px', flexWrap: 'wrap' }}>
        {[
          ['Devices', devices.length],
          ['U Used', `${uUsed} / ${rack.u_height}U`],
          ['Total Power', totalWatts ? `${totalWatts} W` : '—'],
        ].map(([label, value]) => (
          <div key={label} style={{
            flex: '1 1 140px', backgroundColor: '#0f1620', border: '1px solid #182030',
            borderRadius: '12px', padding: '14px 16px',
          }}>
            <div style={{ fontSize: '11px', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#c0cad8' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Rack enclosure */}
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
            Rack Layout <span style={{ color: '#3a4a5e', textTransform: 'none', letterSpacing: 0 }}>· click a device to edit, an empty slot to place</span>
          </div>

          <div style={{
            width: '420px', maxWidth: '100%',
            background: 'linear-gradient(180deg,#2b3038,#1b1f25)',
            border: '1px solid #0b0e12', borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)', overflow: 'hidden',
          }}>
            {/* Title bar */}
            <div style={{
              padding: '9px 12px', textAlign: 'center', fontSize: '12px', fontWeight: 700,
              letterSpacing: '1px', textTransform: 'uppercase', color: '#c3cdd9',
              background: 'linear-gradient(180deg,#333a44,#232830)', borderBottom: '1px solid #0b0e12',
            }}>
              {rack.name} · {rack.u_height}U
            </div>

            {/* Interior: U gutter + rail + slots + rail */}
            <div style={{ display: 'flex', alignItems: 'flex-start', padding: '10px', gap: '4px', backgroundColor: '#0a0d11' }}>
              <div style={{ width: '26px', height: `${rackPx}px` }}>{uLabels}</div>
              {rail}
              <div style={{ flex: 1, height: `${rackPx}px` }}>{slots}</div>
              {rail}
            </div>
          </div>
        </div>

        {/* Off-rack section */}
        <div style={{ flex: '1 1 240px', minWidth: '240px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
            Off-rack (in room) <span style={{ color: '#3a4a5e' }}>· {offRack.length}</span>
          </div>
          {offRack.length === 0 ? (
            <div style={{
              backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px',
              padding: '20px', fontSize: '12.5px', color: '#3a4a5e', textAlign: 'center',
            }}>
              Nothing off-rack. Devices assigned to this rack without a U position show here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {offRack.map(d => {
                const sc = statusColor(d.status)
                return (
                  <div
                    key={d.id}
                    onClick={() => setEditingDevice(d)}
                    title="Click to edit / mount"
                    style={{
                      backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '10px',
                      padding: '10px 12px', cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#0f1620'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#d0d8e4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                        <div style={{ fontSize: '11px', color: '#5a6e84' }}>{d.type}{d.watts ? ` · ${d.watts}W` : ''}</div>
                      </div>
                      <span style={{
                        flexShrink: 0, display: 'inline-flex', padding: '3px 10px', borderRadius: '100px',
                        fontSize: '10.5px', fontWeight: '600',
                        backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
                      }}>
                        {d.status}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {editingRack && (
        <RackModal rack={rack} onSave={handleRackSaved} onClose={() => setEditingRack(false)} />
      )}
      {editingDevice && (
        <AssetModal asset={editingDevice} onSave={handleDeviceSaved} onClose={() => setEditingDevice(null)} />
      )}
      {placingAtU != null && (
        <PlaceDeviceModal
          rack={rack}
          mounted={mounted}
          defaultU={placingAtU}
          onSave={handlePlaced}
          onClose={() => setPlacingAtU(null)}
        />
      )}
    </div>
  )
}
