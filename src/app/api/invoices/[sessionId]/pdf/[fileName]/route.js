import { NextResponse } from 'next/server'
import { generateModifiedPdf, generateMultiModifiedPdf } from '../../../../../../lib/invoices/pdfProcessor'

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params
    const sessionId = resolvedParams.sessionId
    const fileName = resolvedParams.fileName
    const invoices = global.invoiceSessions?.results.get(sessionId)
    const pdfBuffers = global.invoiceSessions?.pdfs.get(sessionId)

    if (!invoices || !pdfBuffers) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const decodedName = decodeURIComponent(fileName)
    const fileInvoices = invoices.filter((i) => i.fileName === decodedName)
    const pdfBuffer = pdfBuffers.get(decodedName)

    if (fileInvoices.length === 0 || !pdfBuffer) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const modifiedPdf = fileInvoices.length > 1
      ? await generateMultiModifiedPdf(pdfBuffer, fileInvoices)
      : await generateModifiedPdf(pdfBuffer, fileInvoices[0])

    const { searchParams } = new URL(request.url)
    const inline = searchParams.get('inline') === 'true'
    const disposition = inline ? 'inline' : 'attachment'

    return new NextResponse(modifiedPdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${decodedName.replace(/\.pdf$/i, '_with_discount.pdf')}"`,
      },
    })
  } catch (err) {
    console.error('PDF download error:', err)
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}