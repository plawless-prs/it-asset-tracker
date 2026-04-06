import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { sessionId, invoices } = await request.json()
    if (!sessionId) return NextResponse.json({ error: 'No sessionId' }, { status: 400 })

    if (global.invoiceSessions) {
      global.invoiceSessions.results.set(sessionId, invoices)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}