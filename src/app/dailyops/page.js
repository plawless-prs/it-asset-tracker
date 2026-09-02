'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'
import { useRole } from '../../lib/useRole'
import { todayCentral } from '../../lib/priceupdates'
import { isTemplateDue, personLabel } from '../../lib/dailyops'

// Today's view: every active template due today renders as a checklist card.
// Instances are created LAZILY on page load (upsert today's sop_instances +
// sop_item_status rows — no cron): first person in creates them, everyone
// else picks up the same shared state. Checking an item stamps who/when;
// when all required items are checked the instance flips to done.
export default function DailyOpsToday() {
  const supabase = createClient()
  const { user } = useRole()
  const [cards, setCards] = useState(null)   // [{ instance, template, items:[{ti, status}] }]
  const [people, setPeople] = useState({})   // profile id -> {full_name, email}
  const [error, setError] = useState('')
  const today = todayCentral()

  async function load() {
    setError('')
    try {
      const { data: templates, error: tErr } = await supabase
        .from('sop_templates')
        .select('id, title, description, frequency, sort_order, items:sop_template_items(id, label, instructions, required, sort_order)')
        .eq('active', true)
        .order('sort_order')
      if (tErr) throw tErr
      const due = (templates || []).filter(t => isTemplateDue(t.frequency, today))

      // Lazy instance creation — ignoreDuplicates keeps concurrent loads safe
      // (unique on template_id + due_date).
      if (due.length) {
        const { error: iErr } = await supabase.from('sop_instances').upsert(
          due.map(t => ({ template_id: t.id, due_date: today })),
          { onConflict: 'template_id,due_date', ignoreDuplicates: true },
        )
        if (iErr) throw iErr
      }
      const { data: instances, error: gErr } = await supabase
        .from('sop_instances')
        .select('id, template_id, status, completed_at')
        .eq('due_date', today)
      if (gErr) throw gErr

      // Seed the per-item checkbox rows for the instances we just ensured.
      const seedRows = []
      for (const inst of instances || []) {
        const t = (templates || []).find(x => x.id === inst.template_id)
        for (const it of t?.items || []) seedRows.push({ instance_id: inst.id, template_item_id: it.id })
      }
      if (seedRows.length) {
        const { error: sErr } = await supabase.from('sop_item_status').upsert(
          seedRows, { onConflict: 'instance_id,template_item_id', ignoreDuplicates: true },
        )
        if (sErr) throw sErr
      }
      const { data: statuses, error: stErr } = await supabase
        .from('sop_item_status')
        .select('id, instance_id, template_item_id, checked, checked_by, checked_at')
        .in('instance_id', (instances || []).map(i => i.id))
      if (stErr) throw stErr

      const checkerIds = [...new Set((statuses || []).map(s => s.checked_by).filter(Boolean))]
      if (checkerIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', checkerIds)
        setPeople(Object.fromEntries((profs || []).map(p => [p.id, p])))
      }

      const built = (instances || []).map(inst => {
        const template = (templates || []).find(t => t.id === inst.template_id)
        if (!template) return null   // instance of a since-deactivated/deleted template
        const items = [...(template.items || [])]
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(ti => ({ ti, status: (statuses || []).find(s => s.instance_id === inst.id && s.template_item_id === ti.id) }))
        return { instance: inst, template, items }
      }).filter(Boolean).sort((a, b) => a.template.sort_order - b.template.sort_order)
      setCards(built)
    } catch (e) {
      setError(e.message || 'Could not load today’s checklists')
      setCards([])
    }
  }

  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  async function toggle(card, row) {
    const nowChecked = !row.status?.checked
    const patch = {
      checked: nowChecked,
      checked_by: nowChecked ? (user?.id || null) : null,
      checked_at: nowChecked ? new Date().toISOString() : null,
    }
    // Optimistic update, then persist.
    setCards(cs => cs.map(c => c !== card ? c : {
      ...c,
      items: c.items.map(r => r !== row ? r : { ...r, status: { ...r.status, ...patch } }),
    }))
    const { error: e } = await supabase.from('sop_item_status').update(patch).eq('id', row.status.id)
    if (e) { setError(`Save failed: ${e.message}`); return load() }
    if (nowChecked && user && !people[user.id]) setPeople(p => ({ ...p, [user.id]: { email: user.email } }))

    // Instance status is derived from required items: all checked -> done.
    const after = card.items.map(r => r === row ? { ...r, status: { ...r.status, ...patch } } : r)
    const allDone = after.filter(r => r.ti.required).every(r => r.status?.checked)
    const nextStatus = allDone ? 'done' : 'todo'
    if (nextStatus !== card.instance.status) {
      const { error: iErr } = await supabase.from('sop_instances').update({
        status: nextStatus,
        completed_at: allDone ? new Date().toISOString() : null,
      }).eq('id', card.instance.id)
      if (!iErr) {
        setCards(cs => cs.map(c => c.instance.id !== card.instance.id ? c : {
          ...c, instance: { ...c.instance, status: nextStatus },
        }))
      }
    }
  }

  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '16px 18px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '880px' }}>
      <div style={{ marginBottom: '18px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 2px' }}>Today</h1>
        <p style={{ fontSize: '13px', color: '#5a6e84', margin: 0 }}>
          {new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {error && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}

      {cards === null ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : cards.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px', color: '#4a5a6e', fontSize: '13px' }}>
          Nothing due today. <Link href="/dailyops/templates" style={{ color: '#60a5fa' }}>Create a checklist template</Link> to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {cards.map(c => {
            const doneCount = c.items.filter(r => r.status?.checked).length
            const finished = c.instance.status === 'done'
            return (
              <div key={c.instance.id} style={{ ...card, borderColor: finished ? '#14532d' : '#182030' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#e0e7f0' }}>
                    {c.template.title}
                    {finished && <span style={{ marginLeft: '10px', padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: '600', backgroundColor: '#0d3320', color: '#4ade80' }}>Complete</span>}
                  </div>
                  <span style={{ fontSize: '12px', color: doneCount === c.items.length ? '#4ade80' : '#8aa0b8' }}>{doneCount}/{c.items.length}</span>
                </div>
                {c.template.description && <div style={{ fontSize: '12px', color: '#5a6e84', marginBottom: '8px' }}>{c.template.description}</div>}
                {/* Progress bar */}
                <div style={{ height: '4px', borderRadius: '999px', backgroundColor: '#131c28', marginBottom: '12px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${c.items.length ? (doneCount / c.items.length) * 100 : 0}%`, backgroundColor: finished ? '#22c55e' : '#2563eb', transition: 'width 0.2s' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {c.items.map(r => (
                    <label key={r.ti.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '9px 4px',
                      borderBottom: '1px solid #131c28', cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={!!r.status?.checked}
                        onChange={() => toggle(c, r)}
                        style={{ accentColor: '#22c55e', width: '18px', height: '18px', marginTop: '1px', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: '13.5px', color: r.status?.checked ? '#5a6e84' : '#d0d8e4', textDecoration: r.status?.checked ? 'line-through' : 'none' }}>
                          {r.ti.label}
                          {!r.ti.required && <span style={{ color: '#3d4c60', fontSize: '11px' }}> (optional)</span>}
                        </span>
                        {r.ti.instructions && !r.status?.checked && (
                          <span style={{ display: 'block', fontSize: '11.5px', color: '#5a6e84', marginTop: '2px' }}>{r.ti.instructions}</span>
                        )}
                        {r.status?.checked && r.status.checked_at && (
                          <span style={{ display: 'block', fontSize: '11px', color: '#3d4c60', marginTop: '2px' }}>
                            {personLabel(people[r.status.checked_by]) !== '—' ? personLabel(people[r.status.checked_by]) : 'Checked'} · {new Date(r.status.checked_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
