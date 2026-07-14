/**
 * Quick test to verify literature search works
 * (Assumes table already exists)
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://jjxvlofcnyiqrtvwccsq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqeHZsb2ZjbnlpcXJ0dndjY3NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODc3MzUsImV4cCI6MjA5MDA2MzczNX0.pasppCAMkOZMD74_bl48svKIofH6wP6EgjRqBSba_Ic'
)

console.log('Testing literature_precedents table...\n')

// Check if table exists
const { data, error, count } = await supabase
  .from('literature_precedents')
  .select('*', { count: 'exact', head: false })
  .limit(3)

if (error) {
  console.error('❌ Error:', error.message)
  console.error('\nThe table does not exist yet. Please apply the migration first:')
  console.error('See scripts/literature-ingestion/MANUAL_SETUP.md')
} else {
  console.log('✅ Table exists!')
  console.log(`Found ${count} entries`)
  if (data && data.length > 0) {
    console.log('\nSample entry:')
    console.log(JSON.stringify(data[0], null, 2))
  } else {
    console.log('\nTable is empty. Ready for ingestion.')
  }
}
