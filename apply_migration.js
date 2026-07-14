const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  'https://jjxvlofcnyiqrtvwccsq.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqeHZsb2ZjbnlpcXJ0dndjY3NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODc3MzUsImV4cCI6MjA5MDA2MzczNX0.pasppCAMkOZMD74_bl48svKIofH6wP6EgjRqBSba_Ic'
);

const migration = fs.readFileSync('supabase/migrations/20260510000000_create_vector_search.sql', 'utf8');

(async () => {
  try {
    console.log('Applying migration...');
    const { data, error } = await supabase.rpc('exec_sql', { sql: migration });
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Migration applied successfully');
    }
  } catch (err) {
    console.error('Exception:', err.message);
  }
})();
