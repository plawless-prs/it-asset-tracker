// Shared server-side helper: turn an inbound email into a ticket.
// Used by both the Graph webhook route and the manual /inbound route.
// De-duplicates on source_message_id so a repeated Graph notification (or a
// re-POST) never creates a second ticket.
import { createAdminClient } from './supabaseAdmin'

export async function createEmailTicket({ from, subject, text, queue, messageId }) {
  const supabase = createAdminClient()

  const fromNorm = String(from || '').trim().toLowerCase()

  // Map the sender to an existing profile by email; else keep the raw address.
  let requester_id = null
  if (fromNorm) {
    const { data: p } = await supabase.from('profiles').select('id').ilike('email', fromNorm).limit(1).maybeSingle()
    requester_id = p?.id || null
  }

  const row = {
    title: String(subject || '').trim() || '(no subject)',
    description: String(text || '').trim(),
    source: 'email',
    category: queue === 'priceupdate' ? 'price_update' : 'other',
    priority: 'medium',
    requester_id,
    requester_email: fromNorm || null,
  }

  if (messageId) {
    row.source_message_id = messageId
    // Ignore duplicates by message id. Empty result = already existed.
    const { data, error } = await supabase
      .from('tickets')
      .upsert(row, { onConflict: 'source_message_id', ignoreDuplicates: true })
      .select('id, number')
    if (error) return { error }
    const created = data && data[0]
    return { data: created || null, duplicate: !created }
  }

  const { data, error } = await supabase.from('tickets').insert(row).select('id, number').single()
  return { data, error }
}
