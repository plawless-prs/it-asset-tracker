'use client'

import { useMemo, useState } from 'react'
import { createClient } from '../lib/supabase'
import {
  BATCH_STATUS_META, attentionPill, batchReadiness, daysUntil, todayCentral,
  formatDate,
} from '../lib/priceupdates'

// Outlook-style month calendar for batch scheduling. Batches sit on their
// effective_date as status-colored pills; an agenda panel lists overdue +
// upcoming work. Interactions: click a pill for a peek card, drag a pill to
// another day to reschedule (confirmed), click an empty day to create a batch
// with that effective date prefilled.
//
// Props:
//   batches       full batch list (needs effective_date, status, counts, vendor)
//   onOpen(b)     navigate to a batch
//   onCreate(iso) open the New Batch modal prefilled with the clicked day
//   onChanged()   reload after a reschedule
export default function BatchCalendar({ batches, onOpen, onCreate, onChanged }) {
  const supabase = createClient()
  const today = todayCentral()
  const [month, setMonth] = useState(() => today.slice(0, 7))   // 'YYYY-MM'
  const [peek, setPeek] = useState(null)                        // { batch, x, y }
  const [dragId, setDragId] = useState(null)
  const [dropDay, setDropDay] = useState(null)

  const scheduled = useMemo(
    () => (batches || []).filter(b => b.effective_date),
    [batches]
  )
  const byDay = useMemo(() => {
    const m = new Map()
    for (const b of scheduled) {
      const k = String(b.effective_date).slice(0, 10)
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(b)
    }
    return m
  }, [scheduled])

  // 6 rows × 7 cols starting the Sunday on/before the 1st.
  const weeks = useMemo(() => {
    const [y, mo] = month.split('-').map(Number)
    const first = new Date(Date.UTC(y, mo - 1, 1))
    const start = new Date(first)
    start.setUTCDate(1 - first.getUTCDay())
    const out = []
    for (let w = 0; w < 6; w++) {
      const row = []
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start)
        cur.setUTCDate(start.getUTCDate() + w * 7 + d)
        row.push({
          iso: cur.toISOString().slice(0, 10),
          day: cur.getUTCDate(),
          inMonth: cur.getUTCMonth() === mo - 1,
        })
      }
      out.push(row)
    }
    return out
  }, [month])

  function shiftMonth(delta) {
    const [y, mo] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
    setMonth(d.toISOString().slice(0, 7))
    setPeek(null)
  }

  async function reschedule(batch, iso) {
    setDragId(null); setDropDay(null)
    if (String(batch.effective_date).slice(0, 10) === iso) return
    const ok = window.confirm(
      `Move batch #${batch.number}${batch.vendor ? ` (${batch.vendor.name})` : ''} ` +
      `from ${formatDate(batch.effective_date)} to ${formatDate(iso)}?`
    )
    if (!ok) return
    const { error } = await supabase.from('pu_batches').update({ effective_date: iso }).eq('id', batch.id)
    if (!error) onChanged?.()
  }

  const monthLabel = new Date(`${month}-01T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const agenda = useMemo(() => {
    const open = scheduled.filter(b => !['applied', 'archived'].includes(b.status))
    return {
      overdue: open.filter(b => daysUntil(b.effective_date, today) < 0)
        .sort((a, b) => a.effective_date.localeCompare(b.effective_date)),
      upcoming: open.filter(b => daysUntil(b.effective_date, today) >= 0)
        .sort((a, b) => a.effective_date.localeCompare(b.effective_date)),
    }
  }, [scheduled, today])

  const draggable = (b) => !['applied', 'archived'].includes(b.status)
  const readyDot = (b) => {
    const r = batchReadiness(b)
    if (r === 'done') return null
    return (
      <span title={r === 'ready' ? 'Ready for its effective date' : 'Needs prep (not yet approved/exported)'} style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        backgroundColor: r === 'ready' ? '#4ade80' : '#fbbf24',
      }} />
    )
  }

  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
      {/* Month grid */}
      <div style={{ flex: 1, minWidth: 0, backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid #182030' }}>
          <button onClick={() => { setMonth(today.slice(0, 7)); setPeek(null) }} style={{
            padding: '6px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: '600',
            backgroundColor: '#131a24', color: '#60a5fa', border: '1px solid #1e3a5f', cursor: 'pointer',
          }}>Today</button>
          <button onClick={() => shiftMonth(-1)} style={{ background: 'none', border: 'none', color: '#8aa0b8', fontSize: '16px', cursor: 'pointer', padding: '2px 8px' }}>◀</button>
          <button onClick={() => shiftMonth(1)} style={{ background: 'none', border: 'none', color: '#8aa0b8', fontSize: '16px', cursor: 'pointer', padding: '2px 8px' }}>▶</button>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#e0e7f0' }}>{monthLabel}</div>
          <div style={{ marginLeft: 'auto', fontSize: '11.5px', color: '#5a6e84' }}>
            Click a day to schedule a batch · drag a batch to reschedule
          </div>
        </div>

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid #182030' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} style={{ padding: '7px 10px', fontSize: '11px', fontWeight: '600', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d}</div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((row, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: wi < 5 ? '1px solid #131c28' : 'none' }}>
            {row.map(cell => {
              const items = byDay.get(cell.iso) || []
              const isToday = cell.iso === today
              const isDropTarget = dropDay === cell.iso && dragId
              return (
                <div
                  key={cell.iso}
                  onClick={(e) => { if (e.target === e.currentTarget) onCreate?.(cell.iso) }}
                  onDragOver={(e) => { e.preventDefault(); setDropDay(cell.iso) }}
                  onDragLeave={() => { if (dropDay === cell.iso) setDropDay(null) }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const b = scheduled.find(x => x.id === dragId)
                    if (b) reschedule(b, cell.iso)
                  }}
                  style={{
                    minHeight: '96px', padding: '6px', borderRight: '1px solid #131c28',
                    backgroundColor: isDropTarget ? '#12233a' : isToday ? '#101d2c' : 'transparent',
                    cursor: 'pointer', overflow: 'hidden',
                  }}
                >
                  <div style={{
                    fontSize: '12px', fontWeight: isToday ? '700' : '500', marginBottom: '4px',
                    color: isToday ? '#60a5fa' : cell.inMonth ? '#8aa0b8' : '#3a4a5e',
                    pointerEvents: 'none',
                  }}>
                    {isToday ? (
                      <span style={{ backgroundColor: '#1e3a5f', borderRadius: '999px', padding: '2px 7px' }}>{cell.day}</span>
                    ) : cell.day}
                  </div>
                  {items.map(b => {
                    const meta = BATCH_STATUS_META[b.status] || BATCH_STATUS_META.received
                    return (
                      <div
                        key={b.id}
                        draggable={draggable(b)}
                        onDragStart={() => { setDragId(b.id); setPeek(null) }}
                        onDragEnd={() => { setDragId(null); setDropDay(null) }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPeek(peek?.batch?.id === b.id ? null : { batch: b, x: e.clientX, y: e.clientY })
                        }}
                        title={`#${b.number} ${b.vendor?.name || 'Unidentified'} — ${meta.label}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '3px 7px', borderRadius: '6px', marginBottom: '3px',
                          backgroundColor: meta.pillBg, color: meta.pillText,
                          fontSize: '11px', fontWeight: '600', whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: draggable(b) ? 'grab' : 'pointer',
                          opacity: dragId === b.id ? 0.4 : 1,
                        }}
                      >
                        {readyDot(b)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          #{b.number} {b.vendor?.name || 'Unidentified'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Agenda */}
      <div style={{ width: '270px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {agenda.overdue.length > 0 && (
          <AgendaCard title={`Overdue (${agenda.overdue.length})`} titleColor="#f87171">
            {agenda.overdue.map(b => (
              <AgendaRow key={b.id} batch={b} today={today} onOpen={onOpen} readyDot={readyDot} />
            ))}
          </AgendaCard>
        )}
        <AgendaCard title="Upcoming" titleColor="#c0cad8">
          {agenda.upcoming.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#4a5a6e', padding: '4px 0' }}>Nothing scheduled.</div>
          ) : agenda.upcoming.map(b => (
            <AgendaRow key={b.id} batch={b} today={today} onOpen={onOpen} readyDot={readyDot} />
          ))}
        </AgendaCard>
      </div>

      {/* Peek card */}
      {peek && (
        <PeekCard peek={peek} today={today} onOpen={onOpen} onClose={() => setPeek(null)} />
      )}
    </div>
  )
}

function AgendaCard({ title, titleColor, children }) {
  return (
    <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '12px 14px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: '700', color: titleColor, marginBottom: '8px' }}>{title}</div>
      {children}
    </div>
  )
}

function AgendaRow({ batch: b, today, onOpen, readyDot }) {
  const meta = BATCH_STATUS_META[b.status] || BATCH_STATUS_META.received
  const d = daysUntil(b.effective_date, today)
  const when = d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`
  return (
    <div
      onClick={() => onOpen?.(b)}
      style={{ padding: '7px 8px', borderRadius: '8px', cursor: 'pointer', marginBottom: '2px' }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#111b27'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
        {readyDot(b)}
        <span style={{ fontSize: '12.5px', fontWeight: '600', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.vendor?.name || 'Unidentified'}
        </span>
      </div>
      <div style={{ fontSize: '11.5px', color: d < 0 ? '#f87171' : '#5a6e84' }}>
        #{b.number} · {formatDate(b.effective_date)} ({when}) ·{' '}
        <span style={{ color: meta.pillText }}>{meta.label}</span>
      </div>
    </div>
  )
}

function PeekCard({ peek, today, onOpen, onClose }) {
  const b = peek.batch
  const meta = BATCH_STATUS_META[b.status] || BATCH_STATUS_META.received
  const attn = attentionPill(b)
  const unmatched = (b.line_count || 0) - (b.matched_count || 0)
  // Keep the card inside the viewport.
  const left = Math.min(peek.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 320)
  const top = Math.min(peek.y + 8, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240)
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 900 }} />
      <div style={{
        position: 'fixed', left, top, zIndex: 901, width: '300px',
        backgroundColor: '#101823', border: '1px solid #24344a', borderRadius: '12px',
        padding: '14px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#e0e7f0' }}>{b.vendor?.name || 'Unidentified vendor'}</div>
            <div style={{ fontSize: '12px', color: '#5a6e84' }}>Batch #{b.number}</div>
          </div>
          <span style={{ padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', backgroundColor: meta.pillBg, color: meta.pillText }}>
            {meta.label}
          </span>
        </div>
        <div style={{ fontSize: '12.5px', color: '#8aa0b8', display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' }}>
          <div>Effective {formatDate(b.effective_date)} ({(() => { const d = daysUntil(b.effective_date, today); return d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d` })()})</div>
          <div>{b.line_count || 0} lines · {b.matched_count || 0} matched{unmatched > 0 ? ` · ${unmatched} unmatched` : ''}{b.flagged_count > 0 ? ` · ${b.flagged_count} flagged` : ''}</div>
          {attn && <div style={{ color: attn.pillText }}>{attn.label}</div>}
        </div>
        <button onClick={() => onOpen?.(b)} style={{
          width: '100%', padding: '8px 0', borderRadius: '8px', fontSize: '12.5px', fontWeight: '600',
          backgroundColor: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer',
        }}>Open batch</button>
      </div>
    </>
  )
}
