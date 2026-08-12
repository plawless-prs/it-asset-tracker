'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../lib/supabase'
import { formatDate } from '../lib/priceupdates'

// Vendor add/edit for the Price Update Processor (full CRUD as of Phase 7).
// Covers the fields matching needs (P21 supplier id + item prefix), name /
// email domains / notes / active, the vendor's saved parse profiles (with
// delete — the cleanup path for stale pre-fingerprint profiles), and vendor
// deletion when nothing references it.
export default function VendorModal({ vendor, onClose, onSaved }) {
  const supabase = createClient()
  const editing = !!vendor?.id
  const [form, setForm] = useState({
    name: vendor?.name || '',
    p21_supplier_id: vendor?.p21_supplier_id || '',
    p21_item_prefix: vendor?.p21_item_prefix || '',
    email_domains: (vendor?.email_domains || []).join(', '),
    notes: vendor?.notes || '',
    active: vendor?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Parse profiles + batch usage (edit mode only).
  const [profiles, setProfiles] = useState(null)
  const [batchCount, setBatchCount] = useState(null)
  const [busyProfile, setBusyProfile] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!editing) return
    async function load() {
      const [{ data: p }, { count }] = await Promise.all([
        supabase.from('pu_parse_profiles')
          .select('id, label, config, created_at')
          .eq('vendor_id', vendor.id).order('created_at', { ascending: false }),
        supabase.from('pu_batches')
          .select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
      ])
      setProfiles(p || [])
      setBatchCount(count || 0)
    }
    load()
  }, [editing, vendor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(key, value) { setForm(prev => ({ ...prev, [key]: value })) }

  async function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      p21_supplier_id: form.p21_supplier_id.trim() || null,
      p21_item_prefix: form.p21_item_prefix || null,   // keep literal (may have a trailing space)
      email_domains: form.email_domains.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      notes: form.notes.trim() || null,
      active: form.active,
    }
    const q = editing
      ? supabase.from('pu_vendors').update(payload).eq('id', vendor.id)
      : supabase.from('pu_vendors').insert(payload)
    const { error: e } = await q
    setSaving(false)
    if (e) { setError(e.message); return }
    onSaved?.()
  }

  // Deleting a profile: pu_batch_files.parse_profile_id has no ON DELETE
  // action, so clear those references first (the files stay parsed — the
  // profile id on them is only provenance).
  async function deleteProfile(p) {
    if (!confirm(`Delete parse profile "${p.label}"? Files parsed with it keep their lines; the vendor's next file won't auto-parse with this recipe.`)) return
    setBusyProfile(p.id); setError('')
    try {
      const { error: refErr } = await supabase.from('pu_batch_files')
        .update({ parse_profile_id: null }).eq('parse_profile_id', p.id)
      if (refErr) throw refErr
      const { error: delErr } = await supabase.from('pu_parse_profiles').delete().eq('id', p.id)
      if (delErr) throw delErr
      setProfiles(prev => prev.filter(x => x.id !== p.id))
    } catch (e) {
      setError(`Profile delete failed: ${e.message}`)
    } finally {
      setBusyProfile(null)
    }
  }

  // Vendor delete is only offered when no batches reference it (the FK would
  // block it anyway) — deactivating is the archival path for real vendors.
  // Profiles/aliases cascade; library files keep their rows (vendor unlinks).
  async function deleteVendor() {
    setDeleting(true); setError('')
    const { error: e } = await supabase.from('pu_vendors').delete().eq('id', vendor.id)
    setDeleting(false)
    if (e) { setError(`Delete failed: ${e.message}`); return }
    onSaved?.()
  }

  const labelStyle = { display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }
  const inputStyle = { width: '100%', padding: '10px 14px', backgroundColor: '#131a24', border: '1px solid #1e2d40', borderRadius: '8px', color: '#c0cad8', fontSize: '13.5px', outline: 'none', boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px', padding: '28px',
        maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 20px' }}>
          {editing ? 'Edit vendor' : 'New vendor'}
        </h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Name *</label>
          <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Gates Corporation" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <label style={labelStyle}>P21 supplier ID</label>
            <input style={inputStyle} value={form.p21_supplier_id} onChange={e => set('p21_supplier_id', e.target.value)} placeholder="e.g. 10638" />
          </div>
          <div>
            <label style={labelStyle}>P21 item prefix</label>
            <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.p21_item_prefix} onChange={e => set('p21_item_prefix', e.target.value)} placeholder="e.g. &quot;GAT &quot;" />
          </div>
        </div>
        <div style={{ fontSize: '11px', color: '#5a6e84', margin: '-8px 0 14px' }}>
          Both are needed to match this vendor to P21 items. The prefix is literal — include the trailing space if there is one (e.g. <code style={{ color: '#8aa0b8' }}>GAT </code>).
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Email domains</label>
          <input style={inputStyle} value={form.email_domains} onChange={e => set('email_domains', e.target.value)} placeholder="gates.com, contitech.com" />
          <div style={{ fontSize: '11px', color: '#5a6e84', marginTop: '4px' }}>Comma-separated. Used to auto-identify inbound price emails.</div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, height: '64px', resize: 'vertical' }}
            value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Rep contact, pricing quirks, portal URL…"
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#c0cad8', cursor: 'pointer', marginBottom: '20px' }}>
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} style={{ accentColor: '#2563eb', width: '16px', height: '16px' }} />
          Active
        </label>

        {editing && (
          <div style={{ borderTop: '1px solid #182030', paddingTop: '16px', marginBottom: '18px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>
              Parse profiles {profiles ? `(${profiles.length})` : ''}
            </div>
            {profiles === null ? (
              <div style={{ fontSize: '12px', color: '#5a6e84' }}>Loading…</div>
            ) : profiles.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#4a5a6e' }}>
                None yet — map one of this vendor&apos;s files and &quot;Save as parse profile&quot; to enable one-click and on-arrival auto-parsing.
              </div>
            ) : profiles.map(p => {
              const fingerprinted = Array.isArray(p.config?.header_signature) && p.config.header_signature.length > 0
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: '1px solid #131c28' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12.5px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.label}>{p.label}</div>
                    <div style={{ fontSize: '11px', color: '#5a6e84' }}>
                      {formatDate(p.created_at)} · sheet &quot;{p.config?.sheet ?? '?'}&quot;
                    </div>
                  </div>
                  <span title={fingerprinted
                    ? 'Has a header fingerprint — eligible for on-arrival auto-parse'
                    : 'No header fingerprint (saved before fingerprinting) — auto-parses on arrival only if it is the vendor’s sole profile'}
                    style={{
                      padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap',
                      backgroundColor: fingerprinted ? '#0d3320' : '#332300', color: fingerprinted ? '#4ade80' : '#fbbf24',
                    }}>
                    {fingerprinted ? 'Fingerprinted' : 'No fingerprint'}
                  </span>
                  <button
                    onClick={() => deleteProfile(p)}
                    disabled={busyProfile === p.id}
                    style={{
                      background: 'none', border: '1px solid #3a1518', borderRadius: '7px', color: '#f87171',
                      fontSize: '11px', fontWeight: '600', padding: '4px 9px',
                      cursor: busyProfile === p.id ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                    }}>
                    {busyProfile === p.id ? '…' : 'Delete'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {editing && batchCount !== null && (
            batchCount === 0 ? (
              confirmDelete ? (
                <button onClick={deleteVendor} disabled={deleting} style={{ padding: '10px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', backgroundColor: '#7f1d1d', color: '#fecaca', border: 'none', cursor: deleting ? 'not-allowed' : 'pointer' }}>
                  {deleting ? 'Deleting…' : 'Really delete?'}
                </button>
              ) : (
                <button onClick={() => setConfirmDelete(true)} style={{ padding: '10px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', backgroundColor: 'transparent', color: '#f87171', border: '1px solid #3a1518', cursor: 'pointer' }}>
                  Delete vendor
                </button>
              )
            ) : (
              <span style={{ fontSize: '11px', color: '#4a5a6e' }} title="Vendors with batches can't be deleted — uncheck Active instead.">
                {batchCount} batch{batchCount === 1 ? '' : 'es'} — deactivate instead of deleting
              </span>
            )
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={saving} style={{ padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '500', backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '10px 22px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600', backgroundColor: saving ? '#1e40af' : '#2563eb', color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
