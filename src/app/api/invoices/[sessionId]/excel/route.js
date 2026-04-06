import { NextResponse } from 'next/server'
import { generateExcel } from '../../../../../lib/invoices/excelExport'

export async function GET(request, { params }) {
  try {
    const resolvedParams = await params
    const sessionId = resolvedParams.sessionId
    const invoices = global.invoiceSessions?.results.get(sessionId)

    if (!invoices) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const buf = generateExcel(invoices)

    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="invoice_discounts_${Date.now()}.xlsx"`,
      },
    })
  } catch (err) {
    console.error('Excel export error:', err)
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}