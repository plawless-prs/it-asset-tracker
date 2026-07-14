// Knowledge Base helpers.

export const KB_STATUS_META = {
  draft:     { label: 'Draft',     pillBg: '#1b2533', pillText: '#aebacc' },
  published: { label: 'Published', pillBg: '#0d3320', pillText: '#4ade80' },
  archived:  { label: 'Archived',  pillBg: '#1a1a1a', pillText: '#9aa6b4' },
}

// "Reset a user password" -> "reset-a-user-password"
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'article'
}

// Minimal, dependency-free markdown-ish renderer -> array of React-friendly
// block descriptors. Supports #/##/### headings, - bullets, and paragraphs
// with **bold** and `code` inline.
export function parseMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let para = []
  let list = []
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = [] } }
  const flushList = () => { if (list.length) { blocks.push({ type: 'ul', items: list.slice() }); list = [] } }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^###\s+/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'h3', text: line.replace(/^###\s+/, '') }) }
    else if (/^##\s+/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'h2', text: line.replace(/^##\s+/, '') }) }
    else if (/^#\s+/.test(line)) { flushPara(); flushList(); blocks.push({ type: 'h1', text: line.replace(/^#\s+/, '') }) }
    else if (/^[-*]\s+/.test(line)) { flushPara(); list.push(line.replace(/^[-*]\s+/, '')) }
    else if (line.trim() === '') { flushPara(); flushList() }
    else { flushList(); para.push(line) }
  }
  flushPara(); flushList()
  return blocks
}

// Inline **bold** and `code` -> array of {t, b, c} segments for rendering.
export function parseInline(text) {
  const out = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0, m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) out.push({ t: tok.slice(2, -2), b: true })
    else out.push({ t: tok.slice(1, -1), c: true })
    last = m.index + tok.length
  }
  if (last < text.length) out.push({ t: text.slice(last) })
  return out
}
