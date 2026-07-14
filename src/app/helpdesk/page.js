'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '../../lib/supabase'
import { useRole } from '../../lib/useRole'
import {
  PRIORITY_META, STATUS_META, PRIORITY_ORDER, isUnresolved,
} from '../../lib/helpdesk'

// ─── Donut (dependency-free SVG ring) ───────────────────────────────────────
function Donut({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  const size = 132, stroke = 18, r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2433" strokeWidth={stroke} />
          {total > 0 && segments.map((seg, i) => {
            if (seg.value === 0) return null
            const len = (seg.value / total) * circ
            const el = (
              <circle
                key={i}
                cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={seg.color} strokeWidth={stroke}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return el
          })}
        </g>
        <text x="50%" y="47%" textAnchor="middle" fill="#e0e7f0" fontSize="22" fontWeight="700">{total}</text>
        <text x="50%" y="60%" textAnchor="middle" fill="#5a6e84" fontSize="10">Tickets</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#8aa0b8' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '50%', backgroundColor: seg.color }} />
            {seg.label} <span style={{ color: '#5a6e84' }}>({seg.value})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricCard({ label, value, accent }) {
  return (
    <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color: accent || '#e0e7f0' }}>{value}</div>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '18px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#c0cad8', marginBottom: '16px' }}>{title}</div>
      {children}
    </div>
  )
}

export default function HelpdeskDashboard() {
  const supabase = createClient()
  const { user } = useRole()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('ticket_list_view').select('*')
      setTickets(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const unresolved = tickets.filter(t => isUnresolved(t.status))

  const metrics = {
    overdue: tickets.filter(t => t.sla_state === 'overdue').length,
    dueToday: tickets.filter(t => t.sla_state === 'due_today').length,
    open: tickets.filter(t => t.status === 'open').length,
    onHold: tickets.filter(t => t.status === 'waiting').length,
    unassigned: unresolved.filter(t => !t.assignee_id).length,
    mine: unresolved.filter(t => user && t.assignee_id === user.id).length,
  }

  const prioritySegments = PRIORITY_ORDER
    .map(p => ({ label: PRIORITY_META[p].label, value: unresolved.filter(t => t.priority === p).length, color: PRIORITY_META[p].dot }))
    .filter(s => s.value > 0)

  const statusSegments = ['open', 'in_progress', 'waiting']
    .map(s => ({ label: STATUS_META[s].label, value: unresolved.filter(t => t.status === s).length, color: STATUS_META[s].color }))
    .filter(s => s.value > 0)

  const maxPrio = Math.max(1, ...PRIORITY_ORDER.map(p => unresolved.filter(t => t.priority === p).length))

  return (
    <div style={{ padding: '24px 28px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Help Desk</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>Dashboard</p>
        </div>
        <Link href="/helpdesk/tickets/new" style={{
          backgroundColor: '#2563eb', color: '#fff', padding: '10px 18px', borderRadius: '10px',
          fontWeight: '600', fontSize: '13px', textDecoration: 'none',
        }}>+ New ticket</Link>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading tickets…</div>
      ) : (
        <>
          {/* Metric cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <MetricCard label="Overdue" value={metrics.overdue} accent={metrics.overdue ? '#f87171' : undefined} />
            <MetricCard label="Due today" value={metrics.dueToday} accent={metrics.dueToday ? '#fbbf24' : undefined} />
            <MetricCard label="Open" value={metrics.open} />
            <MetricCard label="On hold" value={metrics.onHold} />
            <MetricCard label="Unassigned" value={metrics.unassigned} accent={metrics.unassigned ? '#f87171' : undefined} />
            <MetricCard label="Assigned to me" value={metrics.mine} />
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <Panel title="Unresolved by priority">
              {prioritySegments.length ? <Donut segments={prioritySegments} /> : <Empty />}
            </Panel>
            <Panel title="Unresolved by status">
              {statusSegments.length ? <Donut segments={statusSegments} /> : <Empty />}
            </Panel>
          </div>

          {/* Priority bars */}
          <Panel title="Unresolved tickets by priority">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {PRIORITY_ORDER.map(p => {
                const count = unresolved.filter(t => t.priority === p).length
                const meta = PRIORITY_META[p]
                return (
                  <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ width: '64px', fontSize: '12px', color: '#8aa0b8' }}>{meta.label}</span>
                    <div style={{ flex: 1, height: '9px', backgroundColor: '#131a24', borderRadius: '999px' }}>
                      <div style={{ width: `${(count / maxPrio) * 100}%`, height: '9px', backgroundColor: meta.dot, borderRadius: '999px' }} />
                    </div>
                    <span style={{ width: '24px', fontSize: '12px', color: '#c0cad8', textAlign: 'right' }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}

function Empty() {
  return <div style={{ fontSize: '13px', color: '#4a5a6e', padding: '24px 0' }}>No unresolved tickets.</div>
}
