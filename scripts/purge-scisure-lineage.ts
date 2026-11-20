import { createAdminClient } from '@/lib/supabase/admin'

/** Invoke from a server-owned scheduler; never expose this RPC to browsers. */
async function main() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Cleanup requires the service-role client.')
  const { data, error } = await createAdminClient().rpc('gpc_purge_expired_scisure_lineage' as never)
  if (error) throw error
  console.log(JSON.stringify({ worker: 'scisure-cleanup', purgedJobs: data }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
