// Server-only Supabase client using the service-role key. NEVER import this
// into a client component — the service-role key bypasses RLS.
// Used by API routes (inbound email, notifications) that act without a user
// session.
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
