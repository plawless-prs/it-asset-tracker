'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { useRole } from '../../../lib/useRole'
import {
  PRIORITY_META, STATUS_META, SLA_META, STATUS_ORDER, PRIORITY_ORDER,
  slaState, displayName, requesterLabel, relativeTime, initials,
} from '../../../lib/helpdesk'

const selectStyle = {
  padding: '7px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '12.5px', outline: 'none',
}

function Pill({ meta }) {
  return (
    <span style={{
      padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '600',
      backgroundColor: meta.pillBg, color: meta.pillText, whiteSpace: 'nowrap',
    }}>{meta.label}</span>
  )
}

export default function TicketQueue() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = useRole()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [fStatus, setFStatus] = useState('unresolved')
  const [fPriority, setFPriority] = useState('all')
  const [fAssignee, setFAssignee] = useState('all')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tickets')
        .select('id, number, title, status, priority, source, resolution_due, created_at, requester_id, requester_email, assignee_id, requester:requester_id(full_name,email), assignee:assignee_id(full_name,email)')
        .order('created_at', { ascending: false })
      setTickets(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = tickets.filter(t => {
    if (fStatus === 'unresolved' && (t.status === 'resolved' || t.status === 'closed')) return false
    if (fStatus !== 'unresolved' && fStatus !== 'all' && t.status !== fStatus) return false
    if (fPriority !== 'all' && t.priority !== fPriority) return false
    if (fAssignee === 'me' && (!user || t.assignee_id !== user.id)) return false
    if (fAssignee === 'unassigned' && t.assignee_id) return false
    return true
  })

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Tickets</h1>
          <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>{filtered.length} shown</p>
        </div>
        <Link href="/helpdesk/tickets/new" style={{
          backgroundColor: '#2563eb', color: '#fff', padding: '10px 18px', borderRadius: '10px',
          fontWeight: '600', fontSize: '13px', textDecoration: 'none',
        }}>+ New ticket</Link>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <select style={selectStyle} value={fStatus} onChange={e => setFStatus(e.target.value)}>
          <option value="unresolved">Unresolved</option>
          <option value="all">All statuses</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select style={selectStyle} value={fPriority} onChange={e => setFPriority(e.target.value)}>
          <option value="all">All priorities</option>
          {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
        </select>
        <select style={selectStyle} value={fAssignee} onChange={e => setFAssignee(e.target.value)}>
          <option value="all">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 110px 120px 110px 150px', gap: '10px',
          padding: '11px 18px', borderBottom: '1px solid #182030', fontSize: '11px',
          color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <div>Subject</div><div>SLA</div><div>Status</div><div>Priority</div><div>Assignee</div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>
            No tickets match. <Link href="/helpdesk/tickets/new" style={{ color: '#60a5fa' }}>Log one →</Link>
          </div>
        ) : filtered.map(t => {
          const sla = SLA_META[slaState(t)]
          const prio = PRIORITY_META[t.priority]
          return (
            <div
              key={t.id}
              onClick={() => router.push(`/helpdesk/tickets/${t.id}`)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 110px 120px 110px 150px', gap: '10px',
                padding: '13px 18px', borderBottom: '1px solid #131c28', alignItems: 'center', cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#111b27'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: '11.5px', color: '#5a6e84' }}>
                  <span style={{ color: '#60a5fa' }}>#{t.number}</span> · {requesterLabel(t)} · {relativeTime(t.created_at)}
                </div>
              </div>
              <div><Pill meta={sla} /></div>
              <div style={{ fontSize: '12.5px', color: STATUS_META[t.status].pillText }}>{STATUS_META[t.status].label}</div>
              <div style={{ fontSize: '12.5px', color: '#c0cad8' }}>
                <span style={{ color: prio.dot, marginRight: '6px' }}>●</span>{prio.label}
              </div>
              <div style={{ fontSize: '12.5px', color: t.assignee ? '#c0cad8' : '#4a5a6e', display: 'flex', alignItems: 'center', gap: '7px' }}>
                {t.assignee ? (
                  <>
                    <span style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#10243f', color: '#7fb4f5', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials(displayName(t.assignee))}
                    </span>
                    {displayName(t.assignee).split(' ')[0]}
                  </>
                ) : 'Unassigned'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
