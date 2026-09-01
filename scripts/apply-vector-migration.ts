/**
 * Apply the vector search migration to the database.
 * This creates the literature_precedents table if it doesn't exist.
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
// Service role only: literature tables are RLS-locked (writes revoked from anon).
// The anon key can no longer write here, so never fall back to it.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for literature ingestion')

async function main() {
  console.log('Applying vector search migration...\n')

  // Read the migration file
  const migrationPath = path.join(__dirname, '../supabase/migrations/20260510000000_create_vector_search.sql')
  const migration = fs.readFileSync(migrationPath, 'utf8')

  // Split into individual statements (PostgreSQL doesn't support multi-statement execution via the JS client)
  const statements = migration
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))

  // SUPABASE_KEY is guaranteed non-null by the module-level guard above;
  // TS loses that narrowing across this function boundary.
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY!)

  console.log(`Executing ${statements.length} SQL statements...\n`)

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i] + ';'
    
    // Skip comments
    if (stmt.trim().startsWith('--')) continue
    
    try {
      console.log(`[${i + 1}/${statements.length}] Executing...`)
      
      // Use the raw query method
      const { error } = await supabase.rpc('exec', { sql: stmt }).single()
      
      if (error) {
        // Try direct query if RPC doesn't work
        console.warn('  RPC exec failed, trying direct query...')
        const sqlClient = supabase as unknown as {
          sql: (query: string) => Promise<{ error?: { message: string } | null }>
        }
        const { error: queryError } = await sqlClient.sql(stmt)
        
        if (queryError) {
          console.error(`  ✗ Failed:`, queryError.message)
          console.error(`  Statement: ${stmt.substring(0, 100)}...`)
        } else {
          console.log(`  ✓ Success`)
        }
      } else {
        console.log(`  ✓ Success`)
      }
    } catch (err) {
      console.error(`  ✗ Exception:`, err instanceof Error ? err.message : String(err))
    }
  }

  console.log('\n✅ Migration application complete')
  console.log('\nNote: If statements failed, you may need to apply this migration manually via the Supabase SQL editor.')
  console.log('Visit: https://supabase.com/dashboard/project/jjxvlofcnyiqrtvwccsq/sql/new')
}

main().catch(console.error)
