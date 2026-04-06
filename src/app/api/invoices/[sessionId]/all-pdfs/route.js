import { NextResponse } from 'next/server'
import { generateModifiedPdf, generateMultiModifiedPdf } from '../../../../../lib/invoices/pdfProcessor'
import archiver from 'archiver'
import { PassThrough } from 'stream'

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params
    const sessionId = resolvedParams.sessionId
    const invoices = global.invoiceSessions?.results.get(sessionId)
    const pdfBuffers = global.invoiceSessions?.pdfs.get(sessionId)

    if (!invoices || !pdfBuffers) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // Group invoices by filename
    const byFile = new Map()
    for (const inv of invoices) {
      const group = byFile.get(inv.fileName) ?? []
      group.push(inv)
      byFile.set(inv.fileName, group)
    }

    const archive = archiver('zip', { zlib: { level: 6 } })
    const passthrough = new PassThrough()
    archive.pipe(passthrough)

    for (const [fname, group] of byFile) {
      const pdfBuffer = pdfBuffers.get(fname)
      if (!pdfBuffer) continue
      try {
        const modifiedPdf = group.length > 1
          ? await generateMultiModifiedPdf(pdfBuffer, group)
          : await generateModifiedPdf(pdfBuffer, group[0])
        const outName = fname.replace(/\.pdf$/i, '_with_discount.pdf')
        archive.append(modifiedPdf, { name: outName })
      } catch (e) {
        console.error(`Skipping ${fname}:`, e)
      }
    }

    archive.finalize()

    // Convert Node stream to Web ReadableStream
    const readable = new ReadableStream({
      start(controller) {
        passthrough.on('data', (chunk) => controller.enqueue(chunk))
        passthrough.on('end', () => controller.close())
        passthrough.on('error', (err) => controller.error(err))
      },
    })

    return new NextResponse(readable, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="invoices_with_discounts_${Date.now()}.zip"`,
      },
    })
  } catch (err) {
    console.error('ZIP download error:', err)
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}