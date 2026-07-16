'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import {
  PRIORITY_ORDER, PRIORITY_META, STATUS_ORDER, STATUS_META, SLA_META,
  slaState, slaCountdown, displayName, requesterLabel, relativeTime, initials, sendNotify,
  CATEGORY_OPTIONS, categoryLabel,
} from '../../../../lib/helpdesk'

const fieldSelect = {
  width: '100%', padding: '7px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '12.5px', outline: 'none', marginTop: '4px',
}

const TICKET_SELECT = '*, requester:requester_id(full_name,email), assignee:assignee_id(full_name,email)'

export default function TicketDetail() {
  const supabase = createClient()
  const router = useRouter()
  const { id } = useParams()
  const { user } = useRole()

  const [ticket, setTicket] = useState(null)
  const [comments, setComments] = useState([])
  const [activity, setActivity] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('details')
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const [linked, setLinked] = useState([])
  const [showDoc, setShowDoc] = useState(false)
  const [matches, setMatches] = useState([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)

  async function loadLinked() {
    const { data } = await supabase.from('kb_article_tickets')
      .select('id, article:article_id(id, slug, title, status)').eq('ticket_id', id)
    setLinked(data || [])
  }
  async function loadAttachments() {
    const { data } = await supabase.from('ticket_attachments')
      .select('id, file_name, file_size, storage_path, created_at').eq('ticket_id', id)
      .order('created_at')
    setAttachments(data || [])
  }
  async function uploadFile(file) {
    if (!file) return
    setUploading(true)
    const path = `${id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: upErr } = await supabase.storage.from('helpdesk-attachments').upload(path, file)
    if (upErr) { setUploading(false); return alert('Upload failed: ' + upErr.message) }
    const { error } = await supabase.from('ticket_attachments').insert({
      ticket_id: id, storage_path: path, file_name: file.name, file_size: file.size, uploaded_by: user?.id,
    })
    setUploading(false)
    if (error) return alert('Error: ' + error.message)
    loadAttachments()
  }
  async function downloadFile(a) {
    const { data, error } = await supabase.storage.from('helpdesk-attachments').createSignedUrl(a.storage_path, 60)
    if (error) return alert('Error: ' + error.message)
    window.open(data.signedUrl, '_blank')
  }
  async function deleteFile(a) {
    if (!confirm(`Remove ${a.file_name}?`)) return
    await supabase.storage.from('helpdesk-attachments').remove([a.storage_path])
    await supabase.from('ticket_attachments').delete().eq('id', a.id)
    loadAttachments()
  }
  async function loadActivity() {
    const { data } = await supabase.from('ticket_activity')
      .select('*, actor:actor_id(full_name,email)').eq('ticket_id', id)
      .order('created_at', { ascending: false })
    setActivity(data || [])
  }
  async function loadComments() {
    const { data } = await supabase.from('ticket_comments')
      .select('*, author:author_id(full_name,email)').eq('ticket_id', id)
      .order('created_at')
    setComments(data || [])
  }

  async function loadAll() {
    const [{ data: t }, , , , , { data: p }] = await Promise.all([
      supabase.from('tickets').select(TICKET_SELECT).eq('id', id).single(),
      loadComments(),
      loadActivity(),
      loadLinked(),
      loadAttachments(),
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
    ])
    setTicket(t)
    setProfiles(p || [])
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [id])

  // Open the "document this resolution" helper and fetch ranked KB matches.
  async function openDoc(t) {
    const src = t || ticket
    if (!src) return
    setShowDoc(true); setMatchLoading(true)
    const { data } = await supabase.rpc('search_kb', {
      qtext: `${src.title} ${src.description || ''}`, qtitle: src.title,
    })
    setMatches(data || []); setMatchLoading(false)
  }
  async function linkArticle(articleId) {
    const { error } = await supabase.from('kb_article_tickets')
      .insert({ article_id: articleId, ticket_id: id, linked_by: user?.id })
    if (error && error.code !== '23505') return alert('Error: ' + error.message)
    setShowDoc(false); loadLinked()
  }

  async function updateField(field, value) {
    const patch = { [field]: value }
    if (field === 'status' && value === 'resolved') patch.resolved_at = new Date().toISOString()
    if (field === 'status' && value === 'closed') patch.closed_at = new Date().toISOString()
    const from = ticket[field]
    const { error } = await supabase.from('tickets').update(patch).eq('id', id)
    if (error) return alert('Error: ' + error.message)
    await supabase.from('ticket_activity').insert({
      ticket_id: id, actor_id: user?.id, action: `${field}_changed`,
      from_value: String(from ?? ''), to_value: String(value ?? ''),
    })
    // Notify a newly assigned agent.
    if (field === 'assignee_id' && value) {
      const a = profiles.find(p => p.id === value)
      if (a?.email) sendNotify(supabase, {
        to: a.email,
        subject: `Ticket #${ticket.number} assigned to you: ${ticket.title}`,
        body: `You've been assigned Help Desk ticket #${ticket.number}.\n\n${ticket.title}\n\nOpen it: https://prstech.app/helpdesk/tickets/${id}`,
      })
    }
    // Re-fetch the ticket so DB-side changes (e.g. SLA due times recalculated by
    // the priority trigger) are reflected in the UI, not just the field we set.
    const { data: t } = await supabase.from('tickets').select(TICKET_SELECT).eq('id', id).single()
    if (t) setTicket(t)
    loadActivity()
    // Prompt to document the resolution in the KB (only if not already linked).
    if (field === 'status' && (value === 'resolved' || value === 'closed') && linked.length === 0) {
      openDoc(t)
    }
  }

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    const { error } = await supabase.from('ticket_comments').insert({
      ticket_id: id, author_id: user?.id, body: reply.trim(), is_internal: internal,
    })
    if (error) { setSending(false); return alert('Error: ' + error.message) }
    // Stamp first response on the first public reply
    if (!internal && !ticket.first_responded_at) {
      const stamp = new Date().toISOString()
      await supabase.from('tickets').update({ first_responded_at: stamp }).eq('id', id)
      setTicket(prev => ({ ...prev, first_responded_at: stamp }))
    }
    // Email the requester on a public reply (not internal notes).
    if (!internal) {
      sendNotify(supabase, {
        to: ticket.requester?.email || ticket.requester_email,
        subject: `Re: [#${ticket.number}] ${ticket.title}`,
        body: `${reply.trim()}\n\n—\nPRS Help Desk`,
      })
    }
    setReply(''); setInternal(false); setSending(false)
    loadComments()
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  if (!ticket) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      Ticket not found. <Link href="/helpdesk/tickets" style={{ color: '#60a5fa' }}>Back to queue</Link>
    </div>
  )

  const sla = SLA_META[slaState(ticket)]
  const resCd = slaCountdown(ticket.resolution_due)
  const frCd = slaCountdown(ticket.first_response_due)
  const isDone = ticket.status === 'resolved' || ticket.status === 'closed'

  return (
    <div style={{ padding: '20px 28px' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: '12.5px', color: '#5a6e84', marginBottom: '14px' }}>
        <Link href="/helpdesk/tickets" style={{ color: '#60a5fa', textDecoration: 'none' }}>Tickets</Link>
        {' / '}<span style={{ color: '#8aa0b8' }}>#{ticket.number}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: '18px', alignItems: 'start' }}>
        {/* ── Left: thread ── */}
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 0' }}>
            <span style={{ padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', backgroundColor: sla.pillBg, color: sla.pillText }}>{sla.label}</span>
            <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#e0e7f0', margin: '10px 0 4px' }}>{ticket.title}</h1>
            <div style={{ fontSize: '12.5px', color: '#5a6e84' }}>
              {requesterLabel(ticket)} reported {relativeTime(ticket.created_at)} · via {ticket.source}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '20px', padding: '14px 20px 0', borderBottom: '1px solid #182030' }}>
            {['details', 'activity'].map(tb => (
              <button key={tb} onClick={() => setTab(tb)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 10px',
                fontSize: '13px', fontWeight: '600', textTransform: 'capitalize',
                color: tab === tb ? '#60a5fa' : '#5a6e84',
                borderBottom: tab === tb ? '2px solid #2563eb' : '2px solid transparent',
              }}>{tb}{tb === 'activity' && activity.length ? ` (${activity.length})` : ''}</button>
            ))}
          </div>

          <div style={{ padding: '18px 20px' }}>
            {tab === 'details' ? (
              <>
                <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '6px' }}>Description</div>
                <div style={{ fontSize: '14px', color: '#c0cad8', lineHeight: '1.6', whiteSpace: 'pre-wrap', marginBottom: '22px' }}>{ticket.description}</div>

                {/* Attachments */}
                <div style={{ marginBottom: '22px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#5a6e84' }}>Attachments</div>
                    <label style={{ fontSize: '12px', color: '#60a5fa', cursor: uploading ? 'default' : 'pointer' }}>
                      {uploading ? 'Uploading…' : '+ Add file'}
                      <input type="file" style={{ display: 'none' }} disabled={uploading}
                        onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0]); e.target.value = '' }} />
                    </label>
                  </div>
                  {attachments.length === 0 ? (
                    <div style={{ fontSize: '12.5px', color: '#4a5a6e' }}>None.</div>
                  ) : attachments.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', backgroundColor: '#131a24', border: '1px solid #1e2d40', borderRadius: '8px', marginBottom: '6px' }}>
                      <button onClick={() => downloadFile(a)} style={{ background: 'none', border: 'none', color: '#c0cad8', cursor: 'pointer', fontSize: '13px', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        📎 {a.file_name} <span style={{ color: '#5a6e84' }}>({Math.max(1, Math.round((a.file_size || 0) / 1024))} KB)</span>
                      </button>
                      <button onClick={() => deleteFile(a)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>Remove</button>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '10px' }}>Conversation</div>
                {comments.length === 0 && <div style={{ fontSize: '13px', color: '#4a5a6e', marginBottom: '14px' }}>No replies yet.</div>}
                {comments.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                    <span style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, backgroundColor: c.is_internal ? '#332300' : '#10243f', color: c.is_internal ? '#fbbf24' : '#7fb4f5', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {initials(displayName(c.author))}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12.5px', marginBottom: '3px', color: '#8aa0b8' }}>
                        <span style={{ fontWeight: '600', color: '#c0cad8' }}>{displayName(c.author)}</span> · {relativeTime(c.created_at)}
                        {c.is_internal && <span style={{ marginLeft: '8px', fontSize: '10.5px', padding: '1px 7px', borderRadius: '999px', backgroundColor: '#332300', color: '#fbbf24' }}>internal note</span>}
                      </div>
                      <div style={{ fontSize: '13.5px', color: '#c0cad8', lineHeight: '1.55', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                    </div>
                  </div>
                ))}

                {/* Reply box */}
                <div style={{ marginTop: '14px', borderTop: '1px solid #182030', paddingTop: '14px' }}>
                  <textarea
                    value={reply} onChange={e => setReply(e.target.value)}
                    placeholder={internal ? 'Add an internal note (not visible to requester)…' : 'Write a reply…'}
                    style={{ width: '100%', minHeight: '70px', padding: '10px 12px', backgroundColor: '#131a24', border: `1px solid ${internal ? '#854d0e' : '#1e2d40'}`, borderRadius: '8px', color: '#c0cad8', fontSize: '13.5px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#8aa0b8', cursor: 'pointer' }}>
                      <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} style={{ accentColor: '#d97706', width: '15px', height: '15px' }} />
                      Internal note
                    </label>
                    <button onClick={sendReply} disabled={sending || !reply.trim()} style={{
                      padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', border: 'none',
                      backgroundColor: (sending || !reply.trim()) ? '#1e3a5f' : '#2563eb', color: '#fff',
                      cursor: (sending || !reply.trim()) ? 'not-allowed' : 'pointer',
                    }}>{sending ? 'Sending…' : (internal ? 'Add note' : 'Reply')}</button>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activity.length === 0 && <div style={{ fontSize: '13px', color: '#4a5a6e' }}>No activity yet.</div>}
                {activity.map(a => (
                  <div key={a.id} style={{ fontSize: '12.5px', color: '#8aa0b8' }}>
                    <span style={{ color: '#c0cad8', fontWeight: '600' }}>{displayName(a.actor)}</span>{' '}
                    {a.action.replace(/_/g, ' ')}{a.to_value ? ` → ${a.to_value}` : ''}
                    <span style={{ color: '#4a5a6e' }}> · {relativeTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: properties ── */}
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '16px' }}>
          {/* SLA box */}
          <div style={{ backgroundColor: '#131a24', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: STATUS_META[ticket.status].pillText, marginBottom: '10px' }}>{STATUS_META[ticket.status].label}</div>
            <div style={{ fontSize: '11px', color: '#5a6e84' }}>First response</div>
            <div style={{ fontSize: '12.5px', marginBottom: '8px', color: ticket.first_responded_at ? '#4ade80' : (frCd.breached ? '#f87171' : '#c0cad8') }}>
              {ticket.first_responded_at ? 'Responded' : frCd.text}
            </div>
            <div style={{ fontSize: '11px', color: '#5a6e84' }}>Resolution due</div>
            <div style={{ fontSize: '12.5px', color: isDone ? '#4ade80' : (resCd.breached ? '#f87171' : '#c0cad8') }}>
              {isDone ? 'Met' : resCd.text}
            </div>
          </div>

          <Field label="Status">
            <select style={fieldSelect} value={ticket.status} onChange={e => updateField('status', e.target.value)}>
              {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select style={fieldSelect} value={ticket.category || 'other'} onChange={e => updateField('category', e.target.value)}>
              {CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select style={fieldSelect} value={ticket.priority} onChange={e => updateField('priority', e.target.value)}>
              {PRIORITY_ORDER.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
          </Field>
          <Field label="Assignee">
            <select style={fieldSelect} value={ticket.assignee_id || ''} onChange={e => updateField('assignee_id', e.target.value || null)}>
              <option value="">Unassigned</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
            </select>
          </Field>

          <div style={{ borderTop: '1px solid #182030', marginTop: '14px', paddingTop: '14px' }}>
            <div style={{ fontSize: '11px', color: '#5a6e84', marginBottom: '6px' }}>Requester</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: '#332300', color: '#fbbf24', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(requesterLabel(ticket))}</span>
              <div>
                <div style={{ fontSize: '13px', color: '#c0cad8' }}>{requesterLabel(ticket)}</div>
                <div style={{ fontSize: '11px', color: '#5a6e84' }}>via {ticket.source}</div>
              </div>
            </div>
          </div>

          {/* Knowledge Base linking */}
          <div style={{ borderTop: '1px solid #182030', marginTop: '14px', paddingTop: '14px' }}>
            <div style={{ fontSize: '11px', color: '#5a6e84', marginBottom: '8px' }}>Knowledge Base</div>
            {linked.length > 0 ? linked.map(l => l.article && (
              <Link key={l.id} href={`/helpdesk/kb/${l.article.slug}`} style={{ display: 'block', fontSize: '12.5px', color: '#60a5fa', textDecoration: 'none', marginBottom: '6px' }}>
                📘 {l.article.title}
              </Link>
            )) : <div style={{ fontSize: '12px', color: '#4a5a6e', marginBottom: '8px' }}>Not documented yet.</div>}
            <button onClick={() => openDoc()} style={{ marginTop: '4px', width: '100%', padding: '8px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer' }}>
              {linked.length > 0 ? 'Link another article' : 'Document in KB'}
            </button>
          </div>
        </div>
      </div>

      {showDoc && (
        <DocModal
          matches={matches} loading={matchLoading}
          onLink={linkArticle}
          onNew={() => router.push(`/helpdesk/kb/manage?ticket=${id}`)}
          onClose={() => setShowDoc(false)}
        />
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: '#5a6e84' }}>{label}</div>
      {children}
    </div>
  )
}

function DocModal({ matches, loading, onLink, onNew, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        backgroundColor: '#0f1620', border: '1px solid #1e2d40', borderRadius: '16px',
        padding: '24px', maxWidth: '520px', width: '100%',
      }}>
        <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#e0e7f0', margin: '0 0 4px' }}>Document this resolution</h2>
        <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 18px' }}>
          Link this ticket to a similar article, or create a new one.
        </p>

        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#5a6e84', fontSize: '13px' }}>Searching articles…</div>
        ) : matches.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
            <div style={{ fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Similar articles</div>
            {matches.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px', backgroundColor: '#131a24', border: '1px solid #1e2d40', borderRadius: '10px' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13.5px', color: '#d0d8e4', fontWeight: 600 }}>{m.title}</div>
                  <div style={{ fontSize: '12px', color: '#5a6e84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.snippet}</div>
                </div>
                <button onClick={() => onLink(m.id)} style={{ flexShrink: 0, padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, backgroundColor: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>Link</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '16px', backgroundColor: '#131a24', borderRadius: '10px', marginBottom: '18px', fontSize: '13px', color: '#8aa0b8' }}>
            No similar article found. Consider creating one from this ticket.
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 500, backgroundColor: '#131a24', color: '#8aa0b8', border: '1px solid #1e2d40', cursor: 'pointer' }}>Skip</button>
          <button onClick={onNew} style={{ padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, backgroundColor: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>Create new article</button>
        </div>
      </div>
    </div>
  )
}
