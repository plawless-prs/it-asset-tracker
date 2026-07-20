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

export function isRackableType(type) {
  return ASSET_TYPES.find(t => t.value === type)?.rackable === true
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
