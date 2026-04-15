// Polyfill DOMMatrix for serverless environments (Vercel)
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor(init) {
      if (Array.isArray(init)) {
        this.a = init[0] ?? 1; this.b = init[1] ?? 0;
        this.c = init[2] ?? 0; this.d = init[3] ?? 1;
        this.e = init[4] ?? 0; this.f = init[5] ?? 0;
      } else {
        this.a = 1; this.b = 0; this.c = 0;
        this.d = 1; this.e = 0; this.f = 0;
      }
      this.m11 = this.a; this.m12 = this.b;
      this.m21 = this.c; this.m22 = this.d;
      this.m41 = this.e; this.m42 = this.f;
      this.is2D = true;
      this.isIdentity = this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }
    inverse() { return new DOMMatrix([1, 0, 0, 1, 0, 0]); }
    multiply() { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
    scale() { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
    translate() { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]); }
    transformPoint(p) { return { x: p?.x ?? 0, y: p?.y ?? 0 }; }
  }
}
if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    constructor() {}
    moveTo() {}; lineTo() {}; closePath() {}; rect() {};
    arc() {}; arcTo() {}; bezierCurveTo() {}; quadraticCurveTo() {}
  }
}

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

const DISCOUNT_RATE = 0.05

// INVOICE FORMAT CONSTANTS
// Calibrated for Power and Rubber Supply invoices (612x792pt pages)
// wipeX/wipeW control the horizontal extent of the white-out rectangle
// valueRightX controls where values are right-aligned
const INVOICE_LAYOUT = {
  valueRightX: 571,
  wipeX: 395,
  wipeW: 185,
}

const LABEL_FS = 12
const VALUE_FS = 10
const AMT_DUE_VAL_FS = 11
const ROW_HEIGHT = 16

// ─── Amount parsing ───────────────────────────────────────────────────────────

function parseAmount(str) {
  if (!str) return null
  const cleaned = str.replace(/[$,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

// ─── Format helper ────────────────────────────────────────────────────────────

function fmtAmt(val) {
  if (val === null) return ''
  return val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ─── Compute discount (single source of truth) ───────────────────────────────

function computeDiscount(extracted) {
  const discount = extracted.subTotal !== null
    ? Math.round(extracted.subTotal * DISCOUNT_RATE * 100) / 100
    : null
  const newAmountDue = extracted.originalAmountDue !== null && discount !== null
    ? Math.round((extracted.originalAmountDue - discount) * 100) / 100
    : null
  return { discount, newAmountDue }
}

// ─── Extract totals from plain text ───────────────────────────────────────────

function extractFromText(text) {
  if (!text || typeof text !== 'string') {
    return { subTotal: null, totalFreight: null, tax: null, originalAmountDue: null, extractionConfidence: 'low', error: 'No text to extract' }
  }

  let subTotal = null
  let totalFreight = null
  let tax = null
  let originalAmountDue = null

  // SUB-TOTAL: may have other text between label and amount
  const subMatch = text.match(/sub[\s\-]?total[:\s].*?([\d,]+\.\d{2})/i)
  if (subMatch) subTotal = parseAmount(subMatch[1])

  // TOTAL FREIGHT: amount after label, skip freight in/out values
  const freightLine = text.match(/TOTAL\s+FREIGHT[:\s].*?([\d,]+\.\d{2})/i)
  if (freightLine) {
    const afterLabel = freightLine[0].split(/TOTAL\s+FREIGHT[:\s]*/i)[1] || ''
    const afterMatch = afterLabel.match(/([\d,]+\.\d{2})/)
    if (afterMatch) totalFreight = parseAmount(afterMatch[1])
    else totalFreight = parseAmount(freightLine[1])
  }

  // TAX may be split: "TAX 0.00\t:" or "TAX:\t0.00"
  const taxMatch = text.match(/\bTAX[\s:]*(\d[\d,]*\.\d{2})/i)
    || text.match(/(\d[\d,]*\.\d{2})[\s\t]*TAX/i)
  if (taxMatch && !/tax\s*exempt/i.test(text)) tax = parseAmount(taxMatch[1])

  // AMOUNT DUE: amount may come BEFORE or AFTER the label
  const dueMatch = text.match(/amount\s+due[:\s]*([\d,]+\.\d{2})/i)
    || text.match(/([\d,]+\.\d{2})[\s\t]*AMOUNT\s+DUE/i)
  if (dueMatch) originalAmountDue = parseAmount(dueMatch[1])

  const found = [subTotal, originalAmountDue].filter((v) => v !== null).length
  const extractionConfidence = found === 2 ? 'high' : found === 1 ? 'medium' : 'low'

  return { subTotal, totalFreight, tax, originalAmountDue, extractionConfidence, error: null }
}

// ─── Detect which totals lines exist ──────────────────────────────────────────

function detectTotalsFromText(text) {
  if (!text) return { hasSubTotal: false, hasAmountDue: false, hasFreight: false, hasTax: false }
  return {
    hasSubTotal: /sub[\s\-]?total/i.test(text),
    hasAmountDue: /amount\s+due/i.test(text),
    hasFreight: /total\s+freight/i.test(text),
    hasTax: /\btax\b/i.test(text) && !/tax\s*exempt/i.test(text),
  }
}

// ─── Parse PDF: extract text AND coordinates in one pass ──────────────────────
// Uses pdf-parse v1's pagerender callback to access pdfjs text content
// This gives us both the extracted text and the exact Y positions of totals labels

async function parsePdf(buffer) {
  const pdfParse = (await import('pdf-parse')).default

  const pageAreas = []
  let pageNum = 0

  const result = await pdfParse(buffer, {
    pagerender: async function (pageData) {
      pageNum++
      const tc = await pageData.getTextContent()

      let subY = null
      let dueY = null
      let pageHasFreight = false

      for (const item of tc.items) {
        if (!item.str) continue
        const x = item.transform[4]
        const y = item.transform[5]

        if (/SUB[\s\-]?TOTAL/i.test(item.str) && x > 380) {
          subY = y
        }
        if (/AMOUNT\s*DUE/i.test(item.str) && x > 380) {
          dueY = y
        }
        if (/TOTAL\s*FREIGHT/i.test(item.str) && x > 380) {
          pageHasFreight = true
        }
      }

      if (subY !== null && dueY !== null) {
        pageAreas.push({
          pageIndex: pageNum,
          subTotalY: subY,
          amountDueY: dueY,
          hasFreight: pageHasFreight,
        })
      }

      // Return the page text so result.text contains the full document text
      return tc.items.map(item => item.str).join(' ')
    },
  })

  return {
    text: result.text || '',
    numpages: result.numpages || 1,
    pageAreas,
  }
}

// ─── Build totals area from parsed data ───────────────────────────────────────

function buildTotalsArea(pageAreas, text) {
  const totals = detectTotalsFromText(text)
  if (!totals.hasSubTotal || !totals.hasAmountDue) return null
  if (pageAreas.length === 0) return null

  // Global row count (used as default, overridden per-page in generate functions)
  let rowCount = 0
  if (totals.hasSubTotal) rowCount++
  rowCount++ // DISCOUNT
  if (totals.hasFreight) rowCount++
  if (totals.hasTax) rowCount++
  rowCount++ // AMOUNT DUE

  const area = pageAreas[0]
  const wipeTop = area.subTotalY + 12
  const wipeBottom = area.subTotalY - ((rowCount - 1) * ROW_HEIGHT) - 2

  return {
    subTotalY: area.subTotalY,
    valueRightX: INVOICE_LAYOUT.valueRightX,
    rowCount,
    hasFreight: totals.hasFreight,
    wipeX: INVOICE_LAYOUT.wipeX,
    wipeY: wipeBottom,
    wipeW: INVOICE_LAYOUT.wipeW,
    wipeH: wipeTop - wipeBottom,
    pageAreas,
  }
}

// ─── Process single PDF ───────────────────────────────────────────────────────

export async function processPdf(buffer, fileName) {
  try {
    const parsed = await parsePdf(buffer)
    const extracted = extractFromText(parsed.text)
    const { discount, newAmountDue } = computeDiscount(extracted)

    return { fileName, ...extracted, discount, newAmountDue, rawText: parsed.text }
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
    const parsed = await parsePdf(buffer)
    const text = parsed.text

    // Split by form feed, page markers, or Document ID boundaries
    const sections = text.split(/\f|(?=--\s*\d+\s+of\s+\d+\s*--)|(?=Document\s+ID:)/)
      .filter(s => s.trim().length > 0)
    const results = []

    for (const section of sections) {
      if (!/sub[\s\-]?total/i.test(section)) continue
      if (!/amount\s+due/i.test(section)) continue

      const extracted = extractFromText(section)
      const { discount, newAmountDue } = computeDiscount(extracted)

      results.push({
        fileName,
        subIndex: results.length + 1,
        ...extracted,
        discount,
        newAmountDue,
        rawText: section,
      })
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

// ─── Embed fonts (shared helper) ──────────────────────────────────────────────

async function embedFonts(pdfDoc) {
  return {
    labelFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic),
    valueFont: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    amtDueFont: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
  }
}

// ─── Generate modified PDF (single invoice) ──────────────────────────────────

export async function generateModifiedPdf(originalBuffer, invoice) {
  const pdfDoc = await PDFDocument.load(originalBuffer)
  const pages = pdfDoc.getPages()
  const fonts = await embedFonts(pdfDoc)

  // Parse once for text + coordinates
  const parsed = await parsePdf(originalBuffer)
  const area = buildTotalsArea(parsed.pageAreas, parsed.text)

  if (area && area.pageAreas && area.pageAreas.length > 0) {
    const pageArea = area.pageAreas[0]
    const pageIndex = pageArea.pageIndex - 1
    const targetPage = pages[Math.min(pageIndex, pages.length - 1)]

    let pageRowCount = 2 // SUB-TOTAL + AMOUNT DUE
    if (invoice.discount !== null || invoice.subTotal !== null) pageRowCount++
    if (pageArea.hasFreight && invoice.totalFreight !== null) pageRowCount++
    pageRowCount++ // TAX always shown

    const wipeTop = pageArea.subTotalY + 12
    const wipeBottom = pageArea.subTotalY - ((pageRowCount - 1) * ROW_HEIGHT) - 2
    const pageSpecificArea = {
      ...area,
      subTotalY: pageArea.subTotalY,
      hasFreight: pageArea.hasFreight,
      rowCount: pageRowCount,
      wipeY: wipeBottom,
      wipeH: wipeTop - wipeBottom,
    }

    overlayTotals(targetPage, pageSpecificArea, invoice, fonts)
  } else {
    addFallbackOverlay(pages[pages.length - 1], invoice, fonts)
  }

  return Buffer.from(await pdfDoc.save())
}

// ─── Generate modified PDF (multi-invoice) ───────────────────────────────────

export async function generateMultiModifiedPdf(originalBuffer, invoices) {
  const pdfDoc = await PDFDocument.load(originalBuffer)
  const pages = pdfDoc.getPages()
  const fonts = await embedFonts(pdfDoc)

  // Parse once
  const parsed = await parsePdf(originalBuffer)
  const area = buildTotalsArea(parsed.pageAreas, parsed.text)

  const sorted = [...invoices].sort((a, b) => (a.subIndex ?? 1) - (b.subIndex ?? 1))

  if (area && area.pageAreas && area.pageAreas.length > 0) {
    for (let i = 0; i < sorted.length; i++) {
      const invoice = sorted[i]
      const pageArea = area.pageAreas[i] || area.pageAreas[area.pageAreas.length - 1]
      const pageIndex = pageArea.pageIndex - 1
      const page = pages[Math.min(pageIndex, pages.length - 1)]

      // Calculate row count for THIS page
      let pageRowCount = 2 // SUB-TOTAL + AMOUNT DUE
      if (invoice.discount !== null) pageRowCount++
      if (pageArea.hasFreight && invoice.totalFreight !== null) pageRowCount++
      pageRowCount++ // TAX always shown

      const wipeTop = pageArea.subTotalY + 12
      const wipeBottom = pageArea.subTotalY - ((pageRowCount - 1) * ROW_HEIGHT) - 2
      const pageSpecificArea = {
        ...area,
        subTotalY: pageArea.subTotalY,
        hasFreight: pageArea.hasFreight,
        rowCount: pageRowCount,
        wipeY: wipeBottom,
        wipeH: wipeTop - wipeBottom,
      }

      overlayTotals(page, pageSpecificArea, invoice, fonts)
    }
  } else {
    addFallbackOverlay(pages[pages.length - 1], sorted[0], fonts)
  }

  return Buffer.from(await pdfDoc.save())
}

// ─── Overlay totals onto PDF page ─────────────────────────────────────────────

function overlayTotals(page, area, invoice, fonts) {
  const black = rgb(0, 0, 0)

  const newRows = []
  newRows.push({
    label: 'SUB-TOTAL:',
    value: invoice.subTotal !== null ? fmtAmt(invoice.subTotal) : '',
    isAmountDue: false,
  })
  if (invoice.discount !== null) {
    newRows.push({ label: 'DISCOUNT:', value: fmtAmt(invoice.discount), isAmountDue: false })
  }
  if (area.hasFreight && invoice.totalFreight !== null) {
    newRows.push({ label: 'TOTAL FREIGHT:', value: fmtAmt(invoice.totalFreight), isAmountDue: false })
  }
  newRows.push({
    label: 'TAX:',
    value: invoice.tax !== null ? fmtAmt(invoice.tax) : '0.00',
    isAmountDue: false,
  })
  newRows.push({
    label: 'AMOUNT DUE:',
    value: fmtAmt(invoice.newAmountDue),
    isAmountDue: true,
  })

  // White-out rectangle
  page.drawRectangle({
    x: area.wipeX,
    y: area.wipeY,
    width: area.wipeW,
    height: area.wipeH,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  })

  // Right-align labels so colons line up
  const maxLabelW = Math.max(...newRows.map((r) => fonts.labelFont.widthOfTextAtSize(r.label, LABEL_FS)))
  const colonX = area.wipeX + 10 + maxLabelW

  // Center text block vertically within the wipe area
  const textBlockHeight = (newRows.length - 1) * ROW_HEIGHT
  const availableHeight = area.wipeH - 12
  const verticalPadding = (availableHeight - textBlockHeight) / 2
  const startY = (area.wipeY + area.wipeH) - 7 - verticalPadding

  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i]
    const rowY = startY - (i * ROW_HEIGHT)

    const labelW = fonts.labelFont.widthOfTextAtSize(row.label, LABEL_FS)
    page.drawText(row.label, {
      x: colonX - labelW,
      y: rowY,
      size: LABEL_FS,
      font: fonts.labelFont,
      color: black,
    })

    if (row.value) {
      const vFs = row.isAmountDue ? AMT_DUE_VAL_FS : VALUE_FS
      const vFont = row.isAmountDue ? fonts.amtDueFont : fonts.valueFont
      const vw = vFont.widthOfTextAtSize(row.value, vFs)
      page.drawText(row.value, {
        x: area.valueRightX - vw,
        y: rowY,
        size: vFs,
        font: vFont,
        color: black,
      })
    }
  }
}

// ─── Fallback overlay ─────────────────────────────────────────────────────────

function addFallbackOverlay(page, invoice, fonts) {
  const { width } = page.getSize()
  const black = rgb(0, 0, 0)

  const rows = []
  if (invoice.subTotal !== null) rows.push({ label: 'SUB-TOTAL:', value: fmtAmt(invoice.subTotal), isAmountDue: false })
  if (invoice.discount !== null) rows.push({ label: 'DISCOUNT:', value: fmtAmt(invoice.discount), isAmountDue: false })
  if (invoice.totalFreight !== null) rows.push({ label: 'FREIGHT:', value: fmtAmt(invoice.totalFreight), isAmountDue: false })
  if (invoice.tax !== null) rows.push({ label: 'TAX:', value: fmtAmt(invoice.tax), isAmountDue: false })
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
