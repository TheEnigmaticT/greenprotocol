import { createClient, type SupabaseClient } from '@supabase/supabase-js'

declare const adminClientBrand: unique symbol

export type AdminSupabaseClient = SupabaseClient & {
  readonly [adminClientBrand]: true
}

export function createAdminClient(): AdminSupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as AdminSupabaseClient
}
