'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '../lib/supabase'

// P21 supplier picker: a typeahead over p21_supplier_mirror (the supplier
// directory the worker syncs from the replica). Type a name or id, pick from
// the dropdown — or type an id by hand (manual entry still works when the
// directory hasn't synced yet). Used by VendorModal and NewBatchModal.
//
//   value:    current supplier id (string, '' for none)
//   onChange: (supplierId, row|null) — row is the picked directory entry
//             when chosen from the dropdown, null for manual/cleared input
export default function SupplierLookup({ value, onChange, inputStyle }) {
  const supabase = createClient()
  const [text, setText] = useState(value || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  // Resolution is keyed by id so the displayed name is DERIVED from whether
  // it matches the current value (no synchronous state resets in effects).
  const [resolved, setResolved] = useState({ id: '', name: '' })
  const [directoryEmpty, setDirectoryEmpty] = useState(false)
  const timer = useRef(null)
  const blurTimer = useRef(null)

  // Resolve the current id to its directory name (shown under the field as
  // confirmation that the id is real).
  useEffect(() => {
    let cancelled = false
    const id = String(value || '').trim()
    if (!id) return
    supabase.from('p21_supplier_mirror').select('supplier_name').eq('supplier_id', id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setResolved({ id, name: data?.supplier_name || '' }) })
    return () => { cancelled = true }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedName = resolved.id === String(value || '').trim() ? resolved.name : ''

  // One-time: is the directory populated at all? (Empty until the worker's
  // first full sync after migration 19.)
  useEffect(() => {
    let cancelled = false
    supabase.from('p21_supplier_mirror').select('supplier_id', { count: 'exact', head: true })
      .then(({ count, error }) => { if (!cancelled) setDirectoryEmpty(!error && (count || 0) === 0) })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function search(q) {
    clearTimeout(timer.current)
    const term = q.trim()
    if (!term) { setResults([]); setOpen(false); return }
    timer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('p21_supplier_mirror')
        .select('supplier_id, supplier_name')
        .or(`supplier_name.ilike.%${term}%,supplier_id.ilike.${term}%`)
        .order('supplier_name')
        .limit(8)
      setResults(data || [])
      setOpen((data || []).length > 0)
    }, 250)
  }

  function pick(row) {
    clearTimeout(blurTimer.current)
    setText(row.supplier_id)
    setResolved({ id: row.supplier_id, name: row.supplier_name || '' })
    setOpen(false)
    onChange(row.supplier_id, row)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        value={text}
        placeholder="Search P21 name or id…"
        onChange={e => {
          setText(e.target.value)
          onChange(e.target.value.trim(), null)
          search(e.target.value)
        }}
        onFocus={() => { if (results.length) setOpen(true) }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150) }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: '4px',
          backgroundColor: '#0d1219', border: '1px solid #23304a', borderRadius: '10px',
          overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', maxHeight: '240px', overflowY: 'auto',
        }}>
          {results.map(r => (
            <div
              key={r.supplier_id}
              onMouseDown={(e) => { e.preventDefault(); pick(r) }}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #131c28' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#131e2c'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span style={{ fontSize: '12.5px', color: '#d0d8e4' }}>{r.supplier_name || '(unnamed)'}</span>
              <span style={{ fontSize: '11.5px', color: '#5a6e84', marginLeft: '8px' }}>{r.supplier_id}</span>
            </div>
          ))}
        </div>
      )}
      {resolvedName ? (
        <div style={{ fontSize: '11px', color: '#4ade80', marginTop: '4px' }}>✓ {resolvedName}</div>
      ) : directoryEmpty ? (
        <div style={{ fontSize: '11px', color: '#5a6e84', marginTop: '4px' }}>
          Supplier directory not synced yet — ids can still be entered by hand.
        </div>
      ) : String(value || '').trim() ? (
        <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '4px' }}>
          Id not found in the P21 supplier directory — double-check it.
        </div>
      ) : null}
    </div>
  )
}
