'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

// Pick an employee to assign (check out) an asset to. Replaces the old
// prompt()-for-a-name flow now that employees are real records.
export default function CheckoutModal({ asset, onConfirm, onClose }) {
  const supabase = createClient()
  const [employees, setEmployees] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadEmployees()
  }, [])

  async function loadEmployees() {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, department')
      .eq('status', 'active')
      .order('full_name')
    if (data) setEmployees(data)
    setLoading(false)
  }

  async function handleConfirm() {
    if (!employeeId) return alert('Select an employee')
    const emp = employees.find(e => e.id === employeeId)
    setSaving(true)
    await onConfirm(emp)   // parent does the DB write + reload
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
        zIndex: 1100,
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
          maxWidth: '440px',
          width: '100%',
        }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '6px' }}>
          Check Out Asset
        </h2>
        <div style={{ fontSize: '13px', color: '#5a6e84', marginBottom: '20px' }}>
          Assign <span style={{ color: '#8aa0b8' }}>{asset.name}</span> to an employee.
        </div>

        <label style={{
          display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
          textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
        }}>
          Employee
        </label>
        {loading ? (
          <div style={{ color: '#5a6e84', fontSize: '13px', padding: '8px 0' }}>Loading employees…</div>
        ) : employees.length === 0 ? (
          <div style={{ color: '#fbbf24', fontSize: '13px', padding: '8px 0' }}>
            No active employees yet. Add one on the Employees page first.
          </div>
        ) : (
          <select style={inputStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— Select employee —</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.full_name}{e.department ? ` · ${e.department}` : ''}
              </option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
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
            onClick={handleConfirm}
            disabled={saving || loading || employees.length === 0}
            style={{
              padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
              backgroundColor: (saving || employees.length === 0) ? '#1e40af' : '#2563eb',
              color: '#fff', border: 'none',
              cursor: (saving || employees.length === 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Assigning…' : 'Check Out'}
          </button>
        </div>
      </div>
    </div>
  )
}
