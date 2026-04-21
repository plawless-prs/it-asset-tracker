'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

// Add these imports at the top of the file
import { useRouter } from 'next/navigation'
import { useRole } from '../../lib/useRole'
 
const DISCOUNT_RATE = 0.05

function formatCurrency(val) {
  if (val === null || val === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val)
}

// ─── Confidence Badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ level }) {
  const styles = {
    high: { bg: '#0d3320', color: '#4ade80', border: '#166534', label: 'High' },
    medium: { bg: '#332800', color: '#fbbf24', border: '#854d0e', label: 'Medium' },
    low: { bg: '#330d0d', color: '#f87171', border: '#991b1b', label: 'Low' },
  }
  const s = styles[level] || styles.low
  return (
    <span style={{
      padding: '2px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: '600',
      backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  )
}

// ─── Editable Cell ────────────────────────────────────────────────────────────

function EditableCell({ value, onSave }) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(value?.toString() ?? '')

  const handleSave = () => {
    const parsed = raw === '' ? null : parseFloat(raw.replace(/[$,]/g, ''))
    onSave(isNaN(parsed) ? null : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <input
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') setEditing(false)
          }}
          style={{
            width: '100px', padding: '2px 6px', fontSize: '12px',
            backgroundColor: '#131a24', border: '1px solid #2563eb',
            borderRadius: '4px', color: '#c0cad8', outline: 'none',
          }}
        />
        <button onClick={handleSave} style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', fontSize: '14px' }}>✓</button>
        <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: '#5a6e84', cursor: 'pointer', fontSize: '14px' }}>✕</button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setRaw(value?.toString() ?? ''); setEditing(true) }}
      style={{
        background: 'none', border: 'none', color: '#c0cad8', cursor: 'pointer',
        fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px',
        padding: 0,
      }}
    >
      <span>{formatCurrency(value)}</span>
      <span style={{ fontSize: '11px', color: '#3a4a5e', transition: 'color 0.15s' }}>✎</span>
    </button>
  )
}

// ─── Invoice Row ──────────────────────────────────────────────────────────────

function InvoiceRow({ invoice, sessionId, index, onUpdate, onPreview }) {
  const [expanded, setExpanded] = useState(false)

  const recompute = (updated) => {
    const merged = { ...invoice, ...updated }
    const discount = merged.subTotal !== null ? Math.round(merged.subTotal * DISCOUNT_RATE * 100) / 100 : null
    const newAmountDue = merged.originalAmountDue !== null && discount !== null
      ? Math.round((merged.originalAmountDue - discount) * 100) / 100
      : null
    return { ...merged, discount, newAmountDue }
  }

  const hasError = !!invoice.error
  const fileName = invoice.fileName.length > 40 ? '…' + invoice.fileName.slice(-37) : invoice.fileName

  const downloadPdf = (e) => {
    e.stopPropagation()
    window.open(`/api/invoices/${sessionId}/pdf/${encodeURIComponent(invoice.fileName)}`, '_blank')
  }

  const previewPdf = (e) => {
    e.stopPropagation()
    const url = `/api/invoices/${sessionId}/pdf/${encodeURIComponent(invoice.fileName)}?inline=true`
    onPreview(url, invoice.fileName)
  }

  const detailRows = [
    { label: 'Sub-Total', key: 'subTotal', editable: true },
    { label: 'Discount', key: 'discount', editable: false, note: '5% of Sub-Total, auto-calculated' },
    { label: 'Total Freight', key: 'totalFreight', editable: true },
    { label: 'Tax', key: 'tax', editable: true },
    { label: 'Original Amount Due', key: 'originalAmountDue', editable: true, muted: true },
    { label: 'New Amount Due', key: 'newAmountDue', editable: false, highlight: true },
  ]

  return (
    <div style={{
      border: `1px solid ${hasError ? '#991b1b' : '#182030'}`,
      borderRadius: '10px', overflow: 'hidden',
    }}>
      {/* Collapsed row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 18px', backgroundColor: '#0f1620',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {/* Status icon */}
        <div style={{ flexShrink: 0, fontSize: '14px' }}>
          {hasError ? '⚠' : invoice.extractionConfidence === 'high' ? '✓' : '⚡'}
        </div>

        {/* File info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: '500', color: '#e0e7f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={invoice.fileName}>
              {fileName}
            </span>
            {invoice.subIndex !== undefined && (
              <span style={{
                padding: '1px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '500',
                backgroundColor: '#1e2a3a', color: '#60a5fa', border: '1px solid #1e40af',
              }}>
                Invoice {invoice.subIndex}
              </span>
            )}
            <ConfidenceBadge level={invoice.extractionConfidence} />
          </div>
          {hasError && <p style={{ fontSize: '12px', color: '#f87171', margin: '4px 0 0' }}>{invoice.error}</p>}
        </div>

        {/* Summary values (desktop) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#4a5a6e' }}>Sub-Total</div>
            <div style={{ fontSize: '13px', fontWeight: '500', color: '#e0e7f0' }}>{formatCurrency(invoice.subTotal)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#4a5a6e' }}>Discount</div>
            <div style={{ fontSize: '13px', fontWeight: '500', color: '#4ade80' }}>
              {invoice.discount !== null ? `-${formatCurrency(invoice.discount)}` : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#4a5a6e' }}>New Amount Due</div>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#60a5fa' }}>{formatCurrency(invoice.newAmountDue)}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {!hasError && (
            <>
              <button onClick={previewPdf} style={{
                padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
              }}>
                Preview
              </button>
              <button onClick={downloadPdf} style={{
                padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
              }}>
                PDF
              </button>
            </>
          )}
          <span style={{ fontSize: '12px', color: '#4a5a6e', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', display: 'inline-block' }}>▾</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ borderTop: '1px solid #182030', backgroundColor: '#0b1017', padding: '16px 18px' }}>
          <div style={{ border: '1px solid #182030', borderRadius: '8px', overflow: 'hidden', fontSize: '13px' }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 160px',
              padding: '8px 16px', backgroundColor: '#0c1118', borderBottom: '1px solid #182030',
            }}>
              <span style={{ fontSize: '11px', fontWeight: '600', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Line Item</span>
              <span style={{ fontSize: '11px', fontWeight: '600', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Amount</span>
            </div>

            {/* Detail rows */}
            {detailRows.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 160px',
                  alignItems: 'center', padding: '8px 16px',
                  borderBottom: '1px solid #141d28',
                  backgroundColor: row.highlight ? '#111d2e' : 'transparent',
                }}
              >
                <div>
                  <span style={{ color: row.muted ? '#5a6e84' : '#c0cad8' }}>{row.label}</span>
                  {row.note && <span style={{ fontSize: '11px', color: '#3a4a5e', marginLeft: '8px' }}>({row.note})</span>}
                </div>
                <div>
                  {row.editable ? (
                    <EditableCell
                      value={invoice[row.key]}
                      onSave={(v) => {
                        const update = {}
                        update[row.key] = v
                        onUpdate(index, recompute(update))
                      }}
                    />
                  ) : (
                    <span style={{
                      fontSize: '13px',
                      fontWeight: row.highlight ? '700' : '400',
                      color: row.highlight ? '#60a5fa' : '#c0cad8',
                    }}>
                      {formatCurrency(invoice[row.key])}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Raw text toggle */}
          {invoice.rawText && (
            <details style={{ marginTop: '12px' }}>
              <summary style={{ fontSize: '12px', color: '#3a4a5e', cursor: 'pointer' }}>Show extracted text</summary>
              <pre style={{
                marginTop: '8px', fontSize: '11px', backgroundColor: '#0c1118',
                borderRadius: '6px', padding: '12px', overflow: 'auto',
                maxHeight: '200px', whiteSpace: 'pre-wrap', color: '#5a6e84',
                border: '1px solid #182030',
              }}>
                {invoice.rawText}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InvoiceProcessorPage() {
   // Add inside the component, before other logic
  const router = useRouter()
  const { hasAccess, loading: roleLoading } = useRole()

  useEffect(() => {
    if (!roleLoading && !hasAccess('invoices')) {
      router.push('/')
    }
  }, [roleLoading, hasAccess])

  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewName, setPreviewName] = useState('')
  const [splitMulti, setSplitMulti] = useState(false)

  const handleFiles = useCallback(async (files) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf')
    if (pdfs.length === 0) return alert('Please upload PDF files only.')
    setProcessing(true)

    const formData = new FormData()
    pdfs.forEach((f) => formData.append('pdfs', f))
    if (splitMulti) formData.append('splitMulti', 'true')

    try {
      const res = await fetch('/api/invoices/process', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Processing failed')
      }
      const data = await res.json()
      setResult(data)
      setInvoices(data.invoices)
    } catch (err) {
      alert('Processing failed: ' + err.message)
    }
    setProcessing(false)
  }, [splitMulti])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  const onFileChange = (e) => {
    if (e.target.files) handleFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const handleUpdateInvoice = (index, updated) => {
    const newInvoices = [...invoices]
    newInvoices[index] = updated
    setInvoices(newInvoices)

    if (result) {
      fetch('/api/invoices/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: result.sessionId, invoices: newInvoices }),
      }).catch(console.error)
    }
  }

  const downloadExcel = () => {
    if (!result) return
    window.open(`/api/invoices/${result.sessionId}/excel`, '_blank')
  }

  const downloadAllPdfs = () => {
    if (!result) return
    window.open(`/api/invoices/${result.sessionId}/all-pdfs`, '_blank')
  }

  const reset = () => {
    setResult(null)
    setInvoices([])
  }

  const totalDiscount = invoices.reduce((s, i) => s + (i.discount ?? 0), 0)
  const totalNewDue = invoices.reduce((s, i) => s + (i.newAmountDue ?? 0), 0)
  const totalOriginalDue = invoices.reduce((s, i) => s + (i.originalAmountDue ?? 0), 0)

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '28px 24px 60px' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '8px',
            backgroundColor: '#2563eb', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '16px', color: '#fff',
          }}>
            ⊡
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>
            Invoice Processor
          </h1>
        </div>
        <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0, paddingLeft: '48px' }}>
          Upload PDF invoices to automatically apply a 5% discount and export updated totals.
        </p>
      </div>

      {/* Upload Zone */}
      {!result && (
        <div>
          {/* Multi-invoice toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '14px', paddingLeft: '4px',
          }}>
            <button
              onClick={() => setSplitMulti(!splitMulti)}
              style={{
                position: 'relative', width: '36px', height: '20px',
                borderRadius: '10px', border: 'none', cursor: 'pointer',
                backgroundColor: splitMulti ? '#2563eb' : '#1e2d40',
                transition: 'background-color 0.2s',
              }}
            >
              <span style={{
                position: 'absolute', top: '2px', left: splitMulti ? '18px' : '2px',
                width: '16px', height: '16px', borderRadius: '50%',
                backgroundColor: '#fff', transition: 'left 0.2s',
              }} />
            </button>
            <div>
              <span style={{ fontSize: '13px', fontWeight: '500', color: '#e0e7f0' }}>
                Split multi-invoice PDF
              </span>
              <p style={{ fontSize: '12px', color: '#3a4a5e', margin: '2px 0 0' }}>
                When on, each page with its own totals is treated as a separate invoice
              </p>
            </div>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !processing && fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? '#2563eb' : '#1e2d40'}`,
              borderRadius: '14px', padding: '48px 24px', textAlign: 'center',
              cursor: processing ? 'not-allowed' : 'pointer',
              backgroundColor: dragging ? '#111d2e' : 'transparent',
              transition: 'all 0.2s',
              opacity: processing ? 0.6 : 1,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />

            {processing ? (
              <div>
                <div style={{ fontSize: '36px', marginBottom: '12px', animation: 'spin 1s linear infinite' }}>↻</div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#e0e7f0', margin: '0 0 4px' }}>Processing invoices…</p>
                <p style={{ fontSize: '12px', color: '#5a6e84', margin: 0 }}>Extracting totals and calculating discounts</p>
              </div>
            ) : (
              <div>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: dragging ? '#1e3a5f' : '#131a24',
                  transition: 'background-color 0.2s',
                }}>
                  <span style={{ fontSize: '24px', color: dragging ? '#60a5fa' : '#4a5a6e' }}>↑</span>
                </div>
                <p style={{ fontSize: '14px', fontWeight: '500', color: '#e0e7f0', margin: '0 0 4px' }}>
                  {dragging ? 'Drop your PDFs here' : 'Drag & drop PDF invoices'}
                </p>
                <p style={{ fontSize: '12px', color: '#5a6e84', margin: '0 0 12px' }}>or click to browse — batch upload supported</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                  {['PDF only', 'Up to 100 files', '50 MB per file'].map((t) => (
                    <span key={t} style={{
                      padding: '3px 10px', borderRadius: '4px', fontSize: '11px',
                      backgroundColor: '#131a24', color: '#5a6e84',
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Summary Cards */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '14px', marginBottom: '20px',
          }}>
            {[
              { label: 'Invoices Processed', value: result.totalFiles, color: '#e0e7f0',
                sub: `${result.successCount} success${result.failureCount > 0 ? ` · ${result.failureCount} failed` : ''}` },
              { label: 'Total Discount', value: formatCurrency(totalDiscount), color: '#4ade80', sub: '5% of sub-totals' },
              { label: 'Original Total Due', value: formatCurrency(totalOriginalDue), color: '#e0e7f0', sub: 'before discounts' },
              { label: 'New Total Due', value: formatCurrency(totalNewDue), color: '#60a5fa', sub: 'after discounts' },
            ].map((card, i) => (
              <div key={i} style={{
                backgroundColor: '#0f1620', border: '1px solid #182030',
                borderRadius: '14px', padding: '18px',
              }}>
                <div style={{ fontSize: '11px', color: '#4a5a6e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{card.label}</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: card.color, lineHeight: 1 }}>{card.value}</div>
                <div style={{ fontSize: '11px', color: '#4a5a6e', marginTop: '6px' }}>{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Action Bar */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            justifyContent: 'space-between', gap: '8px', marginBottom: '18px',
          }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={downloadExcel} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
                backgroundColor: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
              }}>
                ↓ Export to Excel
              </button>
              <button onClick={downloadAllPdfs} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '500',
                backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
              }}>
                ↓ Download All PDFs
              </button>
            </div>
            <button onClick={reset} style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: '500',
              backgroundColor: 'transparent', color: '#5a6e84', border: 'none', cursor: 'pointer',
            }}>
              ↻ Process new batch
            </button>
          </div>

          {/* Confidence legend */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px',
            fontSize: '12px', color: '#4a5a6e', marginBottom: '16px', paddingLeft: '4px',
          }}>
            <span style={{ fontWeight: '600' }}>Extraction confidence:</span>
            <span>✓ High — all values found</span>
            <span>⚡ Medium — some values found</span>
            <span>⚠ Low / Error — click to edit manually</span>
          </div>

          {/* Invoice Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {invoices.map((invoice, i) => (
              <InvoiceRow
                key={invoice.fileName + i}
                invoice={invoice}
                sessionId={result.sessionId}
                index={i}
                onUpdate={handleUpdateInvoice}
                onPreview={(url, name) => { setPreviewUrl(url); setPreviewName(name) }}
              />
            ))}
          </div>

          <p style={{ fontSize: '12px', color: '#3a4a5e', textAlign: 'center', marginTop: '16px' }}>
            Click any row to expand details and edit extracted values. Changes are reflected in downloads automatically.
          </p>
        </div>
      )}

      {/* How it works (shown when no results) */}
      {!result && !processing && (
        <div style={{ marginTop: '40px' }}>
          <h2 style={{
            fontSize: '12px', fontWeight: '600', color: '#4a5a6e',
            textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '16px',
          }}>
            How it works
          </h2>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}>
            {[
              { step: '1', title: 'Upload PDFs', desc: 'Drag & drop a batch of your invoices in one go' },
              { step: '2', title: 'Auto-Extract', desc: 'Sub-Total, Freight, Tax, and Amount Due are pulled from each invoice' },
              { step: '3', title: 'Apply Discount', desc: 'A 5% discount is calculated from the Sub-Total and subtracted from the Amount Due' },
              { step: '4', title: 'Export', desc: 'Download an Excel file with all totals, and updated PDFs with the discount added' },
            ].map((item) => (
              <div key={item.step} style={{
                display: 'flex', gap: '12px', padding: '16px',
                borderRadius: '10px', border: '1px solid #182030',
                backgroundColor: '#0f1620',
              }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                  backgroundColor: '#111d2e', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '12px', fontWeight: '700', color: '#60a5fa',
                }}>
                  {item.step}
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#e0e7f0', marginBottom: '4px' }}>{item.title}</div>
                  <div style={{ fontSize: '12px', color: '#5a6e84', lineHeight: '1.5' }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PDF Preview Modal */}
      {previewUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', flexDirection: 'column',
          backgroundColor: 'rgba(0,0,0,0.85)',
        }}>
          {/* Modal header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 18px', backgroundColor: '#0f1620',
            borderBottom: '1px solid #1e2d40', flexShrink: 0,
          }}>
            <span style={{ fontSize: '13px', fontWeight: '500', color: '#e0e7f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '400px' }}>
              {previewName.replace(/\.pdf$/i, '_with_discount.pdf')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => window.open(previewUrl.replace('?inline=true', ''), '_blank')}
                style={{
                  padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                  backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer',
                }}
              >
                ↓ Download
              </button>
              <button
                onClick={() => setPreviewUrl(null)}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '16px',
                  backgroundColor: 'transparent', color: '#5a6e84', border: 'none', cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {/* PDF iframe */}
          <iframe
            src={previewUrl}
            style={{ flex: 1, width: '100%', border: 'none' }}
            title="PDF Preview"
          />
        </div>
      )}

      {/* Spin animation for processing */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}