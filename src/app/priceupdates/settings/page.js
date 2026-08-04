'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { testP21 } from '../../../lib/priceupdatesParse'
import { formatDate } from '../../../lib/priceupdates'

// A heartbeat this recent means the on-prem worker's --watch loop is alive
// (it stamps every poll, default 60s).
const WORKER_ONLINE_MS = 3 * 60 * 1000

// Phase 3: P21 mirror sync status + "Sync now". Guardrail-threshold editing
// (pu_settings) gets a real form in Phase 7; shown read-only here.
//
// Syncing runs on the on-prem worker (worker/ — Epicor's replica rejects
// Vercel's egress IPs): "Sync now" sets pu_settings.sync_requested_at, the
// worker picks it up and writes worker_last_result, and this page polls until
// the result lands.
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
  const pollTimer = useRef(null)

  async function load() {
    const { count } = await supabase.from('p21_item_mirror').select('p21_item_id', { count: 'exact', head: true })
    const { data: latest } = await supabase
      .from('p21_item_mirror').select('last_synced_at').order('last_synced_at', { ascending: false }).limit(1)
    const { data: s } = await supabase.from('pu_settings').select('*').eq('id', 1).single()
    setStats({ rows: count || 0, lastSynced: latest?.[0]?.last_synced_at || null })
    setSettings(s)
    setLoading(false)
    return s
  }

  useEffect(() => {
    load()
    return () => clearTimeout(pollTimer.current)
  }, [])

  const workerOnline = settings?.worker_heartbeat_at &&
    (Date.now() - new Date(settings.worker_heartbeat_at).getTime()) < WORKER_ONLINE_MS

  function describeResult(r) {
    if (!r) return ''
    if (!r.ok) return ''
    if (r.note) return r.note
    const per = (r.suppliers || []).map(s => `supplier ${s.supplier_id}: ${s.rows.toLocaleString()}`).join(' · ')
    return `Synced ${r.upserted?.toLocaleString?.() ?? r.upserted} rows${per ? ` (${per})` : ''}.`
  }

  // Wait for the worker to clear the request and record a fresh result.
  function pollForResult(requestedAt, deadline) {
    pollTimer.current = setTimeout(async () => {
      const s = await load()
      const r = s?.worker_last_result
      const done = !s?.sync_requested_at && r && new Date(r.finished_at || 0) > new Date(requestedAt)
      if (done) {
        setSyncing(false)
        if (r.ok) setResult(describeResult(r))
        else setError(r.error || 'Sync failed')
      } else if (Date.now() > deadline) {
        setSyncing(false)
        setError('No result from the worker yet — it may be offline or mid-sync. Check back on this page in a minute.')
      } else {
        pollForResult(requestedAt, deadline)
      }
    }, 5000)
  }

  async function handleSync() {
    setError(''); setResult(''); setTestOut(null)
    setSyncing(true)
    const requestedAt = new Date().toISOString()
    const { data: { user } } = await supabase.auth.getUser()
    const { error: e } = await supabase.from('pu_settings')
      .update({ sync_requested_at: requestedAt, sync_requested_by: user?.id || null })
      .eq('id', 1)
    if (e) {
      setSyncing(false)
      setError(e.message || 'Could not request a sync')
      return
    }
    if (!workerOnline) {
      setSyncing(false)
      setResult('Sync requested. The worker looks offline right now — it will run the sync when it next checks in.')
      return
    }
    pollForResult(requestedAt, Date.now() + 5 * 60 * 1000)
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
                  <div>
                    <div style={labelStyle}>Sync worker</div>
                    <div style={{ fontSize: '14px', color: workerOnline ? '#4ade80' : '#f87171', paddingTop: '4px' }}>
                      {workerOnline ? '● Online' : '○ Offline'}
                      {settings?.worker_heartbeat_at && (
                        <span style={{ color: '#5a6e84', fontSize: '12px' }}> — seen {formatDate(settings.worker_heartbeat_at)}</span>
                      )}
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
              Syncs run on the on-prem worker (Epicor only allows replica connections from the office network) —
              nightly on a schedule, or on demand via Sync now. Test connection checks the Vercel→P21 fallback
              path, which is expected to fail unless Epicor allowlists Vercel.
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
