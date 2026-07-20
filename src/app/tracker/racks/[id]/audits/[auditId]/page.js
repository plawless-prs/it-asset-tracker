'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '../../../../../../lib/supabase'
import {
  formatDate, AUDIT_CONDITIONS, auditResultMeta,
  countDiscrepancies, isDiscrepancy, rackPlacementError,
} from '../../../../../../lib/tracker'
import AssetModal from '../../../../../../components/AssetModal'

// Results an auditor can assign to an expected (snapshotted) device.
const EXPECTED_RESULT_OPTIONS = ['present', 'moved', 'missing']

export default function RackAuditPage() {
  const supabase = createClient()
  const router = useRouter()
  const { id, auditId } = useParams()

  const [rack, setRack] = useState(null)
  const [audit, setAudit] = useState(null)
  const [items, setItems] = useState([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [extraName, setExtraName] = useState('')
  const [busy, setBusy] = useState(false)
  const [createFor, setCreateFor] = useState(null) // extra item → create the real asset

  useEffect(() => {
    loadData()
  }, [auditId])

  async function loadData() {
    const [{ data: aud }, { data: its }] = await Promise.all([
      supabase.from('rack_audits')
        .select('*, rack:racks(name, u_height), auditor:profiles(full_name, email)')
        .eq('id', auditId)
        .single(),
      supabase.from('rack_audit_items')
        .select('*')
        .eq('audit_id', auditId)
        .order('expected_u_position', { ascending: false, nullsFirst: false }),
    ])
    setAudit(aud || null)
    setRack(aud?.rack || null)
    setNotes(aud?.notes || '')
    setItems(its || [])
    setLoading(false)
  }

  const done = audit?.status === 'completed'

  // Update one audit item (local + DB). No-op display flicker: we patch locally first.
  async function updateItem(itemId, patch) {
    setItems(prev => prev.map(it => (it.id === itemId ? { ...it, ...patch } : it)))
    await supabase.from('rack_audit_items').update(patch).eq('id', itemId)
  }

  async function addExtra() {
    const name = extraName.trim()
    if (!name) return
    const { data, error } = await supabase.from('rack_audit_items')
      .insert({ audit_id: auditId, device_name: name, result: 'extra' })
      .select()
      .single()
    if (error) return alert('Could not add: ' + error.message)
    setItems(prev => [...prev, data])
    setExtraName('')
  }

  async function removeItem(itemId) {
    setItems(prev => prev.filter(it => it.id !== itemId))
    await supabase.from('rack_audit_items').delete().eq('id', itemId)
  }

  async function saveNotes() {
    await supabase.from('rack_audits').update({ notes: notes.trim() || null }).eq('id', auditId)
  }

  async function completeAudit() {
    const pending = items.filter(i => i.result === 'pending').length
    if (pending > 0 && !window.confirm(`${pending} device(s) not yet reviewed. Complete the audit anyway?`)) return
    setBusy(true)
    const { error } = await supabase.from('rack_audits')
      .update({ status: 'completed', completed_at: new Date().toISOString(), notes: notes.trim() || null })
      .eq('id', auditId)
    if (error) { alert('Could not complete: ' + error.message); setBusy(false); return }
    router.push(`/tracker/racks/${id}`)
  }

  async function discardAudit() {
    if (!window.confirm('Discard this in-progress audit and all its items? This cannot be undone.')) return
    setBusy(true)
    const { error } = await supabase.from('rack_audits').delete().eq('id', auditId)
    if (error) { alert('Could not discard: ' + error.message); setBusy(false); return }
    router.push(`/tracker/racks/${id}`)
  }

  // --- Reconciliation: turn audit findings into real changes to the live data.

  // After creating the asset for an unexpected ("extra") device, link it back to
  // the audit item so the finding shows as reconciled.
  async function handleCreated(data) {
    if (createFor) {
      await supabase.from('rack_audit_items').update({ asset_id: data.id }).eq('id', createFor.id)
    }
    setCreateFor(null)
    loadData()
  }

  // Apply a "moved" finding: move the real asset to where it was actually found.
  async function applyMove(item) {
    const targetU = item.actual_u_position
    if (targetU == null) return alert('Enter the U position where the device was found first.')
    const { data: occ } = await supabase.from('assets')
      .select('id, name, u_position, u_height')
      .eq('rack_id', id)
      .not('u_position', 'is', null)
    const err = rackPlacementError({
      uStart: targetU,
      uHeight: item.expected_u_height || 1,
      rackHeight: rack?.u_height,
      occupied: occ || [],
      excludeId: item.asset_id,
    })
    if (err) return alert(err)
    const { error } = await supabase.from('assets')
      .update({ u_position: targetU, updated_at: new Date().toISOString() })
      .eq('id', item.asset_id)
    if (error) return alert('Could not move device: ' + error.message)
    alert(`Moved ${item.device_name || 'device'} to U${targetU}.`)
  }

  // Apply a "missing" finding: the device isn't in the rack, so detach it
  // (clears rack_id + u_position). Reversible — it can be re-added later.
  async function removeFromRack(item) {
    if (!window.confirm(`Remove ${item.device_name || 'this device'} from the rack? It will no longer be assigned to any rack (you can re-add it later).`)) return
    const { error } = await supabase.from('assets')
      .update({ rack_id: null, u_position: null, updated_at: new Date().toISOString() })
      .eq('id', item.asset_id)
    if (error) return alert('Could not remove device: ' + error.message)
    alert(`${item.device_name || 'Device'} removed from the rack.`)
  }

  const btnStyle = {
    padding: '8px 16px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '500',
    cursor: 'pointer', border: '1px solid #1e2d40', backgroundColor: '#131a24', color: '#8aa0b8',
  }
  const inputStyle = {
    width: '100%', padding: '7px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
    borderRadius: '7px', color: '#c0cad8', fontSize: '12.5px', outline: 'none', boxSizing: 'border-box',
  }

  if (loading) {
    return <div style={{ padding: '60px 24px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  }
  if (!audit) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>
        <div style={{ color: '#5a6e84' }}>Audit not found.</div>
        <button style={{ ...btnStyle, marginTop: '16px' }} onClick={() => router.push(`/tracker/racks/${id}`)}>
          ← Back to Rack
        </button>
      </div>
    )
  }

  const expectedItems = items.filter(i => i.expected_u_position != null)
  const extraItems = items.filter(i => i.expected_u_position == null)
  const disc = countDiscrepancies(items)

  function resultChip(value) {
    const meta = auditResultMeta(value)
    return (
      <span style={{
        display: 'inline-flex', padding: '3px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: '600',
        backgroundColor: meta.color.bg, color: meta.color.text, border: `1px solid ${meta.color.border}`,
      }}>
        {meta.label}
      </span>
    )
  }

  // Reconciliation action for a finding: apply it to the live asset data.
  // - extra   → create the real asset (prefilled) and link it to this finding
  // - moved   → move the real asset to where it was found
  function reconcileButton(item, extra) {
    const reconcileBtn = {
      padding: '5px 12px', borderRadius: '7px', fontSize: '11.5px', fontWeight: '600', cursor: 'pointer',
      backgroundColor: '#111d2e', color: '#60a5fa', border: '1px solid #1e3a5f', whiteSpace: 'nowrap',
    }
    if (extra) {
      if (item.asset_id) return <span style={{ fontSize: '11.5px', color: '#4ade80', fontWeight: 600, whiteSpace: 'nowrap' }}>Asset created ✓</span>
      return <button onClick={() => setCreateFor(item)} style={reconcileBtn}>Create asset</button>
    }
    if (item.result === 'moved' && item.asset_id && item.actual_u_position != null) {
      return <button onClick={() => applyMove(item)} style={reconcileBtn}>Apply move → U{item.actual_u_position}</button>
    }
    if (item.result === 'missing' && item.asset_id) {
      return (
        <button
          onClick={() => removeFromRack(item)}
          style={{ ...reconcileBtn, backgroundColor: '#2a1215', color: '#f87171', border: '1px solid #3a1a1a' }}
        >
          Remove from rack
        </button>
      )
    }
    return null
  }

  // A single editable item row (in-progress audit). Rendered via a plain
  // function call (not <ItemEditor/>) so state updates reconcile in place and
  // don't remount the inputs — which would drop unsaved Notes text.
  function renderEditor(item, extra) {
    const options = extra ? ['extra'] : EXPECTED_RESULT_OPTIONS
    return (
      <div key={item.id} style={{ padding: '14px 18px', borderBottom: '1px solid #141d28' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: '600', color: '#d0d8e4' }}>{item.device_name || 'Unnamed device'}</div>
            <div style={{ fontSize: '11.5px', color: '#5a6e84' }}>
              {extra
                ? 'Unexpected device'
                : `${item.device_type || 'Device'} · expected U${item.expected_u_position}${(item.expected_u_height || 1) > 1 ? `–U${item.expected_u_position + item.expected_u_height - 1}` : ''}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
            {reconcileButton(item, extra)}
            {extra && (
              <button onClick={() => removeItem(item.id)} style={{ ...btnStyle, padding: '4px 10px', fontSize: '11.5px', color: '#f87171', borderColor: '#3a1a1a' }}>
                Remove
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {options.map(opt => {
            const meta = auditResultMeta(opt)
            const active = item.result === opt
            return (
              <button
                key={opt}
                onClick={() => !extra && updateItem(item.id, { result: opt, ...(opt !== 'moved' ? { actual_u_position: null } : {}) })}
                disabled={extra}
                style={{
                  padding: '5px 14px', borderRadius: '100px', fontSize: '12px', fontWeight: '600',
                  cursor: extra ? 'default' : 'pointer',
                  backgroundColor: active ? meta.color.bg : 'transparent',
                  color: active ? meta.color.text : '#5a6e84',
                  border: `1px solid ${active ? meta.color.border : '#1e2d40'}`,
                }}
              >
                {meta.label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: (item.result === 'moved' || extra) ? '90px 150px 1fr' : '150px 1fr', gap: '10px' }}>
          {(item.result === 'moved' || extra) && (
            <div>
              <div style={labelMini}>Found at U</div>
              <input
                style={inputStyle}
                type="number"
                value={item.actual_u_position ?? ''}
                onChange={(e) => updateItem(item.id, { actual_u_position: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="U"
              />
            </div>
          )}
          <div>
            <div style={labelMini}>Condition</div>
            <select
              style={inputStyle}
              value={item.condition || ''}
              onChange={(e) => updateItem(item.id, { condition: e.target.value || null })}
            >
              {AUDIT_CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <div style={labelMini}>Notes</div>
            <input
              style={inputStyle}
              defaultValue={item.notes || ''}
              onBlur={(e) => { if ((e.target.value || '') !== (item.notes || '')) updateItem(item.id, { notes: e.target.value.trim() || null }) }}
              placeholder="Optional"
            />
          </div>
        </div>
      </div>
    )
  }

  // A single read-only item row (completed audit)
  function renderReadonly(item, extra) {
    return (
      <div key={item.id} style={{
        display: 'grid', gridTemplateColumns: '1fr 100px 70px 1fr auto', gap: '12px',
        padding: '12px 18px', alignItems: 'center', borderBottom: '1px solid #141d28', fontSize: '13px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: '600', color: '#d0d8e4' }}>{item.device_name || 'Unnamed device'}</div>
          <div style={{ fontSize: '11.5px', color: '#5a6e84' }}>
            {extra ? 'Unexpected device' : `${item.device_type || 'Device'} · expected U${item.expected_u_position}`}
          </div>
        </div>
        <div>{resultChip(item.result)}</div>
        <div style={{ color: '#8aa0b8', fontSize: '12px' }}>
          {item.result === 'moved' || extra ? (item.actual_u_position != null ? `U${item.actual_u_position}` : '—') : ''}
        </div>
        <div style={{ color: isDiscrepancy(item) ? '#c9b78a' : '#6a7e94', fontSize: '12px' }}>
          {[item.condition && item.condition !== 'ok'
            ? (AUDIT_CONDITIONS.find(c => c.value === item.condition)?.label)
            : null, item.notes].filter(Boolean).join(' · ') || '—'}
        </div>
        <div>{reconcileButton(item, extra)}</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px 60px' }}>
      <button onClick={() => router.push(`/tracker/racks/${id}`)} style={{ ...btnStyle, marginBottom: '18px' }}>
        ← {rack?.name || 'Rack'}
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
              Rack Audit
            </h1>
            <span style={{
              display: 'inline-flex', padding: '4px 12px', borderRadius: '100px', fontSize: '11.5px', fontWeight: '600',
              backgroundColor: done ? '#0d3320' : '#332800', color: done ? '#4ade80' : '#fbbf24',
              border: `1px solid ${done ? '#166534' : '#854d0e'}`,
            }}>
              {done ? 'Completed' : 'In progress'}
            </span>
          </div>
          <div style={{ fontSize: '13px', color: '#5a6e84', marginTop: '6px' }}>
            Started {formatDate(audit.started_at)}
            {done && ` · Completed ${formatDate(audit.completed_at)}`}
            {(audit.auditor?.full_name || audit.auditor?.email) && ` · by ${audit.auditor.full_name || audit.auditor.email}`}
          </div>
        </div>
        <div style={{
          textAlign: 'right', backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '12px 16px',
        }}>
          <div style={{ fontSize: '11px', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Discrepancies</div>
          <div style={{ fontSize: '20px', fontWeight: '700', color: disc > 0 ? '#f87171' : '#4ade80' }}>{disc}</div>
        </div>
      </div>

      {/* Items */}
      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden', marginBottom: '18px' }}>
        <div style={{
          padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e', textTransform: 'uppercase',
          letterSpacing: '0.8px', borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
        }}>
          Expected devices ({expectedItems.length})
        </div>
        {expectedItems.length === 0 ? (
          <div style={{ padding: '24px', fontSize: '13px', color: '#3a4a5e', textAlign: 'center' }}>
            No devices were mounted when this audit started.
          </div>
        ) : (
          expectedItems.map(item => (done ? renderReadonly(item) : renderEditor(item)))
        )}
      </div>

      {/* Extra devices */}
      {(extraItems.length > 0 || !done) && (
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden', marginBottom: '18px' }}>
          <div style={{
            padding: '10px 18px', fontSize: '11px', fontWeight: '600', color: '#4a5a6e', textTransform: 'uppercase',
            letterSpacing: '0.8px', borderBottom: '1px solid #182030', backgroundColor: '#0c1118',
          }}>
            Unexpected devices found ({extraItems.length})
          </div>
          {extraItems.map(item => (done ? renderReadonly(item, true) : renderEditor(item, true)))}
          {!done && (
            <div style={{ display: 'flex', gap: '10px', padding: '14px 18px' }}>
              <input
                style={inputStyle}
                value={extraName}
                onChange={(e) => setExtraName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addExtra() }}
                placeholder="Name of an unexpected device found in the rack…"
              />
              <button onClick={addExtra} style={{ ...btnStyle, whiteSpace: 'nowrap' }}>+ Add</button>
            </div>
          )}
        </div>
      )}

      {/* Overall notes */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '11.5px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' }}>
          Audit Notes
        </div>
        {done ? (
          <div style={{ fontSize: '13px', color: '#6a7e94', lineHeight: '1.6' }}>{audit.notes || '—'}</div>
        ) : (
          <textarea
            style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', padding: '10px 14px' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Overall observations for this audit…"
          />
        )}
      </div>

      {/* Actions */}
      {!done && (
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button onClick={discardAudit} disabled={busy} style={{ ...btnStyle, color: '#f87171', borderColor: '#3a1a1a' }}>
            Discard Audit
          </button>
          <button
            onClick={completeAudit}
            disabled={busy}
            style={{
              backgroundColor: busy ? '#1e40af' : '#2563eb', color: '#fff', padding: '10px 24px', borderRadius: '10px',
              fontWeight: '600', fontSize: '13.5px', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Saving…' : 'Complete Audit'}
          </button>
        </div>
      )}

      {/* Reconcile an unexpected device by creating the real asset, prefilled and
          mounted where the audit found it. */}
      {createFor && (
        <AssetModal
          defaults={{
            name: createFor.device_name || '',
            rack_mountable: true,
            rack_id: id,
            u_position: createFor.actual_u_position ?? '',
          }}
          onSave={handleCreated}
          onClose={() => setCreateFor(null)}
        />
      )}
    </div>
  )
}

const labelMini = {
  fontSize: '10.5px', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px',
}
