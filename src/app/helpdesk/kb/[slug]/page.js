'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '../../../../lib/supabase'
import { parseMarkdown, parseInline, KB_STATUS_META } from '../../../../lib/kb'
import { relativeTime, STATUS_META } from '../../../../lib/helpdesk'

function Inline({ text }) {
  return parseInline(text).map((seg, i) =>
    seg.b ? <strong key={i} style={{ color: '#e0e7f0', fontWeight: 700 }}>{seg.t}</strong>
    : seg.c ? <code key={i} style={{ backgroundColor: '#131a24', padding: '1px 5px', borderRadius: '4px', fontSize: '0.9em', color: '#93c5fd' }}>{seg.t}</code>
    : <span key={i}>{seg.t}</span>)
}

function Markdown({ body }) {
  const blocks = parseMarkdown(body)
  return blocks.map((b, i) => {
    if (b.type === 'h1') return <h2 key={i} style={{ fontSize: '19px', fontWeight: 700, color: '#e0e7f0', margin: '22px 0 8px' }}><Inline text={b.text} /></h2>
    if (b.type === 'h2') return <h3 key={i} style={{ fontSize: '16px', fontWeight: 700, color: '#dbe3ee', margin: '18px 0 6px' }}><Inline text={b.text} /></h3>
    if (b.type === 'h3') return <h4 key={i} style={{ fontSize: '14px', fontWeight: 700, color: '#c8d3e0', margin: '14px 0 6px' }}><Inline text={b.text} /></h4>
    if (b.type === 'ul') return (
      <ul key={i} style={{ margin: '8px 0', paddingLeft: '22px', color: '#c0cad8' }}>
        {b.items.map((it, j) => <li key={j} style={{ marginBottom: '5px', lineHeight: 1.55 }}><Inline text={it} /></li>)}
      </ul>
    )
    return <p key={i} style={{ margin: '10px 0', color: '#c0cad8', lineHeight: 1.7, fontSize: '14.5px' }}><Inline text={b.text} /></p>
  })
}

export default function KbArticle() {
  const supabase = createClient()
  const { slug } = useParams()
  const [article, setArticle] = useState(null)
  const [related, setRelated] = useState([])
  const [loading, setLoading] = useState(true)
  const [voted, setVoted] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('kb_articles').select('*').eq('slug', slug).single()
      setArticle(data || null)
      setLoading(false)
      if (data) {
        // best-effort view count bump
        supabase.from('kb_articles').update({ view_count: (data.view_count || 0) + 1 }).eq('id', data.id)
        // related tickets that fed this article
        const { data: rel } = await supabase.from('kb_article_tickets')
          .select('id, ticket:ticket_id(id, number, title, status)').eq('article_id', data.id)
        setRelated(rel || [])
      }
    }
    load()
  }, [slug])

  async function vote(helpful) {
    if (!article || voted) return
    const patch = helpful
      ? { helpful_count: (article.helpful_count || 0) + 1 }
      : { not_helpful: (article.not_helpful || 0) + 1 }
    await supabase.from('kb_articles').update(patch).eq('id', article.id)
    setArticle(a => ({ ...a, ...patch }))
    setVoted(true)
  }

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
  if (!article) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#5a6e84' }}>
      Article not found. <Link href="/helpdesk/kb" style={{ color: '#60a5fa' }}>Back to Knowledge Base</Link>
    </div>
  )

  const st = KB_STATUS_META[article.status]

  return (
    <div style={{ padding: '20px 28px', maxWidth: '760px' }}>
      <div style={{ fontSize: '12.5px', color: '#5a6e84', marginBottom: '16px' }}>
        <Link href="/helpdesk/kb" style={{ color: '#60a5fa', textDecoration: 'none' }}>Knowledge Base</Link>
        {' / '}<span style={{ color: '#8aa0b8' }}>{article.title}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#e0e7f0', margin: 0 }}>{article.title}</h1>
        {article.status !== 'published' && (
          <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, backgroundColor: st.pillBg, color: st.pillText }}>{st.label}</span>
        )}
      </div>
      <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '20px' }}>Updated {relativeTime(article.updated_at)}</div>

      <div style={{ backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '22px 26px' }}>
        <Markdown body={article.body} />
      </div>

      {/* Related tickets */}
      {related.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={{ fontSize: '12px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            Related tickets ({related.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {related.filter(r => r.ticket).map(r => (
              <Link key={r.id} href={`/helpdesk/tickets/${r.ticket.id}`} style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '11px 14px', backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '10px' }}>
                  <div style={{ fontSize: '13.5px', color: '#c0cad8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: '#60a5fa' }}>#{r.ticket.number}</span> {r.ticket.title}
                  </div>
                  <span style={{ flexShrink: 0, fontSize: '11px', color: STATUS_META[r.ticket.status]?.pillText || '#8aa0b8' }}>
                    {STATUS_META[r.ticket.status]?.label || r.ticket.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Helpful vote */}
      <div style={{ marginTop: '18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        {voted ? (
          <span style={{ fontSize: '13px', color: '#4ade80' }}>Thanks for the feedback.</span>
        ) : (
          <>
            <span style={{ fontSize: '13px', color: '#8aa0b8' }}>Was this helpful?</span>
            <button onClick={() => vote(true)} style={voteBtn}>Yes</button>
            <button onClick={() => vote(false)} style={voteBtn}>No</button>
          </>
        )}
      </div>
    </div>
  )
}

const voteBtn = {
  padding: '6px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
  backgroundColor: '#131a24', color: '#c0cad8', border: '1px solid #1e2d40', cursor: 'pointer',
}
