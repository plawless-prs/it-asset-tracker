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
      .select('*')
      .order('created_at', { ascending: true })

    if (data) setUsers(data)
    setLoading(false)
  }

  async function handleCreateUser(formData) {
    setMessage('')

    // Use Supabase admin API to create user via Edge Function
    // Since we can't use the admin API from the client, we'll use signUp
    // but immediately sign back in as the admin
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
      // Create their profile
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email: formData.email,
        full_name: formData.full_name,
        role: formData.role,
        department: formData.department,
      })

      // Log the action
      const { data: { user: adminUser } } = await supabase.auth.getUser()
      await supabase.from('audit_log').insert({
        action: 'created',
        entity_type: 'user',
        detail: `User "${formData.email}" created with role "${formData.role}"`,
        user_id: adminUser?.id,
      })
    }

    // Sign back in as admin (creating a user signs you in as them)
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
            Create accounts and manage roles for your team
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
        <div style={{
          backgroundColor: '#0f1620',
          border: '1px solid #182030',
          borderRadius: '14px',
          overflow: 'hidden',
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 150px 150px 120px 100px',
            padding: '10px 18px',
            fontSize: '11px',
            fontWeight: '600',
            color: '#4a5a6e',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            borderBottom: '1px solid #182030',
            backgroundColor: '#0c1118',
          }}>
            <span>User</span>
            <span>Department</span>
            <span>Role</span>
            <span>Joined</span>
            <span></span>
          </div>

          {users.map(profile => {
            const rc = roleColors[profile.role] || roleColors.viewer
            const adminCount = users.filter(u => u.role === 'admin').length
            const isLastAdmin = profile.role === 'admin' && adminCount <= 1

            return (
              <div key={profile.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 150px 150px 120px 100px',
                padding: '14px 18px',
                alignItems: 'center',
                borderBottom: '1px solid #141d28',
                fontSize: '13px',
              }}>
                <div>
                  <div
                    style={{ fontWeight: '600', color: '#d0d8e4', cursor: 'pointer' }}
                    onClick={() => setEditingUser(profile)}
                  >
                    {profile.full_name || 'No name set'}
                    <span style={{ fontSize: '10px', color: '#3a4a5e', marginLeft: '6px' }}>✎</span>
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#4a5a6e' }}>
                    {profile.email || profile.id.slice(0, 8) + '...'}
                  </div>
                </div>

                <span style={{ color: '#6a7e94' }}>{profile.department || '—'}</span>

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
            )
          })}
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <CreateUserModal
          onSave={handleCreateUser}
          onClose={() => setShowCreateModal(false)}
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

function CreateUserModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'viewer',
    department: '',
  })
  const [saving, setSaving] = useState(false)

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
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

        <div style={{ marginBottom: '20px' }}>
          <label style={labelStyle}>Role</label>
          <select style={inputStyle} value={form.role} onChange={(e) => set('role', e.target.value)}>
            <option value="viewer">Viewer — read-only access</option>
            <option value="editor">Editor — can create and edit</option>
            <option value="manager">Manager — can create, edit, and delete</option>
            <option value="admin">Admin — full access + user management</option>
          </select>
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