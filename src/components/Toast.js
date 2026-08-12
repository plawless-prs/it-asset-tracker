'use client'

import { useCallback, useState } from 'react'

// Minimal toast stack for the PRS Apps dark theme (Phase 7 polish: the spec
// asks for toasts on approve/export). Success-flavored, auto-dismissing —
// errors should stay inline where the user is looking, not in a toast.
//
//   const { toasts, toast } = useToasts()
//   toast('Approved — 1,204 lines ready for export.')
//   …
//   <Toasts toasts={toasts} />
export function useToasts() {
  const [toasts, setToasts] = useState([])
  const toast = useCallback((message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts(t => [...t, { id, message }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])
  return { toasts, toast }
}

export function Toasts({ toasts }) {
  if (!toasts.length) return null
  return (
    <div style={{
      position: 'fixed', right: '20px', bottom: '20px', zIndex: 2000,
      display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '420px',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #166534',
          borderRadius: '12px', padding: '12px 16px', fontSize: '13px', fontWeight: '500',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)', display: 'flex', gap: '10px', alignItems: 'flex-start',
        }}>
          <span aria-hidden style={{ fontWeight: '700' }}>✓</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
