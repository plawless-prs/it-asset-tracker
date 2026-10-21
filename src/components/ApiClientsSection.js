'use client'

// /admin → "Bot API clients": list, create, deactivate/activate, rotate, edit
// scopes, and pick the "Acts as" profile writes are attributed to.
// Talks to the admin-only /api/admin/api-clients route; the plain key is only
// ever in this component's state right after create/rotate (shown once).
import { useState, useEffect } from 'react'
import { createClient } from '../lib/supabase'

const btn = (bg, color) => ({
  padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: '500',
  backgroundColor: bg, color, border: 'none', cursor: 'pointer',
})

const MODULE_LABELS = {
  helpdesk: 'Help Desk',
  kb: 'Knowledge base',
  assets: 'IT Tracker',
  dailyops: 'Daily Ops',
  pricing: 'Price Update Processor',
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x))

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
  const [scopeList, setScopeList] = useState([])
  const [scopeInfo, setScopeInfo] = useState({})
  const [profiles, setProfiles] = useState([])
  const [mailboxEmails, setMailboxEmails] = useState([])
  const [drafts, setDrafts] = useState({}) // client id -> { scopes, profileId } (edited, unsaved)

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
    else {
      setClients(result.clients || [])
      setScopeList(result.available_scopes || [])
      setScopeInfo(result.scope_info || {})
      setProfiles(result.profiles || [])
      setMailboxEmails(result.mailbox_emails || [])
      setDrafts({})
    }
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

  function draftFor(c) {
    return drafts[c.id] || { scopes: c.scopes || [], profileId: c.acting_profile_id || '' }
  }

  function editDraft(c, patch) {
    setDrafts(d => ({ ...d, [c.id]: { ...draftFor(c), ...patch } }))
  }

  function toggleScope(c, scope) {
    const cur = draftFor(c).scopes
    editDraft(c, { scopes: cur.includes(scope) ? cur.filter(s => s !== scope) : [...cur, scope] })
  }

  // Save one field; keep any unsaved edit to the other field of the same client.
  async function saveField(c, action, payload, field) {
    setBusy(true); setError('')
    const result = await api('PATCH', { id: c.id, action, ...payload })
    setBusy(false)
    if (result.error) return setError(result.error)
    setClients(list => list.map(x => (x.id === c.id ? result.client : x)))
    setDrafts(d => {
      if (!d[c.id]) return d
      const saved = field === 'scopes'
        ? { scopes: result.client.scopes || [] }
        : { profileId: result.client.acting_profile_id || '' }
      return { ...d, [c.id]: { ...d[c.id], ...saved } }
    })
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
        API keys for bots calling <code>/api/bot/v1</code>. Keys are shown once — store them in the bot&apos;s secret store. Scopes take effect on the next call (the key doesn&apos;t change); write scopes also need an &quot;Acts as&quot; profile. Scopes for modules without endpoints yet grant nothing until those ship.
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
        <span style={{ alignSelf: 'center', fontSize: '12px', color: '#5a6e84' }}>Starts with helpdesk:read — edit scopes below after creating</span>
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
            <div key={c.id} style={{ borderBottom: '1px solid #131b27' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 80px 1.2fr 170px', gap: '8px', padding: '12px 18px', alignItems: 'center', fontSize: '13px', opacity: c.active ? 1 : 0.6 }}>
              <span style={{ color: '#d0d8e4', fontWeight: '600' }}>{c.name}</span>
              <code style={{ color: '#8aa0b8', fontSize: '12px' }}>{c.key_prefix}…</code>
              <span style={{ color: '#8aa0b8', fontSize: '12px' }}>{(c.scopes || []).length} scope{(c.scopes || []).length === 1 ? '' : 's'}</span>
              <span style={{ fontSize: '11px', fontWeight: '600', color: c.active ? '#4ade80' : '#f87171' }}>{c.active ? 'Active' : 'Inactive'}</span>
              <span style={{ color: '#6a7e94', fontSize: '12px' }}>{fmt(c.last_used_at)}</span>
              <span style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button disabled={busy} onClick={() => handleAction(c, 'rotate')} style={btn('#1e2a3a', '#60a5fa')}>Rotate</button>
                {c.active
                  ? <button disabled={busy} onClick={() => handleAction(c, 'deactivate')} style={btn('#7f1d1d', '#fca5a5')}>Deactivate</button>
                  : <button disabled={busy} onClick={() => handleAction(c, 'activate')} style={btn('#14532d', '#86efac')}>Activate</button>}
              </span>
            </div>
            <ClientConfig
              client={c}
              draft={draftFor(c)}
              busy={busy}
              scopeList={scopeList}
              scopeInfo={scopeInfo}
              profiles={profiles}
              mailboxEmails={mailboxEmails}
              onToggleScope={scope => toggleScope(c, scope)}
              onPickProfile={profileId => editDraft(c, { profileId })}
              onSaveScopes={() => saveField(c, 'set_scopes', { scopes: draftFor(c).scopes }, 'scopes')}
              onSaveProfile={() => saveField(c, 'set_acting_profile', { profile_id: draftFor(c).profileId || null }, 'profile')}
            />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Per-client scopes (grouped by module) + "Acts as" picker.
function ClientConfig({ client, draft, busy, scopeList, scopeInfo, profiles, mailboxEmails, onToggleScope, onPickProfile, onSaveScopes, onSaveProfile }) {
  const scopesChanged = !sameSet(draft.scopes, client.scopes || [])
  const profileChanged = draft.profileId !== (client.acting_profile_id || '')
  const migrated = 'acting_profile_id' in client
  const picked = profiles.find(p => p.id === draft.profileId)
  const isMailbox = picked?.email && mailboxEmails.includes(picked.email.toLowerCase())

  const modules = []
  for (const scope of scopeList) {
    const mod = scope.split(':')[0]
    let group = modules.find(m => m.id === mod)
    if (!group) modules.push(group = { id: mod, scopes: [] })
    group.scopes.push(scope)
  }

  const label = { fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600', marginBottom: '8px' }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', padding: '4px 18px 16px', opacity: client.active ? 1 : 0.6 }}>
      <div style={{ flex: '2 1 420px' }}>
        <div style={label}>Scopes</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px 18px' }}>
          {modules.map(m => (
            <div key={m.id}>
              <div style={{ fontSize: '12px', color: '#aebacc', fontWeight: '600', marginBottom: '4px' }}>{MODULE_LABELS[m.id] || m.id}</div>
              {m.scopes.map(scope => {
                const on = draft.scopes.includes(scope)
                return (
                  <label key={scope} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '3px 0', cursor: busy ? 'default' : 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={() => onToggleScope(scope)}
                      style={{ accentColor: '#2563eb', width: '14px', height: '14px', marginTop: '2px' }}
                    />
                    <span>
                      <code style={{ fontSize: '12px', color: on ? '#c0cad8' : '#6a7e94' }}>{scope}</code>
                      <span style={{ display: 'block', fontSize: '11.5px', color: '#5a6e84' }}>{scopeInfo[scope] || ''}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
        <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            disabled={busy || !scopesChanged || !draft.scopes.length}
            onClick={onSaveScopes}
            style={{ ...btn('#2563eb', '#fff'), opacity: busy || !scopesChanged || !draft.scopes.length ? 0.5 : 1, cursor: busy || !scopesChanged || !draft.scopes.length ? 'default' : 'pointer' }}
          >
            Save scopes
          </button>
          {scopesChanged && !draft.scopes.length && (
            <span style={{ fontSize: '12px', color: '#f87171' }}>Keep at least one scope — deactivate the key to switch it off.</span>
          )}
        </div>
      </div>

      <div style={{ flex: '1 1 280px' }}>
        <div style={label}>Acts as</div>
        {!migrated ? (
          <div style={{ fontSize: '12px', color: '#5a6e84' }}>Run migration <code>22_bot_api_writes.sql</code> to enable this.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={draft.profileId}
                disabled={busy}
                onChange={e => onPickProfile(e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: '6px 8px', backgroundColor: '#131a24', color: '#d0d8e4', border: '1px solid #1e2d40', borderRadius: '6px', fontSize: '12px', outline: 'none' }}
              >
                <option value="">— none —</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name || p.email || p.id}{p.email ? ` (${p.email})` : ''}</option>
                ))}
              </select>
              <button
                disabled={busy || !profileChanged}
                onClick={onSaveProfile}
                style={{ ...btn('#2563eb', '#fff'), opacity: busy || !profileChanged ? 0.5 : 1, cursor: busy || !profileChanged ? 'default' : 'pointer' }}
              >
                Save
              </button>
            </div>
            {isMailbox && (
              <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', fontSize: '12px', lineHeight: 1.45, backgroundColor: '#332200', color: '#fbbf24', border: '1px solid #92400e' }}>
                This profile&apos;s email is a mailbox the app reads for incoming tickets. Bot actions will show as this user, and emails the app sends to it (e.g. &apos;assigned to you&apos;) would come back in as new tickets — don&apos;t assign tickets to it.
              </div>
            )}
            <div style={{ marginTop: '8px', fontSize: '11.5px', color: '#5a6e84', lineHeight: 1.45 }}>
              Write endpoints attribute everything to this profile and refuse to run without one. The profile can still log in to the app if it has a password — deactivating this key is the kill switch for the bot.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
