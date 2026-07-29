'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { syncP21, testP21 } from '../../../lib/priceupdatesParse'
import { formatDate } from '../../../lib/priceupdates'

// Phase 3: P21 mirror sync status + "Sync now". Guardrail-threshold editing
// (pu_settings) gets a real form in Phase 7; shown read-only here.
export default function PriceUpdatesSettings() {
  const supabase = createClient()
  const [stats, setStats] = useState({ rows: 0, lastSynced: null, suppliers: 0 })
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { count } = await supabase.from('p21_item_mirror').select('p21_item_id', { count: 'exact', head: true })
    const { data: latest } = await supabase
      .from('p21_item_mirror').select('last_synced_at').order('last_synced_at', { ascending: false }).limit(1)
    const { data: s } = await supabase.from('pu_settings').select('*').eq('id', 1).single()
    setStats({ rows: count || 0, lastSynced: latest?.[0]?.last_synced_at || null })
    setSettings(s)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSync() {
    setError(''); setResult(''); setTestOut(null)
    setSyncing(true)
    try {
      const r = await syncP21(supabase)
      if (r.note) setResult(r.note)
      else {
        const per = (r.suppliers || []).map(s => `supplier ${s.supplier_id}: ${s.rows.toLocaleString()}`).join(' · ')
        setResult(`Synced ${r.upserted?.toLocaleString?.() ?? r.upserted} rows${per ? ` (${per})` : ''}.${r.warning ? ` ⚠ ${r.warning}` : ''}`)
      }
      await load()
    } catch (e) {
      setError(e.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleTest() {
    setError(''); setResult(''); setTestOut(null)
    setTesting(true)
    try {
      const r = await testP21(supabase)
      setTestOut(r)
    } catch (e) {
      setError(e.message || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const card = { backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px', padding: '20px', marginBottom: '16px' }
  const labelStyle = { fontSize: '11px', color: '#5a6e84', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }

  return (
    <div style={{ padding: '24px 28px', maxWidth: '760px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Settings</h1>
      <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 24px' }}>P21 sync and guardrails.</p>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#5a6e84' }}>Loading…</div>
      ) : (
        <>
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#c0cad8', marginBottom: '10px' }}>P21 item mirror</div>
                <div style={{ display: 'flex', gap: '32px' }}>
                  <div>
                    <div style={labelStyle}>Rows</div>
                    <div style={{ fontSize: '20px', fontWeight: '700', color: '#e0e7f0' }}>{stats.rows.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={labelStyle}>Last synced</div>
                    <div style={{ fontSize: '14px', color: '#c0cad8', paddingTop: '4px' }}>
                      {stats.lastSynced ? formatDate(stats.lastSynced) : 'Never'}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button onClick={handleTest} disabled={testing || syncing} style={{
                  padding: '9px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
                  backgroundColor: '#131a24', color: '#60a5fa', border: '1px solid #1e3a5f',
                  cursor: (testing || syncing) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                }}>{testing ? 'Testing…' : 'Test connection'}</button>
                <button onClick={handleSync} disabled={syncing || testing} style={{
                  padding: '9px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
                  backgroundColor: syncing ? '#1e40af' : '#2563eb', color: '#fff', border: 'none',
                  cursor: (syncing || testing) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                }}>{syncing ? 'Syncing…' : '↻ Sync now'}</button>
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: '#5a6e84', marginTop: '14px' }}>
              Pulls current item + supplier-cost data from P21 into the read-only mirror used for matching.
              A nightly Vercel cron does this automatically. Requires the P21 API credentials in the environment.
            </div>
            {result && <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#0d3320', color: '#4ade80', border: '1px solid #166534' }}>{result}</div>}
            {error && <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '8px', fontSize: '12.5px', backgroundColor: '#330d0d', color: '#f87171', border: '1px solid #991b1b' }}>{error}</div>}
            {testOut && (
              <div style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '8px', fontSize: '12px', backgroundColor: '#0d1219', border: '1px solid #1e2d40' }}>
                <div style={{ color: testOut.ok ? '#4ade80' : '#f87171', fontWeight: '600', marginBottom: '8px' }}>
                  {testOut.ok ? `✓ Connected — read ${testOut.sample_count} sample row(s) from ${testOut.view}` : `✗ ${testOut.error}`}
                </div>
                {testOut.ok && (
                  <>
                    <div style={{ color: '#8aa0b8', marginBottom: '6px' }}>
                      Fields returned: <span style={{ color: '#c0cad8', fontFamily: 'monospace' }}>{(testOut.detected_fields || []).join(', ') || '(none)'}</span>
                    </div>
                    <pre style={{ margin: 0, color: '#7e93a8', fontSize: '11px', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(testOut.sample, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize: '14px', fontWeight: '600', color: '#c0cad8', marginBottom: '12px' }}>
              Guardrails <span style={{ fontSize: '11.5px', color: '#5a6e84', fontWeight: '400' }}>(editable in a later phase)</span>
            </div>
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              <div><div style={labelStyle}>Large increase over</div><div style={{ fontSize: '14px', color: '#c0cad8' }}>{settings?.large_increase_pct ?? 20}%</div></div>
              <div><div style={labelStyle}>Flag decreases</div><div style={{ fontSize: '14px', color: '#c0cad8' }}>{(settings?.flag_decreases ?? true) ? 'Yes' : 'No'}</div></div>
              <div><div style={labelStyle}>Flag cost over list</div><div style={{ fontSize: '14px', color: '#c0cad8' }}>{(settings?.flag_cost_over_list ?? true) ? 'Yes' : 'No'}</div></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
