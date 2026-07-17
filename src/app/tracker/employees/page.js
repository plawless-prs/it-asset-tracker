'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../../lib/supabase'
import EmployeeModal from '../../../components/EmployeeModal'

export default function EmployeesPage() {
  const supabase = createClient()
  const [employees, setEmployees] = useState([])
  const [assetCounts, setAssetCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [{ data: emps }, { data: assets }] = await Promise.all([
      supabase.from('employees').select('*, location:locations(name)').order('full_name'),
      supabase.from('assets').select('assigned_employee_id'),
    ])
    if (emps) setEmployees(emps)
    if (assets) {
      const counts = {}
      for (const a of assets) {
        if (a.assigned_employee_id) counts[a.assigned_employee_id] = (counts[a.assigned_employee_id] || 0) + 1
      }
      setAssetCounts(counts)
    }
    setLoading(false)
  }

  function handleSaved() {
    setShowAddModal(false)
    setEditingEmployee(null)
    loadData()
  }

  const filtered = employees.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const searchable = `${e.full_name} ${e.email} ${e.department} ${e.title}`.toLowerCase()
      if (!searchable.includes(term)) return false
    }
    return true
  })

  const statusFilters = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'all', label: 'All' },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px', flexWrap: 'wrap', gap: '12px',
      }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
          Employees
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            backgroundColor: '#2563eb', color: '#fff', padding: '10px 22px',
            borderRadius: '10px', fontWeight: '600', fontSize: '13.5px', border: 'none', cursor: 'pointer',
          }}
        >
          + Add Employee
        </button>
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search employees..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            maxWidth: '260px', padding: '8px 14px', backgroundColor: '#131a24',
            border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8', fontSize: '13px', outline: 'none',
          }}
        />
        {statusFilters.map(s => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            style={{
              padding: '6px 16px', borderRadius: '100px', fontSize: '12px', fontWeight: '500',
              backgroundColor: statusFilter === s.value ? '#111d2e' : 'transparent',
              color: statusFilter === s.value ? '#60a5fa' : '#5a6e84',
              border: statusFilter === s.value ? '1px solid #1e3a5f' : '1px solid #1e2d40',
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>Loading employees...</div>
      ) : filtered.length === 0 ? (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
          textAlign: 'center', padding: '48px', color: '#3a4a5e',
        }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>👤</div>
          <div style={{ fontSize: '14px' }}>
            {employees.length === 0
              ? 'No employees yet. Click "+ Add Employee" to get started.'
              : 'No employees match your search or filter.'}
          </div>
        </div>
      ) : (
        <div style={{
          backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 140px 150px 80px 90px',
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '0.8px',
            borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            <span>Employee</span>
            <span>Department</span>
            <span>Location</span>
            <span>Assets</span>
            <span>Status</span>
          </div>

          {filtered.map(emp => (
            <div
              key={emp.id}
              onClick={() => setEditingEmployee(emp)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 140px 150px 80px 90px',
                padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28',
                cursor: 'pointer', fontSize: '13.5px',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111a26'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <div>
                <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{emp.full_name}</div>
                <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>{emp.title || emp.email || '—'}</div>
              </div>
              <span style={{ color: '#6a7e94' }}>{emp.department || '—'}</span>
              <span style={{ color: '#6a7e94' }}>{emp.location?.name || '—'}</span>
              <span style={{ color: '#8aa0b8' }}>{assetCounts[emp.id] || 0}</span>
              <span style={{
                display: 'inline-flex', padding: '4px 12px', borderRadius: '100px',
                fontSize: '11.5px', fontWeight: '600', width: 'fit-content',
                backgroundColor: emp.status === 'active' ? '#0d3320' : '#1a1a1a',
                color: emp.status === 'active' ? '#4ade80' : '#737373',
                border: `1px solid ${emp.status === 'active' ? '#166534' : '#404040'}`,
              }}>
                {emp.status}
              </span>
            </div>
          ))}
        </div>
      )}

      {(showAddModal || editingEmployee) && (
        <EmployeeModal
          employee={editingEmployee}
          onSave={handleSaved}
          onClose={() => { setShowAddModal(false); setEditingEmployee(null) }}
        />
      )}
    </div>
  )
}
