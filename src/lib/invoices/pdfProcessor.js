import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const DISCOUNT_RATE = 0.05

// ─── Amount parsing ───────────────────────────────────────────────────────────

function parseAmount(str) {
  if (!str) return null
  const cleaned = str.replace(/[$,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function groupByRow(items, tolerance = 3) {
  const rows = []
  for (const item of items) {
    if (!item.str.trim()) continue
    const y = item.transform[5]
    const existing = rows.find((r) => Math.abs(r.y - y) <= tolerance)
    if (existing) {
      existing.items.push(item)
    } else {
      rows.push({ y, items: [item] })
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.transform[4] - b.transform[4])
  return rows.sort((a, b) => b.y - a.y)
}

function rowText(row) {
  return row.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
}

function findAmountInRow(row) {
  for (let i = row.items.length - 1; i >= 0; i--) {
    const m = row.items[i].str.trim().match(/^-?\$?[\d,]+\.\d{2}$/)
    if (m) return parseAmount(row.items[i].str)
  }
  const m = rowText(row).match(/\$?([\d,]+\.\d{2})\s*$/)
  if (m) return parseAmount(m[1])
  return null
}

// ─── Extract totals from text rows ────────────────────────────────────────────

function extractFromRows(rows) {
  let subTotal = null
  let totalFreight = null
  let tax = null
  let originalAmountDue = null

  for (const row of rows) {
    const text = rowText(row)
    if (/sub[\s\-]?total/i.test(text) && subTotal === null) subTotal = findAmountInRow(row)
    if (/freight|shipping/i.test(text) && !/freight\s+(in|out)/i.test(text) && totalFreight === null) totalFreight = findAmountInRow(row)
    if (/\btax\b/i.test(text) && !/tax.*exempt/i.test(text) && tax === null) tax = findAmountInRow(row)
    if (/amount\s+due|total\s+due|balance\s+due/i.test(text) && originalAmountDue === null) originalAmountDue = findAmountInRow(row)
  }

  // Fallback: scan full text
  if (subTotal === null || originalAmountDue === null) {
    const full = rows.map(rowText).join('\n')
    if (subTotal === null) {
      const m = full.match(/sub[\s\-]?total[\s:]*\$?([\d,]+\.\d{2})/i)
      if (m) subTotal = parseAmount(m[1])
    }
    if (originalAmountDue === null) {
      const m = full.match(/amount\s+due[\s:]*\$?([\d,]+\.\d{2})/i)
      if (m) originalAmountDue = parseAmount(m[1])
    }
    if (tax === null) {
      const m = full.match(/\btax\b[\s:]*\$?([\d,]+\.\d{2})/i)
      if (m) tax = parseAmount(m[1])
    }
    if (totalFreight === null) {
      const m = full.match(/total\s+freight\s*:\s*\$?([\d,]+\.\d{2})/i) || full.match(/\bfreight\s*:\s*\$?([\d,]+\.\d{2})/i)
      if (m) totalFreight = parseAmount(m[1])
    }
  }

  const found = [subTotal, originalAmountDue].filter((v) => v !== null).length
  const extractionConfidence = found === 2 ? 'high' : found === 1 ? 'medium' : 'low'

  return { subTotal, totalFreight, tax, originalAmountDue, extractionConfidence, error: null }
}

// ─── Load PDF text items ──────────────────────────────────────────────────────

let _pdfjs = null

async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs')
  _pdfjs = mod
  return _pdfjs
}

async function loadPdfjsDoc(buffer) {
  const pdfjs = await getPdfjs()
  return await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableAutoFetch: true,
    disableStream: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise
}

// ─── Process single PDF ───────────────────────────────────────────────────────

export async function processPdf(buffer, fileName) {
  try {
    const pdf = await loadPdfjsDoc(buffer)
    const allItems = []
    for (let p = pdf.numPages; p >= 1; p--) {
      const page = await pdf.getPage(p)
      const tc = await page.getTextContent()
      allItems.push(...tc.items)
    }
    const rows = groupByRow(allItems)
    const rawText = rows.map(rowText).join('\n')
    const extracted = extractFromRows(rows)

    const discount = extracted.subTotal !== null
      ? Math.round(extracted.subTotal * DISCOUNT_RATE * 100) / 100
      : null
    const newAmountDue = extracted.originalAmountDue !== null && discount !== null
      ? Math.round((extracted.originalAmountDue - discount) * 100) / 100
      : null

    return { fileName, ...extracted, discount, newAmountDue, rawText }
  } catch (err) {
    return {
      fileName, subTotal: null, totalFreight: null, tax: null,
      discount: null, originalAmountDue: null, newAmountDue: null,
      extractionConfidence: 'low', error: err?.message || 'Failed to parse PDF',
    }
  }
}

// ─── Process multi-invoice PDF ────────────────────────────────────────────────

export async function processMultiPdf(buffer, fileName) {
  try {
    const pdf = await loadPdfjsDoc(buffer)
    const results = []

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const items = (await page.getTextContent()).items
      const textConcat = items.map((i) => i.str).join(' ')
      if (!/sub[\s\-]?total/i.test(textConcat)) continue
      if (!/amount\s+due/i.test(textConcat)) continue

      const rows = groupByRow(items)
      const rawText = rows.map(rowText).join('\n')
      const extracted = extractFromRows(rows)

      const discount = extracted.subTotal !== null
        ? Math.round(extracted.subTotal * DISCOUNT_RATE * 100) / 100
        : null
      const newAmountDue = extracted.originalAmountDue !== null && discount !== null
        ? Math.round((extracted.originalAmountDue - discount) * 100) / 100
        : null

      results.push({ fileName, subIndex: results.length + 1, ...extracted, discount, newAmountDue, rawText })
    }

    if (results.length === 0) return [await processPdf(buffer, fileName)]
    return results
  } catch (err) {
    return [{
      fileName, subTotal: null, totalFreight: null, tax: null,
      discount: null, originalAmountDue: null, newAmountDue: null,
      extractionConfidence: 'low', error: err?.message || 'Failed to parse PDF',
    }]
  }
}

// ─── Detect totals area coordinates ───────────────────────────────────────────

function detectPageArea(p, page, items) {
  const textConcat = items.map((i) => i.str).join(' ')
  if (!/sub[\s\-]?total/i.test(textConcat)) return null
  if (!/amount\s+due/i.test(textConcat)) return null

  let subTotalY = null, amountDueY = null, subTotalX = null
  for (const item of items) {
    if (/sub[\s\-]?total/i.test(item.str)) { subTotalY = item.transform[5]; subTotalX = item.transform[4] }
    if (/amount\s+due/i.test(item.str)) amountDueY = item.transform[5]
  }
  if (subTotalY === null || amountDueY === null) return null

  const yHi = Math.max(subTotalY, amountDueY) + 24
  const yLo = Math.min(subTotalY, amountDueY) - 4
  const xMin = subTotalX !== null ? subTotalX - 8 : 0

  const band = items.filter((i) => {
    const y = i.transform[5]; const x = i.transform[4]
    return y >= yLo && y <= yHi && i.str.trim().length > 0 && x >= xMin
  })
  if (band.length < 2) return null

  const sortedRows = groupByRow(band).sort((a, b) => b.y - a.y)
  let leftEdge = Infinity, rightEdge = -Infinity, topEdge = -Infinity, bottomEdge = Infinity
  const resultRows = []

  for (const row of sortedRows) {
    let labelStr = '', labelX = Infinity, valueStr = '', valueRightX = -Infinity, fontSize = 9
    for (const item of row.items) {
      const x = item.transform[4]
      const fs = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 9
      fontSize = fs
      const isMoneyVal = /^-?\$?[\d,]+\.\d{2}$/.test(item.str.trim())
      if (isMoneyVal) { valueStr = item.str.trim(); valueRightX = Math.max(valueRightX, x + item.width) }
      else { labelStr += item.str; labelX = Math.min(labelX, x) }
      leftEdge = Math.min(leftEdge, x); rightEdge = Math.max(rightEdge, x + item.width)
    }
    topEdge = Math.max(topEdge, row.y + fontSize + 2)
    bottomEdge = Math.min(bottomEdge, row.y - 2)
    if (labelStr.trim() || valueStr) {
      resultRows.push({ label: labelStr.trim(), labelX: labelX === Infinity ? leftEdge : labelX, value: valueStr, valueRightX: valueRightX === -Infinity ? rightEdge : valueRightX, y: row.y, fontSize })
    }
  }
  if (resultRows.length === 0) return null

  const viewport = page.getViewport({ scale: 1 })
  const pageWidth = viewport.width
  const moneyPat = /^-?[\d,]+\.\d{2}$/
  let globalRight = rightEdge
  for (const item of items) {
    if (!moneyPat.test(item.str.trim())) continue
    if (item.transform[4] < xMin) continue
    const iw = item.width > 1 ? item.width : item.str.trim().length * 5.8
    globalRight = Math.max(globalRight, item.transform[4] + iw)
  }
  const finalRightEdge = Math.min(globalRight + 4, pageWidth - 18)

  const labelColX = subTotalX !== null ? subTotalX : leftEdge
  let trueLeftEdge = labelColX
  for (const item of items.filter((i) => { const y = i.transform[5]; return y >= yLo && y <= yHi && i.str.trim().length > 0 })) {
    if (/sub[\s\-]?total|amount\s+due|freight|shipping|\btax\b/i.test(item.str.trim())) {
      trueLeftEdge = Math.min(trueLeftEdge, item.transform[4])
    }
  }

  let contentBelow = 0
  for (const item of items) {
    const y = item.transform[5]
    if (y < yLo && item.str.trim().length > 0) contentBelow = Math.max(contentBelow, y)
  }

  return { pageIndex: p, rows: resultRows, boxX: trueLeftEdge - 6, boxY: bottomEdge, boxW: (finalRightEdge - trueLeftEdge) + 12, boxH: topEdge - bottomEdge, rightEdge: finalRightEdge, contentBelow }
}

async function locateTotalsArea(buffer) {
  const pdf = await loadPdfjsDoc(buffer)
  for (let p = pdf.numPages; p >= 1; p--) {
    const page = await pdf.getPage(p)
    const items = (await page.getTextContent()).items
    const area = detectPageArea(p, page, items)
    if (area) return area
  }
  return null
}

async function locateAllTotalsAreas(buffer) {
  const pdf = await loadPdfjsDoc(buffer)
  const areas = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const items = (await page.getTextContent()).items
    const area = detectPageArea(p, page, items)
    if (area) areas.push(area)
  }
  return areas
}

// ─── Format helper ────────────────────────────────────────────────────────────

function fmtAmt(val) {
  if (val === null) return ''
  return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ─── Font specs ───────────────────────────────────────────────────────────────

const LABEL_FS = 12
const VALUE_FS = 10
const AMT_DUE_VAL_FS = 11

// ─── Generate modified PDF ────────────────────────────────────────────────────

export async function generateModifiedPdf(originalBuffer, invoice) {
  const pdfDoc = await PDFDocument.load(originalBuffer)
  const pages = pdfDoc.getPages()

  const fonts = {
    labelFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    valueFont: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    amtDueFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
  }

  const area = await locateTotalsArea(originalBuffer)
  if (area && area.rows.length >= 1) {
    overlayTotals(pages, area, invoice, fonts)
  } else {
    addFallbackOverlay(pages[pages.length - 1], invoice, fonts)
  }

  return Buffer.from(await pdfDoc.save())
}

export async function generateMultiModifiedPdf(originalBuffer, invoices) {
  const pdfDoc = await PDFDocument.load(originalBuffer)
  const pages = pdfDoc.getPages()

  const fonts = {
    labelFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    valueFont: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    amtDueFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
  }

  const areas = await locateAllTotalsAreas(originalBuffer)
  const sorted = [...invoices].sort((a, b) => (a.subIndex ?? 1) - (b.subIndex ?? 1))

  if (areas.length > 0) {
    for (let i = 0; i < areas.length; i++) {
      const invoice = sorted[i]
      if (!invoice) continue
      overlayTotals(pages, areas[i], invoice, fonts)
    }
  } else {
    addFallbackOverlay(pages[pages.length - 1], sorted[0], fonts)
  }

  return Buffer.from(await pdfDoc.save())
}

// ─── Overlay totals onto PDF ──────────────────────────────────────────────────

function overlayTotals(pages, area, invoice, fonts) {
  const page = pages[area.pageIndex - 1] ?? pages[pages.length - 1]

  const subRow = area.rows.find((r) => /sub[\s\-]?total/i.test(r.label))
  const freightRow = area.rows.find((r) => /freight|shipping/i.test(r.label) && !/freight\s+(in|out)/i.test(r.label)) ?? area.rows.find((r) => /freight|shipping/i.test(r.label))
  const taxRow = area.rows.find((r) => /\btax\b/i.test(r.label))
  const dueRow = area.rows.find((r) => /amount\s+due/i.test(r.label))

  const rightX = area.rightEdge
  const labelStartX = subRow?.labelX ?? (area.boxX + 4)

  const sampleLabel = subRow?.label ?? dueRow?.label ?? 'SUB-TOTAL:'
  const discountLabel = sampleLabel === sampleLabel.toUpperCase() ? 'DISCOUNT:' : 'Discount:'

  const newRows = []
  if (subRow) newRows.push({ label: subRow.label || 'SUB-TOTAL:', value: invoice.subTotal !== null ? fmtAmt(invoice.subTotal) : subRow.value, isAmountDue: false })
  if (invoice.discount !== null) newRows.push({ label: discountLabel, value: fmtAmt(invoice.discount), isAmountDue: false })
  if (freightRow || invoice.totalFreight !== null) newRows.push({ label: freightRow?.label || 'TOTAL FREIGHT:', value: invoice.totalFreight !== null ? fmtAmt(invoice.totalFreight) : (freightRow?.value ?? ''), isAmountDue: false })
  if (taxRow) newRows.push({ label: taxRow.label || 'TAX:', value: invoice.tax !== null ? fmtAmt(invoice.tax) : taxRow.value, isAmountDue: false })
  newRows.push({ label: dueRow?.label || 'AMOUNT DUE:', value: fmtAmt(invoice.newAmountDue), isAmountDue: true })

  const topY = area.boxY + area.boxH
  const rowH = Math.max(LABEL_FS, area.boxH / newRows.length)
  const X_NUDGE = -2
  const Y_NUDGE = -6

  const wipeX = area.boxX + X_NUDGE
  const wipeW = rightX - area.boxX + 8
  const wipeBottom = topY - newRows.length * rowH - 6
  const coverY = Math.min(wipeBottom, area.boxY + 2) + Y_NUDGE

  page.drawRectangle({ x: wipeX, y: coverY, width: wipeW, height: (topY - coverY) + 2, color: rgb(1, 1, 1), borderWidth: 0 })

  const black = rgb(0, 0, 0)
  const drawRightX = rightX + X_NUDGE

  const refRows = area.rows.filter(r => r.label && !/freight\s+(in|out)/i.test(r.label))
  const maxLabelW = refRows.length > 0
    ? Math.max(...refRows.map(r => fonts.labelFont.widthOfTextAtSize(r.label, LABEL_FS)))
    : Math.max(...newRows.map(r => fonts.labelFont.widthOfTextAtSize(r.label, LABEL_FS)))
  const colonX = labelStartX + X_NUDGE + maxLabelW

  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i]
    const rowY = topY - rowH * 0.5 - i * rowH + Y_NUDGE

    const labelW = fonts.labelFont.widthOfTextAtSize(row.label, LABEL_FS)
    page.drawText(row.label, { x: colonX - labelW, y: rowY, size: LABEL_FS, font: fonts.labelFont, color: black })

    if (row.value) {
      const vFs = row.isAmountDue ? AMT_DUE_VAL_FS : VALUE_FS
      const vFont = row.isAmountDue ? fonts.amtDueFont : fonts.valueFont
      const vw = vFont.widthOfTextAtSize(row.value, vFs)
      page.drawText(row.value, { x: drawRightX - vw, y: rowY, size: vFs, font: vFont, color: black })
    }
  }
}

function addFallbackOverlay(page, invoice, fonts) {
  const { width } = page.getSize()
  const black = rgb(0, 0, 0)

  const rows = []
  if (invoice.subTotal !== null) rows.push({ label: 'SUB-TOTAL:', value: fmtAmt(invoice.subTotal) })
  if (invoice.discount !== null) rows.push({ label: 'DISCOUNT:', value: fmtAmt(invoice.discount) })
  if (invoice.totalFreight !== null) rows.push({ label: 'FREIGHT:', value: fmtAmt(invoice.totalFreight) })
  if (invoice.tax !== null) rows.push({ label: 'TAX:', value: fmtAmt(invoice.tax) })
  rows.push({ label: 'AMOUNT DUE:', value: fmtAmt(invoice.newAmountDue), isAmountDue: true })

  const rowH = LABEL_FS * 1.65
  const pad = 12
  const boxW = 240
  const boxH = rows.length * rowH + pad * 2
  const boxX = width - boxW - 30
  const boxY = 36

  page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: rgb(1, 1, 1), borderWidth: 0 })

  rows.forEach((row, i) => {
    const y = boxY + boxH - pad - (i + 1) * rowH + 4
    page.drawText(row.label, { x: boxX + pad, y, size: LABEL_FS, font: fonts.labelFont, color: black })
    const vFs = row.isAmountDue ? AMT_DUE_VAL_FS : VALUE_FS
    const vFont = row.isAmountDue ? fonts.amtDueFont : fonts.valueFont
    const vw = vFont.widthOfTextAtSize(row.value, vFs)
    page.drawText(row.value, { x: boxX + boxW - pad - vw, y, size: vFs, font: vFont, color: black })
  })
}