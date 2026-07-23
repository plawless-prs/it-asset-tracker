'use client'

// Placeholder — guardrail thresholds (pu_settings) and P21 sync status/"Sync now"
// land in later phases (thresholds in Phase 7, P21 sync in Phase 3).
export default function SettingsPlaceholder() {
  return (
    <div style={{ padding: '24px 28px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#e0e7f0', margin: '0 0 4px' }}>Settings</h1>
      <p style={{ fontSize: '13px', color: '#5a6e84', margin: '0 0 24px' }}>
        Guardrail thresholds and P21 sync.
      </p>
      <div style={{
        backgroundColor: '#0f1620', border: '1px solid #182030', borderRadius: '14px',
        padding: '40px', textAlign: 'center', color: '#4a5a6e', fontSize: '13.5px',
      }}>
        Settings arrive in a later phase.
      </div>
    </div>
  )
}
