'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { rackPlacementError } from '../lib/tracker'

// Mount a rackable device into `rack` at a chosen U position. Candidates are
// rackable assets not currently mounted anywhere (u_position null) — this
// includes gear already assigned to this rack but sitting "off-rack", and any
// unmounted rackable asset. `mounted` is the list of already-placed devices in
// this rack ({ id, u_position, u_height }) used for overlap validation.
export default function PlaceDeviceModal({ rack, mounted, defaultU, excludeId, onSave, onClose }) {
  const supabase = createClient()

  const [candidates, setCandidates] = useState([])
  const [assetId, setAssetId] = useState('')
  const [uPosition, setUPosition] = useState(defaultU || 1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('assets')
      .select('id, name, type, u_height, asset_tag, rack_id, rack_mountable')
      .is('u_position', null)
      .order('name')
      .then(({ data }) => {
        if (!data) return
        // Only rack-mountable devices, and don't offer the device we're relocating
        setCandidates(data.filter(a => a.rack_mountable && a.id !== excludeId))
      })
  }, [])

  const selected = candidates.find(a => a.id === assetId)
  const uHeight = selected?.u_height || 1

  function validate(startU, height) {
    return rackPlacementError({
      uStart: startU,
      uHeight: height,
      rackHeight: rack.u_height,
      occupied: mounted,
      excludeId,
    })
  }

  async function handleSubmit() {
    if (!assetId) return setError('Choose a device to place.')
    const msg = validate(uPosition, uHeight)
    if (msg) return setError(msg)
    setSaving(true)

    const { data, error: err } = await supabase
      .from('assets')
      .update({ rack_id: rack.id, u_position: Number(uPosition), updated_at: new Date().toISOString() })
      .eq('id', assetId)
      .select()
      .single()

    if (err) {
      setError('Error placing device: ' + err.message)
      setSaving(false)
      return
    }
    onSave(data)
    setSaving(false)
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', backgroundColor: '#131a24',
    border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8',
    fontSize: '13.5px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
    textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
  }

  const liveError = error || (assetId ? validate(uPosition, uHeight) : '')

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px',
          padding: '28px', maxWidth: '460px', width: '100%',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '6px' }}>
          Place Device
        </h2>
        <div style={{ fontSize: '12.5px', color: '#5a6e84', marginBottom: '20px' }}>
          Mount a rackable device into {rack.name}.
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Device</label>
          <select style={inputStyle} value={assetId} onChange={(e) => { setAssetId(e.target.value); setError('') }}>
            <option value="">— Select a device —</option>
            {candidates.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.type} ({a.u_height || 1}U){a.asset_tag ? ` · ${a.asset_tag}` : ''}
              </option>
            ))}
          </select>
          {candidates.length === 0 && (
            <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
              No unmounted rackable devices. Add a rackable asset (Server/Switch/…) first, or check one in.
            </div>
          )}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={labelStyle}>Bottom U Position</label>
          <input
            style={inputStyle}
            type="number"
            min={1}
            max={rack.u_height}
            value={uPosition}
            onChange={(e) => { setUPosition(e.target.value); setError('') }}
          />
          {selected && (
            <div style={{ fontSize: '11px', color: '#3a4a5e', marginTop: '4px' }}>
              Occupies U{uPosition}{uHeight > 1 ? `–U${Number(uPosition) + uHeight - 1}` : ''} of {rack.u_height}U.
            </div>
          )}
        </div>

        {liveError && (
          <div style={{ fontSize: '12px', color: '#f87171', marginBottom: '16px' }}>
            {liveError}
          </div>
        )}

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
            disabled={saving || !assetId || !!liveError}
            style={{
              padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
              backgroundColor: (saving || !assetId || !!liveError) ? '#1e3a5f' : '#2563eb',
              color: '#fff', border: 'none',
              cursor: (saving || !assetId || !!liveError) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Placing...' : 'Place Device'}
          </button>
        </div>
      </div>
    </div>
  )
}
