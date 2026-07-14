# Manual Database Setup

The `literature_precedents` table must be created before running ingestion scripts.

## Step 1: Apply Migration

Visit the Supabase SQL Editor:
https://supabase.com/dashboard/project/jjxvlofcnyiqrtvwccsq/sql/new

Copy and paste the contents of `supabase/migrations/20260510000000_create_vector_search.sql` and run it.

Or run this command from the repository root:

```bash
cat supabase/migrations/20260510000000_create_vector_search.sql
```

Then copy the output and paste it into the SQL editor.

## Step 2: Verify Table Exists

Run this query in the SQL editor:

```sql
SELECT COUNT(*) FROM literature_precedents;
```

You should see `0` (empty table, but no error).

## Step 3: Seed CHEM21 Guide

This is the foundational reference document for green solvents:

```bash
npx tsx scripts/literature-ingestion/seed-chem21.ts
```

## Step 4: Run Ingestion Scripts

Each script will fetch and ingest open-access literature:

```bash
# PubMed Central (Europe PMC API)
npx tsx scripts/literature-ingestion/ingest-pmc.ts

# CrossRef (Green Chemistry journal, ACS Sustainable Chem & Eng)
npx tsx scripts/literature-ingestion/ingest-crossref.ts

# ChemRxiv preprints
npx tsx scripts/literature-ingestion/ingest-chemrxiv.ts
```

## Expected Results

After running all scripts, you should have:
- **1** CHEM21 guide entry
- **20-50** PMC articles
- **20-50** CrossRef articles
- **10-30** ChemRxiv preprints

Total: **~50-150** literature entries

## Verification

Check the ingestion results:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
(async () => {
  const { count } = await supabase.from('literature_precedents').select('*', { count: 'exact', head: true });
  console.log('Total literature entries:', count);
})();
"
```

## Troubleshooting

### "Could not find the table 'public.literature_precedents'"

The migration hasn't been applied. Go to Step 1.

### "Rate limited" or "Too many requests"

The ingestion scripts have built-in rate limiting (500ms between requests), but external APIs may still rate limit. Wait 10 minutes and re-run the script. It will skip already-ingested DOIs.

### "No results found"

Some APIs may not return results for certain queries. This is expected. The ingestion scripts will log how many articles were found for each query.

### Need the service role key?

Check the Supabase dashboard:
https://supabase.com/dashboard/project/jjxvlofcnyiqrtvwccsq/settings/api

The service role key is under "Project API keys" → "service_role".

Add it to `.env.local`:

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```
