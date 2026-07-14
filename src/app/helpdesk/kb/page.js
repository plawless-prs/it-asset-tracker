'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'

export default function KbBrowse() {
  const supabase = createClient()
  const [articles, setArticles] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('kb_articles')
        .select('id, slug, title, body, tags, helpful_count, updated_at, status, category:category_id(name)')
        .eq('status', 'published')
        .order('updated_at', { ascending: false })
      setArticles(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const needle = q.trim().toLowerCase()
  const filtered = needle
    ? articles.filter(a =>
        a.title.toLowerCase().includes(needle) ||
        (a.body || '').toLowerCase().includes(needle) ||
        (a.tags || []).some(t => t.toLowerCase().includes(needle)))
    : articles

  return (
    <div style={{ padding: '24px 28px', maxWidth: '860px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>Knowledge Base</h1>
        <Link href="/helpdesk/kb/manage" style={{
          fontSize: '13px', fontWeight: '600', color: '#8aa0b8', textDecoration: 'none',
          padding: '8px 14px', border: '1px solid #1e2d40', borderRadius: '8px',
        }}>Manage articles</Link>
      </div>
      <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 18px' }}>Internal IT reference.</p>

      <input
        value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search articles…"
        style={{
          width: '100%', padding: '11px 14px', backgroundColor: '#131a24', border: '1px solid #1e2d40',
          borderRadius: '10px', color: '#c0cad8', fontSize: '14px', outline: 'none', boxSizing: 'border-box', marginBottom: '18px',
        }}
      />

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#4a5a6e' }}>
          {articles.length === 0
            ? <>No published articles yet. <Link href="/helpdesk/kb/manage" style={{ color: '#60a5fa' }}>Write one →</Link></>
            : 'No articles match your search.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(a => (
            <Link key={a.id} href={`/helpdesk/kb/${a.slug}`} style={{ textDecoration: 'none' }}>
              <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '12px', padding: '16px 18px' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#1e3a5f'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#182030'}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#d0d8e4', marginBottom: '4px' }}>{a.title}</div>
                <div style={{ fontSize: '13px', color: '#5a6e84', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(a.body || '').replace(/[#*`>-]/g, '').slice(0, 120)}
                </div>
                <div style={{ fontSize: '11.5px', color: '#4a5a6e', marginTop: '8px' }}>
                  {a.category?.name ? `${a.category.name} · ` : ''}{a.helpful_count || 0} found this helpful
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
