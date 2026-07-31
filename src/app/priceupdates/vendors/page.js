'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import VendorModal from '../../../components/VendorModal'

// Phase 3: minimal vendor management — enough to set the P21 supplier id +
// item prefix that matching needs. Full CRUD + parse-profile listing: Phase 7.
export default function VendorsPage() {
  const supabase = createClient()
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // vendor object, or {} for new

  async function load() {
    const { data } = await supabase
      .from('pu_vendors')
      .select('id, name, p21_supplier_id, p21_item_prefix, email_domains, active')
      .order('name')
    setVendors(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const GRID = '1.4fr 120px 110px 1.4fr 80px'

  return (
    <div style={{ padding: '24px 28px', maxWidth: '960px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Vendors</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>{vendors.length} vendor{vendors.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={() => setEditing({})} style={{
          backgroundColor: '#2563eb', color: '#fff', padding: '10px 18px', borderRadius: '10px',
          fontWeight: '600', fontSize: '13px', border: 'none', cursor: 'pointer',
        }}>+ New vendor</button>
      </div>

      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: GRID, gap: '10px', padding: '11px 18px',
          borderBottom: '1px solid #182030', fontSize: '11px', color: '#5a6e84',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <div>Vendor</div><div>P21 supplier</div><div>Prefix</div><div>Email domains</div><div>Active</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
        ) : vendors.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>No vendors yet.</div>
        ) : vendors.map(v => (
          <div
            key={v.id}
            onClick={() => setEditing(v)}
            style={{
              display: 'grid', gridTemplateColumns: GRID, gap: '10px', padding: '13px 18px',
              borderBottom: '1px solid #131c28', alignItems: 'center', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = '#111b27'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <div style={{ fontSize: '13.5px', color: '#d0d8e4', fontWeight: '500' }}>{v.name}</div>
            <div style={{ fontSize: '12.5px', color: v.p21_supplier_id ? '#c0cad8' : '#f87171' }}>{v.p21_supplier_id || 'unset'}</div>
            <div style={{ fontSize: '12.5px', color: v.p21_item_prefix ? '#c0cad8' : '#4a5a6e', fontFamily: 'monospace' }}>
              {v.p21_item_prefix ? `"${v.p21_item_prefix}"` : '—'}
            </div>
            <div style={{ fontSize: '12px', color: '#8aa0b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(v.email_domains || []).join(', ') || '—'}
            </div>
            <div>
              <span style={{
                padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600',
                backgroundColor: v.active ? '#0d3320' : '#1a1a1a', color: v.active ? '#4ade80' : '#737373',
              }}>{v.active ? 'Active' : 'Inactive'}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '14px', fontSize: '11.5px', color: '#4a5a6e' }}>
        A red <span style={{ color: '#f87171' }}>unset</span> P21 supplier means matching is disabled for that vendor — set the supplier ID (and item prefix) to enable it.
      </div>

      {editing && (
        <VendorModal
          vendor={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
