'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { useRole } from '../../../../lib/useRole'
import { slugify, KB_STATUS_META } from '../../../../lib/kb'
import { relativeTime } from '../../../../lib/helpdesk'

const input = {
  width: '100%', padding: '10px 14px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
  borderRadius: '8px', color: '#c0cad8', fontSize: '13.5px', outline: 'none', boxSizing: 'border-box',
}
const label = {
  display: 'block', fontSize: '11.5px', fontWeight: '600', color: '#5a6e84',
  textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
}
const emptyForm = { id: null, title: '', body: '', tags: '', status: 'draft' }

export default function KbManage() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = useRole()
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('list') // 'list' | 'edit'
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [linkTicketId, setLinkTicketId] = useState(null) // set when arriving from a ticket

  async function load() {
    const { data } = await supabase.from('kb_articles')
      .select('id, slug, title, status, updated_at, helpful_count, view_count')
      .order('updated_at', { ascending: false })
    setArticles(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Arriving from a ticket (?ticket=<id>): prefill a new article from the ticket
  // and remember to link it once saved. Read from window to avoid a Suspense
  // boundary requirement around useSearchParams.
  useEffect(() => {
    const tid = new URLSearchParams(window.location.search).get('ticket')
    if (!tid) return
    async function prefill() {
      const { data: t } = await supabase.from('tickets').select('id, title, description').eq('id', tid).single()
      if (!t) return
      setLinkTicketId(t.id)
      setForm({
        id: null,
        title: t.title,
        body: `## Problem\n\n${t.description || ''}\n\n## Resolution\n\n_Describe the fix here._`,
        tags: '',
        status: 'draft',
      })
      setMode('edit')
    }
    prefill()
  }, [])

  function openNew() { setForm(emptyForm); setMode('edit') }
  async function openEdit(a) {
    const { data } = await supabase.from('kb_articles').select('*').eq('id', a.id).single()
    if (data) { setForm({ id: data.id, title: data.title, body: data.body, tags: (data.tags || []).join(', '), status: data.status }); setMode('edit') }
  }
  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function save() {
    if (!form.title.trim()) return alert('Title is required')
    if (!form.body.trim()) return alert('Body is required')
    setSaving(true)
    const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean)
    const base = {
      title: form.title.trim(), body: form.body, tags, status: form.status,
      published_at: form.status === 'published' ? new Date().toISOString() : null,
    }

    let error, newId
    if (form.id) {
      ;({ error } = await supabase.from('kb_articles').update(base).eq('id', form.id))
    } else {
      let slug = slugify(form.title)
      let res = await supabase.from('kb_articles').insert({ ...base, slug, author_id: user?.id }).select('id').single()
      if (res.error && res.error.code === '23505') { // duplicate slug
        slug = `${slug}-${Date.now().toString(36).slice(-4)}`
        res = await supabase.from('kb_articles').insert({ ...base, slug, author_id: user?.id }).select('id').single()
      }
      error = res.error
      newId = res.data?.id
    }
    if (!error && newId && linkTicketId) {
      await supabase.from('kb_article_tickets').insert({ article_id: newId, ticket_id: linkTicketId, linked_by: user?.id })
    }
    setSaving(false)
    if (error) return alert('Error: ' + error.message)
    if (linkTicketId) { router.push(`/helpdesk/tickets/${linkTicketId}`); return }
    setMode('list'); load()
  }

  async function quickStatus(a, status) {
    const patch = { status, published_at: status === 'published' ? new Date().toISOString() : null }
    const { error } = await supabase.from('kb_articles').update(patch).eq('id', a.id)
    if (error) return alert('Error: ' + error.message)
    load()
  }
  async function del(a) {
    if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return
    const { error } = await supabase.from('kb_articles').delete().eq('id', a.id)
    if (error) return alert('Error: ' + error.message)
    load()
  }

  // ── Editor ──
  if (mode === 'edit') {
    return (
      <div style={{ padding: '24px 28px', maxWidth: '760px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 18px' }}>
          {form.id ? 'Edit article' : 'New article'}
        </h1>
        <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '22px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={label}>Title *</label>
            <input style={input} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Reconnecting a Zebra label printer" />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={label}>Body (markdown) *</label>
            <textarea style={{ ...input, minHeight: '260px', resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: '13px', lineHeight: 1.55 }}
              value={form.body} onChange={e => set('body', e.target.value)}
              placeholder={'# Heading\n\nSteps go here. Use **bold**, `code`, and:\n- bullet one\n- bullet two'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '14px', marginBottom: '22px' }}>
            <div>
              <label style={label}>Tags (comma-separated)</label>
              <input style={input} value={form.tags} onChange={e => set('tags', e.target.value)} placeholder="printer, hardware, shipping" />
            </div>
            <div>
              <label style={label}>Status</label>
              <select style={input} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button onClick={() => setMode('list')} style={btn('#131a24', '#8aa0b8', '#1e2d40')}>Cancel</button>
            <button onClick={save} disabled={saving} style={btn(saving ? '#1e40af' : '#2563eb', '#fff', 'transparent')}>
              {saving ? 'Saving…' : 'Save article'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── List ──
  return (
    <div style={{ padding: '24px 28px', maxWidth: '860px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Manage articles</h1>
          <Link href="/helpdesk/kb" style={{ fontSize: '12.5px', color: '#60a5fa', textDecoration: 'none' }}>← Back to Knowledge Base</Link>
        </div>
        <button onClick={openNew} style={btn('#2563eb', '#fff', 'transparent')}>+ New article</button>
      </div>

      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 90px 150px', gap: '10px', padding: '11px 18px', borderBottom: '1px solid #182030', fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <div>Title</div><div>Status</div><div>Helpful</div><div>Actions</div>
        </div>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
        ) : articles.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>No articles yet. Create your first one.</div>
        ) : articles.map(a => {
          const st = KB_STATUS_META[a.status]
          return (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 90px 150px', gap: '10px', padding: '12px 18px', borderBottom: '1px solid #131c28', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '14px', color: '#d0d8e4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                <div style={{ fontSize: '11px', color: '#5a6e84' }}>Updated {relativeTime(a.updated_at)} · {a.view_count || 0} views</div>
              </div>
              <div><span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, backgroundColor: st.pillBg, color: st.pillText }}>{st.label}</span></div>
              <div style={{ fontSize: '13px', color: '#8aa0b8' }}>{a.helpful_count || 0}</div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                <button onClick={() => openEdit(a)} style={linkBtn}>Edit</button>
                {a.status !== 'published'
                  ? <button onClick={() => quickStatus(a, 'published')} style={linkBtn}>Publish</button>
                  : <button onClick={() => quickStatus(a, 'archived')} style={linkBtn}>Archive</button>}
                <button onClick={() => del(a)} style={{ ...linkBtn, color: '#f87171' }}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function btn(bg, color, border) {
  return { padding: '10px 20px', borderRadius: '10px', fontSize: '13.5px', fontWeight: '600', backgroundColor: bg, color, border: `1px solid ${border}`, cursor: 'pointer' }
}
const linkBtn = { background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: '12px' }
