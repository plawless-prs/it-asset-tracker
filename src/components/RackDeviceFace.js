'use client'

import { statusColor } from '../lib/tracker'

// Maps an asset type to a rack faceplate style, so a mounted device *looks* like
// the kind of gear it is (switch ports, server vents, storage bays, UPS outlets…).
export function faceCategory(type) {
  if (['Switch', 'Router', 'Firewall'].includes(type)) return 'network'
  if (type === 'Storage / NAS') return 'storage'
  if (type === 'UPS') return 'ups'
  if (type === 'Monitor') return 'monitor'
  if (['Server', 'Desktop', 'Laptop'].includes(type)) return 'server'
  return 'other'
}

// A small helper to render a horizontal strip of repeated elements (ports,
// drive bays, outlets) that flex to fill the available width.
function Strip({ count, render, gap = 3, style }) {
  return (
    <div style={{ display: 'flex', gap: `${gap}px`, alignItems: 'center', ...style }}>
      {Array.from({ length: count }).map((_, i) => render(i))}
    </div>
  )
}

// The faceplate that fills a mounted device's block in the rack grid.
// `showName` reveals the device-name chip (the grid passes this on hover).
export default function RackDeviceFace({ device, showName = false }) {
  const cat = faceCategory(device.type)
  const led = statusColor(device.status).text
  const tall = (device.u_height || 1) >= 2

  const base = {
    position: 'absolute', inset: 0, borderRadius: '3px', overflow: 'hidden',
    display: 'flex', alignItems: 'center',
  }

  let graphic = null
  let bg = 'linear-gradient(180deg,#252c35,#191d24)'

  if (cat === 'monitor') {
    bg = 'linear-gradient(180deg,#12161c,#0d1013)'
    graphic = (
      <div style={{ position: 'absolute', inset: '4px 10px', borderRadius: '3px', background: 'linear-gradient(160deg,#9bdcf2,#5fb8e0)', border: '1px solid #0a0d10' }} />
    )
  } else if (cat === 'network') {
    bg = 'linear-gradient(180deg,#20272f,#12161c)'
    graphic = (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3px', padding: '0 40px 0 14px' }}>
        {[0, 1].map(row => (
          <Strip
            key={row}
            count={12}
            gap={2}
            render={(i) => (
              <div key={i} style={{ flex: 1, height: '5px', borderRadius: '1px', backgroundColor: '#0a0e13', border: '1px solid #2a333f' }} />
            )}
          />
        ))}
      </div>
    )
  } else if (cat === 'storage') {
    bg = 'linear-gradient(180deg,#232a33,#14181e)'
    graphic = (
      <Strip
        count={8}
        gap={3}
        style={{ position: 'absolute', inset: '3px 40px 3px 12px' }}
        render={(i) => (
          <div key={i} style={{
            flex: 1, height: '100%', borderRadius: '2px',
            background: 'linear-gradient(180deg,#2c343f,#1b212a)', border: '1px solid #0c0f14',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: '2px',
          }}>
            <div style={{ width: '5px', height: '3px', borderRadius: '1px', backgroundColor: i % 3 === 0 ? '#4ade80' : '#0e1319' }} />
          </div>
        )}
      />
    )
  } else if (cat === 'ups') {
    bg = 'linear-gradient(180deg,#242b34,#14181e)'
    graphic = (
      <Strip
        count={8}
        gap={5}
        style={{ position: 'absolute', inset: 0, padding: '0 40px 0 14px', justifyContent: 'space-between' }}
        render={(i) => (
          <div key={i} style={{
            width: '14px', height: '14px', borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 40%, #2b3441, #10141a)',
            border: '1px solid #0a0d11',
          }} />
        )}
      />
    )
  } else if (cat === 'server') {
    bg = 'linear-gradient(180deg,#262d37,#191d24)'
    graphic = (
      <>
        {/* mounting ears */}
        <div style={{ position: 'absolute', left: '4px', top: '3px', bottom: '3px', width: '4px', borderRadius: '2px', background: '#313a46' }} />
        {/* vent grille */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: '16px', right: '46px',
          margin: 'auto 0', height: tall ? '70%' : '52%',
          background: 'repeating-linear-gradient(90deg,#161b22 0 3px,#222a34 3px 6px)',
          borderRadius: '2px', border: '1px solid #10141a',
        }} />
      </>
    )
  } else {
    // other / generic
    bg = 'linear-gradient(180deg,#222831,#14181e)'
    graphic = (
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '14px', right: '46px', margin: 'auto 0', height: '3px', background: '#2a323d', borderRadius: '2px' }} />
    )
  }

  return (
    <div style={{ ...base, background: bg, border: '1px solid #0c0f14', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
      {graphic}

      {/* status LED (top-right) */}
      <div style={{
        position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
        width: '7px', height: '7px', borderRadius: '50%', backgroundColor: led,
        boxShadow: `0 0 5px ${led}`,
      }} />

      {/* device name chip — only while hovered */}
      {showName && (
        <span style={{
          position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
          maxWidth: '55%', fontSize: '11px', fontWeight: 600, color: '#e6edf5',
          backgroundColor: 'rgba(6,9,13,0.72)', padding: '2px 7px', borderRadius: '4px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          {device.name}
        </span>
      )}
    </div>
  )
}
