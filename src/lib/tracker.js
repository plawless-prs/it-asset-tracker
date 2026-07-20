// Shared IT Tracker (asset management) constants + formatters.
// Mirrors lib/helpdesk.js. Import from here instead of re-declaring these
// inline in tracker pages/components.

// --- Statuses ---------------------------------------------------------------
// Order used in the assets filter bar (prefix with 'All' at the call site).
export const ASSET_STATUSES = [
  'Ready to Deploy',
  'Deployed',
  'Pending',
  'In Repair',
  'Archived',
  'Lost/Stolen',
  'Disposed',
]

export const STATUS_COLORS = {
  'Ready to Deploy': { bg: '#0d3320', text: '#4ade80', border: '#166534' },
  'Deployed':        { bg: '#1e2a3a', text: '#60a5fa', border: '#1e40af' },
  'Pending':         { bg: '#332800', text: '#fbbf24', border: '#854d0e' },
  'In Repair':       { bg: '#331a00', text: '#fb923c', border: '#9a3412' },
  'Archived':        { bg: '#1a1a2e', text: '#a78bfa', border: '#5b21b6' },
  'Lost/Stolen':     { bg: '#330d0d', text: '#f87171', border: '#991b1b' },
  'Disposed':        { bg: '#1a1a1a', text: '#737373', border: '#404040' },
}

export function statusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS['Pending']
}

// --- Categories (broad grouping, kept from the original schema) -------------
export const ASSET_CATEGORIES = [
  'Hardware',
  'Software',
  'Peripheral',
  'Network',
  'Mobile',
  'Other',
]

// --- Types (finer than category; drives type-specific detail fields) --------
// `computer: true` => a computer/server, which shows the fuller field set
// (hostname, IP, OS, CPU, RAM, storage). Everything else shows the leaner set.
// `rackable: true` => can be mounted in a server rack, so it shows the
// power/U-height/rack-position fields (and becomes eligible for the Stage 4
// rack visualization). Laptops/desktops/monitors/phones are not rackable.
export const ASSET_TYPES = [
  { value: 'Laptop',        computer: true,  rackable: false },
  { value: 'Desktop',       computer: true,  rackable: false },
  { value: 'Server',        computer: true,  rackable: true  },
  { value: 'Switch',        computer: false, rackable: true  },
  { value: 'Router',        computer: false, rackable: true  },
  { value: 'Firewall',      computer: false, rackable: true  },
  { value: 'Storage / NAS', computer: false, rackable: true  },
  { value: 'UPS',           computer: false, rackable: true  },
  { value: 'Monitor',       computer: false, rackable: false },
  { value: 'Printer',       computer: false, rackable: false },
  { value: 'Phone / Mobile', computer: false, rackable: false },
  { value: 'Other',         computer: false, rackable: false },
]

export const ASSET_TYPE_VALUES = ASSET_TYPES.map(t => t.value)

export function isComputerType(type) {
  return ASSET_TYPES.find(t => t.value === type)?.computer === true
}

// Suggested default for the "rack-mountable" checkbox when a type is picked on a
// new asset. Rack-mountability is ultimately a per-asset flag (see the checkbox
// in AssetModal), not decided by type — this is only the initial suggestion.
export function isRackableType(type) {
  return ASSET_TYPES.find(t => t.value === type)?.rackable === true
}

// Validate placing a device at `uStart` (its bottom U) in a rack. Returns a
// human-readable error string, or '' if the placement is valid. Shared by
// AssetModal (on save) and PlaceDeviceModal so both enforce the same rules:
// within the rack's height and not overlapping another mounted device.
// `occupied` is the list of devices already in the rack ({ id, name,
// u_position, u_height }); `excludeId` skips the device being moved/edited.
export function rackPlacementError({ uStart, uHeight, rackHeight, occupied, excludeId }) {
  const start = Number(uStart)
  const h = Number(uHeight) || 1
  if (!start || start < 1) return 'Pick a rack position (U) of 1 or higher.'
  if (rackHeight && start + h - 1 > rackHeight) {
    return `Doesn't fit — a ${h}U device at U${start} would exceed the ${rackHeight}U rack.`
  }
  for (const m of occupied || []) {
    if (excludeId && m.id === excludeId) continue
    if (m.u_position == null) continue
    const mStart = m.u_position
    const mEnd = m.u_position + (m.u_height || 1) - 1
    const end = start + h - 1
    if (start <= mEnd && end >= mStart) {
      return `Overlaps a device already at U${mStart}${mEnd > mStart ? `–U${mEnd}` : ''}${m.name ? ` (${m.name})` : ''}.`
    }
  }
  return ''
}

// --- Formatters -------------------------------------------------------------
// blankDash: return '—' for empty/zero values (used in the assets table where a
// missing cost reads as '—'); default returns '$0.00' (used in detail views).
export function formatCurrency(n, { blankDash = false } = {}) {
  if (blankDash && !n) return '—'
  return '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// --- Rack audits ------------------------------------------------------------
// Per-item outcome of a rack audit. `present` is the only "all good" result;
// missing/moved/extra are discrepancies. `pending` = not yet reviewed.
export const AUDIT_RESULTS = [
  { value: 'present', label: 'Present', color: { bg: '#0d3320', text: '#4ade80', border: '#166534' } },
  { value: 'moved',   label: 'Moved',   color: { bg: '#332800', text: '#fbbf24', border: '#854d0e' } },
  { value: 'missing', label: 'Missing', color: { bg: '#330d0d', text: '#f87171', border: '#991b1b' } },
  { value: 'extra',   label: 'Extra',   color: { bg: '#1e2a3a', text: '#60a5fa', border: '#1e40af' } },
]

export function auditResultMeta(value) {
  return AUDIT_RESULTS.find(r => r.value === value)
    || { value: 'pending', label: 'Pending', color: { bg: '#1a1a1a', text: '#737373', border: '#404040' } }
}

// Device condition noted during an audit (optional per item).
export const AUDIT_CONDITIONS = [
  { value: '',                label: '—' },
  { value: 'ok',              label: 'OK' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'damaged',         label: 'Damaged' },
]

// A discrepancy is anything not cleanly "present" in its expected slot: missing,
// moved, extra, or flagged with a non-OK condition.
export function isDiscrepancy(item) {
  if (['missing', 'moved', 'extra'].includes(item.result)) return true
  if (item.condition && item.condition !== 'ok') return true
  return false
}

export function countDiscrepancies(items) {
  return (items || []).filter(isDiscrepancy).length
}

// --- Depreciation (straight-line) -------------------------------------------
// Returns { pct, currentValue }. Pure function of the asset row.
export function computeDepreciation(asset) {
  const cost = Number(asset.purchase_cost || 0)
  let pct = 0
  let currentValue = cost
  if (asset.purchase_date && asset.purchase_cost && asset.useful_life_months) {
    const monthsElapsed =
      (new Date() - new Date(asset.purchase_date)) / (1000 * 60 * 60 * 24 * 30.44)
    pct = Math.min((monthsElapsed / Number(asset.useful_life_months)) * 100, 100)
    currentValue = Math.max(Number(asset.purchase_cost) * (1 - pct / 100), 0)
  }
  return { pct, currentValue }
}
