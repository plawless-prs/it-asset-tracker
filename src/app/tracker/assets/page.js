'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../../lib/supabase'
import { ASSET_STATUSES, statusColor, formatCurrency } from '../../../lib/tracker'
import AssetModal from '../../../components/AssetModal'
import AssetDetail from '../../../components/AssetDetail'
import CheckoutModal from '../../../components/CheckoutModal'

export default function AssetsPage() {
  const supabase = createClient()
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('All')
  const [searchTerm, setSearchTerm] = useState('')
  const [groupBy, setGroupBy] = useState('none')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingAsset, setEditingAsset] = useState(null)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [checkoutAsset, setCheckoutAsset] = useState(null)

  useEffect(() => {
    loadAssets()
  }, [])

  async function loadAssets() {
    const { data, error } = await supabase
      .from('assets')
      .select('*, employee:employees(full_name), location_obj:locations(name), room:rooms(name), rack:racks(name)')
      .order('created_at', { ascending: false })

    if (data) setAssets(data)
    setLoading(false)
  }

  // Write to audit log helper
  async function logAction(action, entityType, entityId, detail) {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail,
      user_id: user?.id,
    })
  }

  // Check out an asset — open the employee picker
  function handleCheckout(asset) {
    setSelectedAsset(null)
    setCheckoutAsset(asset)
  }

  // Confirm checkout from the picker: assign to the chosen employee.
  // assigned_employee_id is the source of truth; assigned_to keeps a cached
  // name for the list display/search and readable audit-log entries.
  async function confirmCheckout(emp) {
    const asset = checkoutAsset
    await supabase.from('assets').update({
      status: 'Deployed',
      assigned_employee_id: emp.id,
      assigned_to: emp.full_name,
      assigned_date: new Date().toISOString(),
    }).eq('id', asset.id)

    await logAction('checked_out', 'asset', asset.id, `"${asset.name}" checked out to ${emp.full_name}`)
    setCheckoutAsset(null)
    loadAssets()
  }

  // Check in an asset
  async function handleCheckin(asset) {
    await supabase.from('assets').update({
      status: 'Ready to Deploy',
      assigned_employee_id: null,
      assigned_to: null,
      assigned_date: null,
    }).eq('id', asset.id)

    await logAction('checked_in', 'asset', asset.id, `"${asset.name}" checked in`)
    setSelectedAsset(null)
    loadAssets()
  }

  // Dispose of an asset
  async function handleDispose(asset) {
    const reason = prompt('Disposal reason (e.g., End of life, Data wiped, Donated):')
    if (!reason) return

    await supabase.from('assets').update({
      status: 'Disposed',
      disposal_reason: reason,
      disposal_date: new Date().toISOString(),
    }).eq('id', asset.id)

    await logAction('disposed', 'asset', asset.id, `"${asset.name}" disposed: ${reason}`)
    setSelectedAsset(null)
    loadAssets()
  }

  // After saving a new or edited asset
  async function handleSaved(asset, isNew) {
    await logAction(
      isNew ? 'created' : 'updated',
      'asset',
      asset.id,
      `Asset "${asset.name}" ${isNew ? 'added' : 'updated'}`
    )
    setShowAddModal(false)
    setEditingAsset(null)
    loadAssets()
  }

  // Filter logic
  const filtered = assets.filter(a => {
    if (statusFilter !== 'All' && a.status !== statusFilter) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const searchable = `${a.name} ${a.asset_tag} ${a.serial_number} ${a.employee?.full_name || a.assigned_to} ${a.category} ${a.make} ${a.model}`.toLowerCase()
      if (!searchable.includes(term)) return false
    }
    return true
  })

  const statuses = ['All', ...ASSET_STATUSES]

  const groupOptions = [
    { value: 'none', label: 'None' },
    { value: 'employee', label: 'Employee' },
    { value: 'location', label: 'Location' },
  ]

  // Bucket the filtered assets into ordered groups for the current groupBy.
  // The catch-all bucket (Unassigned / No location) always sorts last.
  const catchAll = groupBy === 'employee' ? 'Unassigned' : 'No location'
  function groupKey(a) {
    if (groupBy === 'employee') return a.employee?.full_name || a.assigned_to || catchAll
    if (groupBy === 'location') return a.location_obj?.name || a.location || catchAll
    return ''
  }
  const groups = (() => {
    if (groupBy === 'none') return [{ key: null, rows: filtered }]
    const map = new Map()
    for (const a of filtered) {
      const k = groupKey(a)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(a)
    }
    const keys = [...map.keys()].sort((x, y) => {
      if (x === catchAll) return 1
      if (y === catchAll) return -1
      return x.localeCompare(y)
    })
    return keys.map(k => ({ key: k, rows: map.get(k) }))
  })()

  const gridCols = '52px 1fr 120px 120px 130px 100px'

  function renderRow(asset) {
    const sc = statusColor(asset.status)
    return (
      <div
        key={asset.id}
        onClick={() => setSelectedAsset(asset)}
        style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          padding: '12px 18px',
          alignItems: 'center',
          borderBottom: '1px solid #141d28',
          cursor: 'pointer',
          fontSize: '13.5px',
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        {/* Photo thumbnail */}
        <div>
          {asset.photo_url ? (
            <img
              src={asset.photo_url}
              alt={asset.name}
              style={{ width: '36px', height: '36px', borderRadius: '8px', objectFit: 'cover' }}
            />
          ) : (
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px', backgroundColor: '#131a24',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', color: '#3a4a5e',
            }}>
              ⊞
            </div>
          )}
        </div>

        {/* Name + Serial */}
        <div>
          <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{asset.name}</div>
          <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>
            {asset.type ? `${asset.type} · ` : ''}{asset.serial_number || '—'}
          </div>
        </div>

        <span style={{ color: '#6a7e94' }}>{asset.category || '—'}</span>
        <span style={{ color: '#6a7e94' }}>{asset.employee?.full_name || asset.assigned_to || '—'}</span>

        {/* Status badge */}
        <span style={{
          display: 'inline-flex', padding: '4px 12px', borderRadius: '100px',
          fontSize: '11.5px', fontWeight: '600',
          backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`, width: 'fit-content',
        }}>
          {asset.status}
        </span>

        <span style={{ color: '#8aa0b8' }}>
          {formatCurrency(asset.purchase_cost, { blankDash: true })}
        </span>
      </div>
    )
  }

  function renderTable(rows) {
    return (
      <div style={{
        backgroundColor: '#0f1620',
        border: '1px solid #182030',
        borderRadius: '14px',
        overflow: 'hidden',
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          padding: '10px 18px',
          fontSize: '11px',
          fontWeight: '600',
          color: '#4a5a6e',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          borderBottom: '1px solid #182030',
          backgroundColor: '#0c1118',
        }}>
          <span></span>
          <span>Asset</span>
          <span>Category</span>
          <span>Assigned To</span>
          <span>Status</span>
          <span>Value</span>
        </div>
        {rows.map(asset => renderRow(asset))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          Assets
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            backgroundColor: '#2563eb',
            color: '#fff',
            padding: '10px 22px',
            borderRadius: '10px',
            fontWeight: '600',
            fontSize: '13.5px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          + Add Asset
        </button>
      </div>

      {/* Search and Filters */}
      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '18px',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <input
          placeholder="Search assets..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            maxWidth: '260px',
            padding: '8px 14px 8px 36px',
            backgroundColor: '#131a24',
            border: '1px solid #1e2d40',
            borderRadius: '8px',
            color: '#c0cad8',
            fontSize: '13px',
            outline: 'none',
            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%234a5a6e' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.242.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z'/%3E%3C/svg%3E\")",
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '12px center',
          }}
        />
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '6px 16px',
              borderRadius: '100px',
              fontSize: '12px',
              fontWeight: '500',
              backgroundColor: statusFilter === s ? '#111d2e' : 'transparent',
              color: statusFilter === s ? '#60a5fa' : '#5a6e84',
              border: statusFilter === s ? '1px solid #1e3a5f' : '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}

        {/* Group-by control */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Group
          </span>
          {groupOptions.map(g => (
            <button
              key={g.value}
              onClick={() => setGroupBy(g.value)}
              style={{
                padding: '6px 14px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '500',
                backgroundColor: groupBy === g.value ? '#111d2e' : 'transparent',
                color: groupBy === g.value ? '#60a5fa' : '#5a6e84',
                border: groupBy === g.value ? '1px solid #1e3a5f' : '1px solid #1e2d40',
                cursor: 'pointer',
              }}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Asset Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>
          Loading assets...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          textAlign: 'center',
          padding: '48px',
          color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>⊞</div>
          <div style={{ fontSize: '14px' }}>
            {assets.length === 0
              ? 'No assets yet. Click "+ Add Asset" to get started.'
              : 'No assets match your search or filter.'}
          </div>
        </div>
      ) : groupBy === 'none' ? (
        renderTable(filtered)
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {groups.map(group => (
            <div key={group.key}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
              }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#c0cad8' }}>
                  {group.key}
                </span>
                <span style={{ fontSize: '11.5px', color: '#4a5a6e' }}>
                  {group.rows.length} asset{group.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              {renderTable(group.rows)}
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingAsset) && (
        <AssetModal
          asset={editingAsset}
          onSave={handleSaved}
          onClose={() => { setShowAddModal(false); setEditingAsset(null) }}
        />
      )}

      {/* Detail Modal */}
      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onCheckout={handleCheckout}
          onCheckin={handleCheckin}
          onDispose={handleDispose}
          onEdit={(asset) => { setSelectedAsset(null); setEditingAsset(asset) }}
        />
      )}

      {/* Checkout (assign to employee) Modal */}
      {checkoutAsset && (
        <CheckoutModal
          asset={checkoutAsset}
          onConfirm={confirmCheckout}
          onClose={() => setCheckoutAsset(null)}
        />
      )}
    </div>
  )
}