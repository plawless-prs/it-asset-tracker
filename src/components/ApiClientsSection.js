'use client'

// /admin → "Bot API clients": list, create, deactivate/activate, rotate.
// Talks to the admin-only /api/admin/api-clients route; the plain key is only
// ever in this component's state right after create/rotate (shown once).
import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

const btn = (bg, color) => ({
  padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '500',
  backgroundColor: bg, color, border: 'none', cursor: 'pointer',
})

function fmt(d) {
  return d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never'
}

export default function ApiClientsSection() {
  const supabase = createClient()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState(null) // { name, key }
  const [copied, setCopied] = useState(false)

  async function api(method, payload) {
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/api/admin/api-clients', {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: payload ? JSON.stringify(payload) : undefined,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) return { error: json.error || `Request failed (${res.status})` }
      return json
    } catch (e) {
      return { error: String(e?.message || e) }
    }
  }

  function applyList(result) {
    if (result.error) setError(result.error)
    else setClients(result.clients || [])
    setLoading(false)
  }

  async function load() {
    applyList(await api('GET'))
  }

  useEffect(() => {
    let alive = true
    api('GET').then(result => { if (alive) applyList(result) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reveal(clientName, key) {
    setRevealed({ name: clientName, key })
    setCopied(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true); setError('')
    const result = await api('POST', { name: name.trim(), scopes: ['helpdesk:read'] })
    setBusy(false)
    if (result.error) return setError(result.error)
    setName('')
    reveal(result.client.name, result.key)
    load()
  }

  async function handleAction(client, action) {
    if (action === 'rotate' && !confirm(`Rotate the key for "${client.name}"? The current key stops working immediately.`)) return
    if (action === 'deactivate' && !confirm(`Deactivate "${client.name}"? Its key will be rejected until reactivated.`)) return
    setBusy(true); setError('')
    const result = await api('PATCH', { id: client.id, action })
    setBusy(false)
    if (result.error) return setError(result.error)
    if (result.key) reveal(client.name, result.key)
    load()
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(revealed.key)
      setCopied(true)
    } catch {
      setError('Copy failed — select the key and copy it manually.')
    }
  }

  return (
    <div style={{ marginTop: '36px' }}>
      <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Bot API clients</h2>
      <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 16px' }}>
        API keys for bots calling <code>/api/bot/v1</code> (read-only Help Desk for now). Keys are shown once — store them in the bot&apos;s secret store.
      </p>

      {error && (
        <div style={{ padding: '10px 16px', borderRadius: '10px', marginBottom: '14px', fontSize: '13px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>
          {error}
        </div>
      )}

      {revealed && (
        <div style={{ padding: '14px 18px', borderRadius: '12px', marginBottom: '16px', backgroundColor: '#0d3320', border: '1px solid #166534' }}>
          <div style={{ fontSize: '13px', color: '#4ade80', fontWeight: '600', marginBottom: '8px' }}>
            New key for &quot;{revealed.name}&quot; — copy it now, it won&apos;t be shown again.
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, minWidth: '260px', padding: '8px 10px', borderRadius: '8px', backgroundColor: '#07140d', color: '#d0f5dd', fontSize: '12.5px', wordBreak: 'break-all', userSelect: 'all' }}>
              {revealed.key}
            </code>
            <button onClick={copyKey} style={btn('#166534', '#dcfce7')}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button onClick={() => setRevealed(null)} style={btn('#1b2533', '#aebacc')}>Done</button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Client name (e.g. helpdesk-triage)"
          maxLength={80}
          style={{ flex: 1, minWidth: '240px', padding: '9px 12px', backgroundColor: '#0f1620', border: '1px solid #1e2a3a', borderRadius: '8px', color: '#d0d8e4', fontSize: '13px', outline: 'none' }}
        />
        <span style={{ alignSelf: 'center', fontSize: '12px', color: '#5a6e84' }}>Scope: helpdesk:read</span>
        <button type="submit" disabled={busy || !name.trim()} style={{ ...btn('#2563eb', '#fff'), padding: '9px 18px', fontSize: '13px', opacity: busy || !name.trim() ? 0.6 : 1 }}>
          + Create key
        </button>
      </form>

      {loading ? (
        <div style={{ padding: '24px', color: '#5a6e84', fontSize: '13px' }}>Loading API clients...</div>
      ) : clients.length === 0 ? (
        <div style={{ padding: '18px', color: '#5a6e84', fontSize: '13px', backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px' }}>
          No API clients yet.
        </div>
      ) : (
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 80px 1.2fr 170px', gap: '8px', padding: '10px 18px', fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600', borderBottom: '1px solid #182030' }}>
            <span>Name</span><span>Key</span><span>Scopes</span><span>Status</span><span>Last used</span><span />
          </div>
          {clients.map(c => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 80px 1.2fr 170px', gap: '8px', padding: '12px 18px', alignItems: 'center', fontSize: '13px', borderBottom: '1px solid #131b27', opacity: c.active ? 1 : 0.6 }}>
              <span style={{ color: '#d0d8e4', fontWeight: '600' }}>{c.name}</span>
              <code style={{ color: '#8aa0b8', fontSize: '12px' }}>{c.key_prefix}…</code>
              <span style={{ color: '#8aa0b8', fontSize: '12px' }}>{(c.scopes || []).join(', ') || '—'}</span>
              <span style={{ fontSize: '11px', fontWeight: '600', color: c.active ? '#4ade80' : '#f87171' }}>{c.active ? 'Active' : 'Inactive'}</span>
              <span style={{ color: '#6a7e94', fontSize: '12px' }}>{fmt(c.last_used_at)}</span>
              <span style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button disabled={busy} onClick={() => handleAction(c, 'rotate')} style={btn('#1e2a3a', '#60a5fa')}>Rotate</button>
                {c.active
                  ? <button disabled={busy} onClick={() => handleAction(c, 'deactivate')} style={btn('#7f1d1d', '#fca5a5')}>Deactivate</button>
                  : <button disabled={busy} onClick={() => handleAction(c, 'activate')} style={btn('#14532d', '#86efac')}>Activate</button>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
