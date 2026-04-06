import { NextResponse } from 'next/server'
import { processPdf, processMultiPdf } from '../../../../lib/invoices/pdfProcessor'

// Store sessions in memory (same approach as original app)
// In a production app you'd want to use Redis or a database
if (!global.invoiceSessions) {
  global.invoiceSessions = { results: new Map(), pdfs: new Map() }
}

export async function POST(request) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('pdfs')
    const splitMulti = formData.get('splitMulti') === 'true'

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No PDF files uploaded' }, { status: 400 })
    }

    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2)
    const results = []
    const pdfBuffers = new Map()

    for (const file of files) {
      if (file.type !== 'application/pdf') continue

      const buffer = Buffer.from(await file.arrayBuffer())
      const fileName = file.name

      const fileResults = splitMulti
        ? await processMultiPdf(buffer, fileName)
        : [await processPdf(buffer, fileName)]

      results.push(...fileResults)
      pdfBuffers.set(fileName, buffer)
    }

    global.invoiceSessions.results.set(sessionId, results)
    global.invoiceSessions.pdfs.set(sessionId, pdfBuffers)

    const successCount = results.filter((r) => r.error === null).length

    return NextResponse.json({
      sessionId,
      invoices: results,
      processedAt: new Date().toISOString(),
      totalFiles: results.length,
      successCount,
      failureCount: results.length - successCount,
    })
  } catch (err) {
    console.error('Process error:', err)
    return NextResponse.json({ error: err?.message || 'Processing failed' }, { status: 500 })
  }
}