// Shared preview notes for the column-mapping page and the PDF entry page.
// Text comes from costPreviewNotices() in lib/priceupdates.js so the warning
// stays the same in both places.

export default function CostPreviewNotices({ notices }) {
  if (!notices || (!notices.warning && !notices.note && !notices.example)) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
      {notices.example && (
        <div style={{ fontSize: '11.5px', color: '#7fb4f5', lineHeight: 1.45 }}>{notices.example}</div>
      )}
      {notices.note && (
        <div style={{ fontSize: '11.5px', color: '#8aa0b8', lineHeight: 1.45 }}>{notices.note}</div>
      )}
      {notices.warning && (
        <div style={{ padding: '8px 10px', borderRadius: '8px', fontSize: '12px', lineHeight: 1.45, backgroundColor: '#332300', color: '#fbbf24', border: '1px solid #78500e' }}>
          {notices.warning}
        </div>
      )}
    </div>
  )
}
