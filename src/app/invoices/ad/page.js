'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRole } from '../../../lib/useRole'

// AD Invoices — a personal batch utility for P21's AD invoice .txt exports.
// Every exported file needs the same two fixes before it can be used:
//   1. Rename: exports come out as "<digits>@!<digits>.txt"; the real name is
//      the second digit string, so everything through the "!" is stripped
//      ("123456@!78910.txt" -> "78910.txt").
//   2. Content: the file opens with a 3-letter vendor abbreviation followed by
//      a 5-digit number (usually starting at the 4th character). That number
//      is replaced with the batch's PO code — PO30 for AD Industrial, PO33
//      for AD Bearings — chosen at import time.
// Fully client-side: files are read, transformed, and saved back (folder
// picker, or a .zip fallback) without ever leaving the browser.

const BATCHES = {
  PO30: { label: 'AD Industrial', code: 'PO30' },
  PO33: { label: 'AD Bearings', code: 'PO33' },
}

// The 3-letter abbreviation + 5-digit run the PO code replaces. Anchored to
// the head of the file (the pattern "usually starts 4 characters in" — the
// 20-char window tolerates drift without risking a match deep in the body).
const HEAD_WINDOW = 20
const CONTENT_RX = /([A-Za-z]{3})(\s*)(\d{5})(?!\d)/

// -> { newName, nameOk, nameReason }
function transformName(name) {
  const idx = name.indexOf('!')
  if (idx === -1) return { newName: name, nameOk: false, nameReason: 'no "!" in the file name' }
  const newName = name.slice(idx + 1)
  if (!newName || newName.startsWith('.')) return { newName, nameOk: false, nameReason: 'nothing after the "!"' }
  return { newName, nameOk: true }
}

// -> { newContent, before, after, contentOk, contentReason }
function transformContent(content, code) {
  const head = content.slice(0, 200)
  const m = head.match(CONTENT_RX)
  if (!m || m.index > HEAD_WINDOW) {
    return { contentOk: false, contentReason: 'no "ABC 12345"-style pattern near the start of the file' }
  }
  // The PO code is padded to the same width as the 5 digits it replaces
  // ("PO30" + one space) — the file is fixed-width, so every character
  // position after the swap must stay where it was.
  const before = `${m[1]}${m[2]}${m[3]}`
  const after = `${m[1]}${m[2]}${code} `
  const newContent = content.slice(0, m.index) + after + content.slice(m.index + m[0].length)
  return { newContent, before, after, contentOk: true }
}

export default function AdInvoices() {
  const router = useRouter()
  const { hasAccess, loading: roleLoading } = useRole()
  useEffect(() => {
    if (!roleLoading && !hasAccess('invoices')) router.push('/')
  }, [roleLoading, hasAccess, router])

  const [batch, setBatch] = useState('PO30')
  const [items, setItems] = useState([])   // { id, origName, content }
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window

  async function addFiles(fileList) {
    setError(''); setNotice('')
    const picked = Array.from(fileList || []).filter(f => /\.txt$/i.test(f.name))
    const skipped = (fileList?.length || 0) - picked.length
    const read = await Promise.all(picked.map(async f => ({
      id: `${f.name}:${f.size}:${f.lastModified}`,
      origName: f.name,
      content: await f.text(),
    })))
    setItems(prev => {
      const seen = new Set(prev.map(x => x.id))
      return [...prev, ...read.filter(x => !seen.has(x.id))]
    })
    if (skipped > 0) setNotice(`${skipped} non-.txt file${skipped === 1 ? '' : 's'} ignored.`)
  }

  // Transforms are derived every render (cheap, and re-picking the batch type
  // re-computes every replacement from the original content).
  const rows = useMemo(() => {
    const code = BATCHES[batch].code
    const targetCounts = new Map()
    const list = items.map(it => {
      const name = transformName(it.origName)
      const cont = transformContent(it.content, code)
      const ok = name.nameOk && cont.contentOk
      if (ok) targetCounts.set(name.newName, (targetCounts.get(name.newName) || 0) + 1)
      return { ...it, ...name, ...cont, ok }
    })
    for (const r of list) {
      if (r.ok && targetCounts.get(r.newName) > 1) {
        r.ok = false
        r.dupReason = `duplicate output name (${r.newName})`
      }
    }
    return list
  }, [items, batch])

  const ready = rows.filter(r => r.ok)
  const flagged = rows.filter(r => !r.ok)

  async function saveToFolder() {
    setError(''); setNotice(''); setBusy(true)
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
      for (const r of ready) {
        const handle = await dir.getFileHandle(r.newName, { create: true })
        const w = await handle.createWritable()
        await w.write(r.newContent)
        await w.close()
      }
      setNotice(`Saved ${ready.length} file${ready.length === 1 ? '' : 's'} to "${dir.name}".`)
    } catch (e) {
      if (e?.name !== 'AbortError') setError(`Save failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function downloadZip() {
    setError(''); setNotice(''); setBusy(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (const r of ready) zip.file(r.newName, r.newContent)
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${BATCHES[batch].label.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
      setNotice(`Zipped ${ready.length} file${ready.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setError(`Zip failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  if (roleLoading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>

  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px' }
  const btn = (bg, color, disabled) => ({
    padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
    backgroundColor: disabled ? '#1a2433' : bg, color: disabled ? '#5a6e84' : color,
    border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
  })

  return (
    <div style={{ padding: '24px 28px', maxWidth: '980px' }}>
      <Link href="/invoices" style={{ fontSize: '12.5px', color: '#5a6e84', textDecoration: 'none' }}>← Invoice Processor</Link>
      <div style={{ margin: '10px 0 6px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>AD Invoices</h1>
        <p style={{ fontSize: '13px', color: '#5a6e84', margin: '4px 0 0' }}>
          Drop P21 .txt exports, pick the batch, and every file is renamed (everything through the “!” stripped)
          and its leading invoice number swapped for the batch&apos;s PO code. Nothing is uploaded — files are processed in your browser.
        </p>
      </div>

      {/* Batch picker */}
      <div style={{ display: 'flex', gap: '10px', margin: '16px 0' }}>
        {Object.entries(BATCHES).map(([key, b]) => (
          <button key={key} onClick={() => setBatch(key)} style={{
            padding: '10px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
            backgroundColor: batch === key ? '#10243f' : '#0f1620',
            color: batch === key ? '#7fb4f5' : '#8aa0b8',
            border: `1px solid ${batch === key ? '#2563eb' : '#1e2d40'}`,
          }}>
            {b.label} <span style={{ fontFamily: 'monospace', color: batch === key ? '#a5c8f0' : '#5a6e84' }}>({b.code})</span>
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
        style={{
          ...card, padding: '28px', textAlign: 'center', cursor: 'pointer', marginBottom: '16px',
          borderStyle: 'dashed', borderColor: dragOver ? '#2563eb' : '#1e2d40',
          backgroundColor: dragOver ? '#10243f' : '#0f1620',
        }}
      >
        <div style={{ fontSize: '13.5px', color: '#c0cad8', fontWeight: '600' }}>Drop .txt files here or click to browse</div>
        <div style={{ fontSize: '12px', color: '#5a6e84', marginTop: '4px' }}>Exports look like 123456@!78910.txt — batches of any size are fine.</div>
        <input ref={inputRef} type="file" accept=".txt" multiple style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      </div>

      {notice && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '12.5px', backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #166534' }}>{notice}</div>}
      {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '12px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

      {rows.length > 0 && (
        <>
          {/* Preview */}
          <div style={{ ...card, overflow: 'hidden', marginBottom: '14px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12.5px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #182030' }}>
                  {['Original name', 'New name', 'Replacement', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #131c28' }}>
                    <td style={{ padding: '9px 14px', color: '#8aa0b8', fontFamily: 'monospace', fontSize: '12px' }}>{r.origName}</td>
                    <td style={{ padding: '9px 14px', color: r.nameOk ? '#d0d8e4' : '#f87171', fontFamily: 'monospace', fontSize: '12px' }}>
                      {r.nameOk ? r.newName : '—'}
                    </td>
                    <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: '12px' }}>
                      {r.contentOk
                        ? <><span style={{ color: '#8aa0b8' }}>{r.before}</span><span style={{ color: '#5a6e84' }}> → </span><span style={{ color: '#4ade80' }}>{r.after}</span></>
                        : <span style={{ color: '#f87171' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 14px' }}>
                      {r.ok ? (
                        <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: '#0d3320', color: '#4ade80' }}>Ready</span>
                      ) : (
                        <span style={{ fontSize: '11.5px', color: '#fbbf24' }}>
                          Skipped — {r.dupReason || r.nameReason || r.contentReason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {canPickFolder && (
              <button onClick={saveToFolder} disabled={busy || ready.length === 0} style={btn('#2563eb', '#fff', busy || ready.length === 0)}>
                {busy ? 'Working…' : `Save ${ready.length} file${ready.length === 1 ? '' : 's'} to folder…`}
              </button>
            )}
            <button onClick={downloadZip} disabled={busy || ready.length === 0} style={btn(canPickFolder ? '#1e2a3a' : '#2563eb', canPickFolder ? '#60a5fa' : '#fff', busy || ready.length === 0)}>
              Download .zip
            </button>
            <button onClick={() => { setItems([]); setNotice(''); setError('') }} disabled={busy} style={btn('#1e2a3a', '#8aa0b8', busy)}>
              Clear
            </button>
            <span style={{ fontSize: '12px', color: '#5a6e84' }}>
              {ready.length} ready{flagged.length > 0 ? ` · ${flagged.length} skipped (fix in P21 or by hand)` : ''}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
