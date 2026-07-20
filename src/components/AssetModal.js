'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '../lib/supabase'
import { ASSET_CATEGORIES, ASSET_STATUSES, ASSET_TYPES, isComputerType, isRackableType, rackPlacementError } from '../lib/tracker'

export default function AssetModal({ asset, defaults, onSave, onClose }) {
  const supabase = createClient()
  const fileRef = useRef(null)
  const isEditing = !!asset

  // For a new asset, `defaults` can seed the form (e.g. reconciling an audit's
  // unexpected device: prefill name + rack + U position). When editing, the
  // asset itself is the source.
  const init = asset || defaults || {}

  const [form, setForm] = useState({
    name: init.name || '',
    category: init.category || 'Hardware',
    type: init.type || '',
    serial_number: init.serial_number || '',
    make: init.make || '',
    model: init.model || '',
    status: init.status || 'Ready to Deploy',
    purchase_cost: init.purchase_cost || '',
    purchase_date: init.purchase_date || '',
    warranty_expiry: init.warranty_expiry || '',
    useful_life_months: init.useful_life_months || '60',
    assigned_employee_id: init.assigned_employee_id || '',
    location_id: init.location_id || '',
    room_id: init.room_id || '',
    // Computer/server detail fields
    hostname: init.hostname || '',
    ip_address: init.ip_address || '',
    os: init.os || '',
    cpu: init.cpu || '',
    ram: init.ram || '',
    storage: init.storage || '',
    // Other-device detail field
    management_url: init.management_url || '',
    // Rack-mountability is an explicit per-asset choice (not inferred from type)
    rack_mountable: init.rack_mountable ?? false,
    rack_id: init.rack_id || '',
    watts: init.watts ?? '',
    u_height: init.u_height ?? '',
    u_position: init.u_position ?? '',
    notes: init.notes || '',
    photo_url: init.photo_url || '',
  })

  const isComputer = isComputerType(form.type)

  const [photoPreview, setPhotoPreview] = useState(asset?.photo_url || '')
  const [photoFile, setPhotoFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState([])
  const [locations, setLocations] = useState([])
  const [rooms, setRooms] = useState([])
  const [racks, setRacks] = useState([])

  // Legacy free-text values shown as hints when a row predates the FK.
  const legacyAssignedTo = !asset?.assigned_employee_id ? asset?.assigned_to : null
  const legacyLocation = !asset?.location_id ? asset?.location : null

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, full_name, department')
      .eq('status', 'active')
      .order('full_name')
      .then(({ data }) => { if (data) setEmployees(data) })
    supabase
      .from('locations')
      .select('id, name')
      .order('name')
      .then(({ data }) => { if (data) setLocations(data) })
    supabase
      .from('rooms')
      .select('id, name, location_id')
      .order('name')
      .then(({ data }) => { if (data) setRooms(data) })
    supabase
      .from('racks')
      .select('id, name, u_height')
      .order('name')
      .then(({ data }) => { if (data) setRacks(data) })
  }, [])

  // Clearing the rack also clears the U position (can't be mounted with no rack)
  function setRack(rackId) {
    setForm(prev => ({ ...prev, rack_id: rackId, u_position: rackId ? prev.u_position : '' }))
  }

  // Picking a type suggests a rack-mountable default for a NEW asset (Server →
  // checked, Monitor → unchecked); on edits we leave the user's choice alone.
  function setType(t) {
    setForm(prev => {
      const rackMountable = isEditing ? prev.rack_mountable : isRackableType(t)
      return {
        ...prev,
        type: t,
        rack_mountable: rackMountable,
        // Rack-mountable gear isn't assigned to a person — drop any assignment.
        assigned_employee_id: rackMountable ? '' : prev.assigned_employee_id,
      }
    })
  }

  // Rack-mountable devices are infrastructure, not assigned to a person; toggling
  // it on clears (and disables) the assignee.
  function setRackMountable(checked) {
    setForm(prev => ({
      ...prev,
      rack_mountable: checked,
      assigned_employee_id: checked ? '' : prev.assigned_employee_id,
    }))
  }

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Changing branch clears the room (rooms belong to a specific location)
  function setLocation(locId) {
    setForm(prev => ({ ...prev, location_id: locId, room_id: '' }))
  }

  const roomsForLocation = rooms.filter(r => r.location_id === form.location_id)

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    // Show a preview immediately
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handleSubmit() {
    if (!form.name.trim()) return alert('Asset name is required')
    setSaving(true)

    // Rack fit / overlap safeguard: a rack-mountable device placed at a U
    // position must fit the rack and not collide with another device there.
    if (form.rack_mountable && form.rack_id && form.u_position !== '' && form.u_position != null) {
      const rackObj = racks.find(r => r.id === form.rack_id)
      const { data: occupied } = await supabase
        .from('assets')
        .select('id, name, u_position, u_height')
        .eq('rack_id', form.rack_id)
        .not('u_position', 'is', null)
      const placementError = rackPlacementError({
        uStart: form.u_position,
        uHeight: form.u_height || 1,
        rackHeight: rackObj?.u_height,
        occupied: occupied || [],
        excludeId: asset?.id,
      })
      if (placementError) {
        alert(placementError)
        setSaving(false)
        return
      }
    }

    let photoUrl = form.photo_url

    // Upload photo if a new one was selected
    if (photoFile) {
      const fileExt = photoFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('it-asset-photos')
        .upload(fileName, photoFile)

      if (uploadError) {
        alert('Photo upload failed: ' + uploadError.message)
        setSaving(false)
        return
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from('it-asset-photos')
        .getPublicUrl(fileName)

      photoUrl = urlData.publicUrl
    }

    // Only persist detail fields that apply to the chosen type, so a row that
    // changes type doesn't keep stale values (e.g. a Server's hostname left
    // behind after it's reclassified as a Monitor).
    const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))

    const record = {
      name: form.name.trim(),
      category: form.category,
      type: form.type || null,
      serial_number: form.serial_number.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      status: form.status,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
      purchase_date: form.purchase_date || null,
      warranty_expiry: form.warranty_expiry || null,
      useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : 60,
      // Rack-mountable gear is infrastructure — never assigned to a person.
      assigned_employee_id: form.rack_mountable ? null : (form.assigned_employee_id || null),
      // Cached assignee name for list display / search; cleared when unassigned.
      assigned_to: (!form.rack_mountable && form.assigned_employee_id)
        ? (employees.find(e => e.id === form.assigned_employee_id)?.full_name || null)
        : null,
      location_id: form.location_id || null,
      room_id: form.room_id || null,
      // Computer/server fields — kept only for computer types
      hostname:   isComputer ? (form.hostname.trim() || null) : null,
      ip_address: isComputer ? (form.ip_address.trim() || null) : null,
      os:         isComputer ? (form.os.trim() || null) : null,
      cpu:        isComputer ? (form.cpu.trim() || null) : null,
      ram:        isComputer ? (form.ram.trim() || null) : null,
      storage:    isComputer ? (form.storage.trim() || null) : null,
      // Management URL — other (non-computer) devices only
      management_url: (form.type && !isComputer) ? (form.management_url.trim() || null) : null,
      // Rack / power fields — only when the asset is flagged rack-mountable.
      // u_position requires a rack (rack set + u_position null = "off-rack, in the room").
      rack_mountable: form.rack_mountable,
      rack_id:    form.rack_mountable ? (form.rack_id || null) : null,
      watts:      form.rack_mountable ? num(form.watts) : null,
      u_height:   form.rack_mountable ? num(form.u_height) : null,
      u_position: (form.rack_mountable && form.rack_id) ? num(form.u_position) : null,
      notes: form.notes.trim() || null,
      photo_url: photoUrl || null,
      updated_at: new Date().toISOString(),
    }

    let result
    if (isEditing) {
      result = await supabase.from('assets').update(record).eq('id', asset.id).select().single()
    } else {
      result = await supabase.from('assets').insert(record).select().single()
    }

    if (result.error) {
      alert('Error saving asset: ' + result.error.message)
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
          maxWidth: '560px',
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          {isEditing ? 'Edit Asset' : 'Add New Asset'}
        </h2>

        {/* Photo Upload */}
        <div style={{ marginBottom: '18px' }}>
          <label style={labelStyle}>Asset Photo</label>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: photoPreview ? '1px solid #1e2d40' : '2px dashed #1e2d40',
              borderRadius: '12px',
              padding: photoPreview ? '0' : '24px',
              textAlign: 'center',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            {photoPreview ? (
              <div style={{ position: 'relative' }}>
                <img
                  src={photoPreview}
                  alt="Asset preview"
                  style={{
                    width: '100%',
                    height: '180px',
                    objectFit: 'cover',
                    display: 'block',
                    borderRadius: '10px',
                  }}
                />
                <div style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  padding: '4px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#8aa0b8',
                }}>
                  Click to change
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '28px', color: '#2a3a4e', marginBottom: '6px' }}>
                  📷
                </div>
                <div style={{ fontSize: '13px', color: '#4a5a6e' }}>
                  Click to upload a photo of this asset
                </div>
                <div style={{ fontSize: '11px', color: '#3a4a5e', marginTop: '4px' }}>
                  JPG, PNG up to 5MB
                </div>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePhotoSelect}
          />
        </div>

        {/* Form Fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Asset Name *</label>
            <input style={inputStyle} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. MacBook Pro 16″" />
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={inputStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {ASSET_CATEGORIES.map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Type</label>
            <select style={inputStyle} value={form.type} onChange={(e) => setType(e.target.value)}>
              <option value="">— Select type —</option>
              {ASSET_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.value}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {ASSET_STATUSES.map(s => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>{isComputer ? 'Brand' : 'Make'}</label>
            <input style={inputStyle} value={form.make} onChange={(e) => set('make', e.target.value)} placeholder="e.g. Dell" />
          </div>
          <div>
            <label style={labelStyle}>Model</label>
            <input style={inputStyle} value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. A2141" />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Serial Number</label>
          <input style={inputStyle} value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder="SN-XXXX-XXXX" />
        </div>

        {/* Computer / server detail fields */}
        {isComputer && (
          <div style={{
            border: '1px solid #182030', borderRadius: '12px', padding: '16px',
            marginBottom: '14px', backgroundColor: '#0c1118',
          }}>
            <div style={{ ...labelStyle, color: '#6a7e94', marginBottom: '12px' }}>Computer Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={labelStyle}>Hostname</label>
                <input style={inputStyle} value={form.hostname} onChange={(e) => set('hostname', e.target.value)} placeholder="e.g. PRS-SRV01" />
              </div>
              <div>
                <label style={labelStyle}>IP Address</label>
                <input style={inputStyle} value={form.ip_address} onChange={(e) => set('ip_address', e.target.value)} placeholder="e.g. 10.0.0.20" />
              </div>
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Operating System</label>
              <input style={inputStyle} value={form.os} onChange={(e) => set('os', e.target.value)} placeholder="e.g. Windows Server 2022" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>CPU</label>
                <input style={inputStyle} value={form.cpu} onChange={(e) => set('cpu', e.target.value)} placeholder="e.g. Xeon E-2288G" />
              </div>
              <div>
                <label style={labelStyle}>RAM</label>
                <input style={inputStyle} value={form.ram} onChange={(e) => set('ram', e.target.value)} placeholder="e.g. 64 GB" />
              </div>
              <div>
                <label style={labelStyle}>Storage</label>
                <input style={inputStyle} value={form.storage} onChange={(e) => set('storage', e.target.value)} placeholder="e.g. 2×1TB SSD" />
              </div>
            </div>
          </div>
        )}

        {/* Management URL — other (non-computer) devices */}
        {form.type && !isComputer && (
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Management URL</label>
            <input style={inputStyle} value={form.management_url} onChange={(e) => set('management_url', e.target.value)} placeholder="https://…" />
          </div>
        )}

        {/* Rack-mountable toggle — independent of type, so any device (incl. "Other") can be racked */}
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
            marginBottom: '14px', padding: '10px 14px', borderRadius: '8px',
            border: '1px solid #1e2d40', backgroundColor: '#0c1118',
          }}
        >
          <input
            type="checkbox"
            checked={form.rack_mountable}
            onChange={(e) => setRackMountable(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#2563eb', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '13px', color: '#c0cad8', fontWeight: '500' }}>
            Rack-mountable device
          </span>
        </label>

        {/* Rack / power fields — shown when the asset is flagged rack-mountable */}
        {form.rack_mountable && (
          <div style={{
            border: '1px solid #182030', borderRadius: '12px', padding: '16px',
            marginBottom: '14px', backgroundColor: '#0c1118',
          }}>
            <div style={{ ...labelStyle, color: '#6a7e94', marginBottom: '12px' }}>Rack / Power</div>
            <div style={{ marginBottom: '14px' }}>
              <label style={labelStyle}>Rack</label>
              <select style={inputStyle} value={form.rack_id} onChange={(e) => setRack(e.target.value)}>
                <option value="">— Not in a rack —</option>
                {racks.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Power (W)</label>
                <input style={inputStyle} type="number" value={form.watts} onChange={(e) => set('watts', e.target.value)} placeholder="e.g. 450" />
              </div>
              <div>
                <label style={labelStyle}>U-Height</label>
                <input style={inputStyle} type="number" value={form.u_height} onChange={(e) => set('u_height', e.target.value)} placeholder="e.g. 2" />
              </div>
              <div>
                <label style={labelStyle}>Rack Position (U)</label>
                <input
                  style={{ ...inputStyle, opacity: form.rack_id ? 1 : 0.5 }}
                  type="number"
                  value={form.u_position}
                  onChange={(e) => set('u_position', e.target.value)}
                  disabled={!form.rack_id}
                  placeholder="e.g. 12"
                />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#3a4a5e', marginTop: '8px' }}>
              With a rack selected, leave Rack Position blank for gear that's in the room but not physically mounted.
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Purchase Cost ($)</label>
            <input style={inputStyle} type="number" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={labelStyle}>Purchase Date</label>
            <input style={inputStyle} type="date" value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Warranty Expiry</label>
            <input style={inputStyle} type="date" value={form.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Useful Life (months)</label>
            <input style={inputStyle} type="number" value={form.useful_life_months} onChange={(e) => set('useful_life_months', e.target.value)} placeholder="60" />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Assigned To</label>
          <select
            style={{ ...inputStyle, opacity: form.rack_mountable ? 0.45 : 1, cursor: form.rack_mountable ? 'not-allowed' : 'pointer' }}
            value={form.assigned_employee_id}
            onChange={(e) => set('assigned_employee_id', e.target.value)}
            disabled={form.rack_mountable}
          >
            <option value="">— Unassigned —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name}{e.department ? ` · ${e.department}` : ''}
              </option>
            ))}
          </select>
          {form.rack_mountable ? (
            <div style={{ fontSize: '11px', color: '#5a6e84', marginTop: '4px' }}>
              Rack-mountable devices are infrastructure and aren't assigned to a person.
            </div>
          ) : legacyAssignedTo && (
            <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
              Was: {legacyAssignedTo} — pick the matching employee to migrate.
            </div>
          )}
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
            {legacyLocation && (
              <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
                Was: {legacyLocation} — pick the matching branch to migrate.
              </div>
            )}
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

        {/* Buttons */}
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
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Add Asset')}
          </button>
        </div>
      </div>
    </div>
  )
}