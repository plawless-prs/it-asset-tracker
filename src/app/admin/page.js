'use client'

import { useState, useEffect } from 'react'
import { createClient } from '../../lib/supabase'
import { useRole } from '../../lib/useRole'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const supabase = createClient()
  const router = useRouter()
  const { role, loading: roleLoading, isAdmin } = useRole()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      router.push('/')
    }
  }, [roleLoading, isAdmin])

  useEffect(() => {
    if (isAdmin) loadUsers()
  }, [isAdmin])

  async function loadUsers() {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, department, created_at, app_access')
      .order('created_at', { ascending: true })

    if (data) setUsers(data)
    setLoading(false)
  }

  async function handleCreateUser(formData) {
    setMessage('')

    const { data: currentSession } = await supabase.auth.getSession()

    const { data, error } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
    })

    if (error) {
      setMessage('Error creating user: ' + error.message)
      return
    }

    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role,
        department: formData.department,
        app_access: formData.app_access,
      })

      const { data: { user: adminUser } } = await supabase.auth.getUser()
      await supabase.from('audit_log').insert({
        action: 'created',
        entity_type: 'user',
        detail: `User "${formData.email}" created with role "${formData.role}"`,
        user_id: adminUser?.id,
      })
    }

    if (currentSession?.session) {
      await supabase.auth.signInWithPassword({
        email: prompt('Re-enter YOUR admin email to stay logged in:'),
        password: prompt('Re-enter YOUR admin password:'),
      })
    }

    setShowCreateModal(false)
    loadUsers()
    setMessage('User created successfully')
    setTimeout(() => setMessage(''), 3000)
  }

  async function handleUpdateRole(userId, newRole, userName) {
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)

    if (error) {
      alert(error.message)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action: 'updated',
      entity_type: 'user',
      detail: `User "${userName}" role changed to "${newRole}"`,
      user_id: user?.id,
    })

    loadUsers()
  }

  async function handleUpdateAppAccess(userId, newAccess, userName) {
    const { error } = await supabase
      .from('profiles')
      .update({ app_access: newAccess })
      .eq('id', userId)

    if (error) {
      alert(error.message)
      return
    }

    // Update local state immediately
    setUsers(prev => prev.map(u =>
      u.id === userId ? { ...u, app_access: newAccess } : u
    ))

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action: 'updated',
      entity_type: 'user',
      detail: `User "${userName}" app access updated to: ${newAccess.join(', ')}`,
      user_id: user?.id,
    })
  }

  async function handleDeleteUser(profile) {
    if (profile.role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length
      if (adminCount <= 1) {
        alert('Cannot delete the last admin account. Assign another admin first.')
        return
      }
    }

    const confirmed = confirm(`Are you sure you want to delete ${profile.email || profile.full_name}? This removes their profile but their auth account will remain in Supabase.`)
    if (!confirmed) return

    const { error } = await supabase.from('profiles').delete().eq('id', profile.id)

    if (error) {
      alert(error.message)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action: 'deleted',
      entity_type: 'user',
      detail: `User "${profile.email || profile.full_name}" deleted`,
      user_id: user?.id,
    })

    loadUsers()
  }

  async function handleEditUser(userId, formData) {
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: formData.full_name || null,
        department: formData.department || null,
      })
      .eq('id', userId)

    if (error) {
      alert('Error updating user: ' + error.message)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      action: 'updated',
      entity_type: 'user',
      detail: `User "${formData.full_name || formData.email}" profile updated`,
      user_id: user?.id,
    })

    setEditingUser(null)
    loadUsers()
  }

  const roleColors = {
    admin: { bg: '#330d0d', text: '#f87171', border: '#991b1b' },
    manager: { bg: '#1a1a2e', text: '#a78bfa', border: '#5b21b6' },
    editor: { bg: '#1e2a3a', text: '#60a5fa', border: '#1e40af' },
    viewer: { bg: '#1a1a1a', text: '#737373', border: '#404040' },
  }

  const allApps = [
    { id: 'tracker', label: 'IT Tracker' },
    { id: 'invoices', label: 'Invoice Processor' },
    { id: 'calculator', label: 'Material Calculator' },
  ]

  if (roleLoading || (!isAdmin && !roleLoading)) {
    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>
        {roleLoading ? 'Checking permissions...' : 'Redirecting...'}
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
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>
            User Management
          </h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
            Create accounts, manage roles, and control app access for your team
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
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
          + Create User
        </button>
      </div>

      {/* Success message */}
      {message && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '10px',
          marginBottom: '18px',
          fontSize: '13px',
          backgroundColor: '#0d3320',
          color: '#4ade80',
          border: '1px solid #166534',
        }}>
          {message}
        </div>
      )}

      {/* Role legend */}
      <div style={{
        display: 'flex',
        gap: '16px',
        marginBottom: '20px',
        flexWrap: 'wrap',
      }}>
        {[
          { role: 'admin', desc: 'Full access + user management' },
          { role: 'manager', desc: 'Create, edit, delete data' },
          { role: 'editor', desc: 'Create and edit data' },
          { role: 'viewer', desc: 'Read-only access' },
        ].map(r => {
          const rc = roleColors[r.role]
          return (
            <div key={r.role} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
            }}>
              <span style={{
                padding: '2px 10px',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: '600',
                backgroundColor: rc.bg,
                color: rc.text,
                border: `1px solid ${rc.border}`,
              }}>
                {r.role}
              </span>
              <span style={{ color: '#5a6e84' }}>{r.desc}</span>
            </div>
          )
        })}
      </div>

      {/* User list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#5a6e84' }}>Loading users...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {users.map(profile => {
            const rc = roleColors[profile.role] || roleColors.viewer
            const adminCount = users.filter(u => u.role === 'admin').length
            const isLastAdmin = profile.role === 'admin' && adminCount <= 1
            const userAccess = profile.app_access || ['tracker', 'invoices', 'calculator']

            return (
              <div key={profile.id} style={{
                backgroundColor: '#0f1620',
                border: '1px solid #182030',
                borderRadius: '14px',
                padding: '18px',
              }}>
                {/* Top row: user info, role, actions */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 150px 150px 120px 100px',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <div>
                    <div
                      style={{ fontWeight: '600', color: '#d0d8e4', cursor: 'pointer', fontSize: '14px' }}
                      onClick={() => setEditingUser(profile)}
                    >
                      {profile.full_name || 'No name set'}
                      <span style={{ fontSize: '10px', color: '#3a4a5e', marginLeft: '6px' }}>✎</span>
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>
                      {profile.email || profile.id.slice(0, 8) + '...'}
                    </div>
                  </div>

                  <span style={{ color: '#6a7e94', fontSize: '13px' }}>{profile.department || '—'}</span>

                  <div>
                    <select
                      value={profile.role || 'viewer'}
                      onChange={(e) => handleUpdateRole(profile.id, e.target.value, profile.email || profile.full_name)}
                      disabled={isLastAdmin}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: rc.bg,
                        color: rc.text,
                        border: `1px solid ${rc.border}`,
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: isLastAdmin ? 'not-allowed' : 'pointer',
                        outline: 'none',
                        opacity: isLastAdmin ? 0.6 : 1,
                      }}
                    >
                      <option value="admin">admin</option>
                      <option value="manager">manager</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                    {isLastAdmin && (
                      <div style={{ fontSize: '10px', color: '#854d0e', marginTop: '2px' }}>
                        Last admin
                      </div>
                    )}
                  </div>

                  <span style={{ fontSize: '12px', color: '#4a5a6e' }}>
                    {profile.created_at
                      ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </span>

                  <div>
                    {!isLastAdmin && (
                      <button
                        onClick={() => handleDeleteUser(profile)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '500',
                          backgroundColor: '#7f1d1d',
                          color: '#fca5a5',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* App Access Permissions */}
                <div style={{
                  marginTop: '14px',
                  paddingTop: '14px',
                  borderTop: '1px solid #182030',
                }}>
                  <div style={{
                    fontSize: '11px',
                    color: '#5a6e84',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: '8px',
                    fontWeight: '600',
                  }}>
                    App Access
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {allApps.map(app => {
                      const hasApp = userAccess.includes(app.id)
                      const isAdminUser = profile.role === 'admin'
                      return (
                        <label key={app.id} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          cursor: isAdminUser ? 'not-allowed' : 'pointer',
                          opacity: isAdminUser ? 0.5 : 1,
                          fontSize: '13px',
                          color: hasApp ? '#c0cad8' : '#4a5a6e',
                        }}>
                          <input
                            type="checkbox"
                            checked={isAdminUser ? true : hasApp}
                            disabled={isAdminUser}
                            onChange={(e) => {
                              const newAccess = e.target.checked
                                ? [...userAccess, app.id]
                                : userAccess.filter(a => a !== app.id)
                              handleUpdateAppAccess(
                                profile.id,
                                newAccess,
                                profile.email || profile.full_name
                              )
                            }}
                            style={{ accentColor: '#2563eb', width: '16px', height: '16px' }}
                          />
                          {app.label}
                        </label>
                      )
                    })}
                  </div>
                  {profile.role === 'admin' && (
                    <div style={{ fontSize: '11px', color: '#4a5a6e', marginTop: '4px' }}>
                      Admins always have access to all apps
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onSave={handleCreateUser}
          onClose={() => setShowCreateModal(false)}
          allApps={allApps}
        />
      )}
      {/* Edit User Modal */}
      {editingUser && (
        <EditUserModal
          profile={editingUser}
          onSave={handleEditUser}
          onClose={() => setEditingUser(null)}
        />
      )}
    </div>
  )
}

function CreateUserModal({ onSave, onClose, allApps }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'viewer',
    department: '',
    app_access: ['tracker', 'invoices', 'calculator'],
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function toggleApp(appId) {
    setForm(prev => {
      const current = prev.app_access || []
      const newAccess = current.includes(appId)
        ? current.filter(a => a !== appId)
        : [...current, appId]
      return { ...prev, app_access: newAccess }
    })
  }

  async function handleSubmit() {
    if (!form.email || !form.password) return alert('Email and password are required')
    if (form.password.length < 6) return alert('Password must be at least 6 characters')
    setSaving(true)
    await onSave(form)
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
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40',
        borderRadius: '16px', padding: '28px', maxWidth: '480px', width: '100%',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          Create New User
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Email *</label>
            <input style={inputStyle} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="user@company.com" />
          </div>
          <div>
            <label style={labelStyle}>Temporary Password *</label>
            <input style={inputStyle} type="text" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Min 6 characters" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>Full Name</label>
            <input style={inputStyle} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="John Smith" />
          </div>
          <div>
            <label style={labelStyle}>Department</label>
            <input style={inputStyle} value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. IT, Marketing" />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Role</label>
          <select style={inputStyle} value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="viewer">Viewer — read-only access</option>
            <option value="editor">Editor — can create and edit</option>
            <option value="manager">Manager — can create, edit, and delete</option>
            <option value="admin">Admin — full access + user management</option>
          </select>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>App Access</label>
          <div style={{
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            padding: '12px 14px',
            backgroundColor: '#131a24',
            border: '1px solid #1e2d40',
            borderRadius: '8px',
          }}>
            {allApps.map(app => {
              const checked = form.role === 'admin' ? true : (form.app_access || []).includes(app.id)
              return (
                <label key={app.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: form.role === 'admin' ? 'not-allowed' : 'pointer',
                  opacity: form.role === 'admin' ? 0.5 : 1,
                  fontSize: '13px',
                  color: checked ? '#c0cad8' : '#4a5a6e',
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={form.role === 'admin'}
                    onChange={() => toggleApp(app.id)}
                    style={{ accentColor: '#2563eb', width: '16px', height: '16px' }}
                  />
                  {app.label}
                </label>
              )
            })}
          </div>
          {form.role === 'admin' && (
            <div style={{ fontSize: '11px', color: '#4a5a6e', marginTop: '4px' }}>
              Admins always have access to all apps
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
            backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
            backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Creating...' : 'Create User'}</button>
        </div>
      </div>
    </div>
  )
}

function EditUserModal({ profile, onSave, onClose }) {
  const [form, setForm] = useState({
    full_name: profile.full_name || '',
    email: profile.email || '',
    department: profile.department || '',
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit() {
    setSaving(true)
    await onSave(profile.id, form)
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
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40',
        borderRadius: '16px', padding: '28px', maxWidth: '460px', width: '100%',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', marginBottom: '20px' }}>
          Edit User Profile
        </h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Full Name</label>
          <input style={inputStyle} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="John Smith" />
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Email</label>
          <input style={inputStyle} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="user@company.com" disabled
            title="Email is tied to the auth account and cannot be changed here"
          />
          <div style={{ fontSize: '11px', color: '#3a4a5e', marginTop: '4px' }}>
            Email is tied to the login account and cannot be changed here
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Department</label>
          <input style={inputStyle} value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="e.g. IT, Marketing, Operations" />
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500',
            backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{
            padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600',
            backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}>{saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </div>
    </div>
  )
}
