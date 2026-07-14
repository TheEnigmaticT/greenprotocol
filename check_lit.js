const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://jjxvlofcnyiqrtvwccsq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpqeHZsb2ZjbnlpcXJ0dndjY3NxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0ODc3MzUsImV4cCI6MjA5MDA2MzczNX0.pasppCAMkOZMD74_bl48svKIofH6wP6EgjRqBSba_Ic'
);

(async () => {
  const { data, error, count } = await supabase
    .from('literature_precedents')
    .select('*', { count: 'exact', head: false })
    .limit(3);
  
  console.log('Count:', count);
  console.log('Data:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
})();
