'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../lib/supabase'
import { statusColor, formatCurrency } from '../../../../lib/tracker'
import EmployeeModal from '../../../../components/EmployeeModal'

export default function EmployeeDetailPage() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()

  const [employee, setEmployee] = useState(null)
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    loadData()
  }, [id])

  async function loadData() {
    const [{ data: emp }, { data: asts }] = await Promise.all([
      supabase
        .from('employees')
        .select('*, location:locations(name), room:rooms(name), manager:manager_id(full_name)')
        .eq('id', id)
        .single(),
      supabase
        .from('assets')
        .select('*')
        .eq('assigned_employee_id', id)
        .order('name'),
    ])
    setEmployee(emp || null)
    setAssets(asts || [])
    setLoading(false)
  }

  function handleSaved() {
    setEditing(false)
    loadData()
  }

  const btnStyle = {
    padding: '8px 16px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
    cursor: 'pointer', border: '1px solid #1e2d40', backgroundColor: '#131a24', color: '#8aa0b8',
  }

  if (loading) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!employee) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ color: '#5a6e84' }}>Employee not found.</div>
        <button style={{ ...btnStyle, marginTop: '16px' }} onClick={() => router.push('/tracker/employees')}>
          ← Back to Employees
        </button>
      </div>
    )
  }

  const locationText = employee.location?.name
    ? `${employee.location.name}${employee.room?.name ? ` · ${employee.room.name}` : ''}`
    : '—'

  const infoRows = [
    ['Email', employee.email || '—'],
    ['Department', employee.department || '—'],
    ['Title', employee.title || '—'],
    ['Location', locationText],
    ['Manager', employee.manager?.full_name || '—'],
  ]

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <button
        onClick={() => router.push('/tracker/employees')}
        style={{ ...btnStyle, marginBottom: '18px' }}
      >
        ← Employees
      </button>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: '24px', flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
              {employee.full_name}
            </h1>
            <span style={{
              display: 'inline-flex', padding: '4px 12px', borderRadius: '100px',
              fontSize: '11.5px', fontWeight: '600',
              backgroundColor: employee.status === 'active' ? '#0d3320' : '#1a1a1a',
              color: employee.status === 'active' ? '#4ade80' : '#737373',
              border: `1px solid ${employee.status === 'active' ? '#166534' : '#404040'}`,
            }}>
              {employee.status}
            </span>
          </div>
          {employee.title && (
            <div style={{ fontSize: '13px', color: '#5a6e84', marginTop: '6px' }}>{employee.title}</div>
          )}
        </div>
        <button style={btnStyle} onClick={() => setEditing(true)}>Edit Employee</button>
      </div>

      {/* Info grid */}
      <div style={{
        backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
        padding: '20px', marginBottom: '24px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px',
      }}>
        {infoRows.map(([label, value]) => (
          <div key={label} style={{ fontSize: '13px' }}>
            <span style={{ color: '#4a5a6e' }}>{label}: </span>
            <span style={{ color: '#8aa0b8' }}>{value}</span>
          </div>
        ))}
        {employee.notes && (
          <div style={{ fontSize: '13px', gridColumn: '1 / -1', color: '#6a7e94', lineHeight: '1.6', marginTop: '4px' }}>
            📝 {employee.notes}
          </div>
        )}
      </div>

      {/* Assigned assets */}
      <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#c0cad8', margin: '0 0 14px' }}>
        Assigned Assets ({assets.length})
      </h2>

      {assets.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
          textAlign: 'center', padding: '40px', color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '30px', marginBottom: '10px' }}>⊞</div>
          <div style={{ fontSize: '13.5px' }}>No assets assigned to this employee.</div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 110px 120px 130px 100px',
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            <span>Asset</span>
            <span>Tag</span>
            <span>Category</span>
            <span>Status</span>
            <span>Value</span>
          </div>

          {assets.map(asset => {
            const sc = statusColor(asset.status)
            return (
              <div
                key={asset.id}
                onClick={() => router.push('/tracker/assets')}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 110px 120px 130px 100px',
                  padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28',
                  cursor: 'pointer', fontSize: '13.5px',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div>
                  <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{asset.name}</div>
                  <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>{asset.serial_number || '—'}</div>
                </div>
                <span style={{ color: '#6a7e94', fontSize: '12px' }}>{asset.asset_tag || '—'}</span>
                <span style={{ color: '#6a7e94' }}>{asset.category || '—'}</span>
                <span style={{
                  display: 'inline-flex', padding: '4px 12px', borderRadius: '100px',
                  fontSize: '11.5px', fontWeight: '600', width: 'fit-content',
                  backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
                }}>
                  {asset.status}
                </span>
                <span style={{ color: '#8aa0b8' }}>
                  {formatCurrency(asset.purchase_cost, { blankDash: true })}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <EmployeeModal
          employee={employee}
          onSave={handleSaved}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
