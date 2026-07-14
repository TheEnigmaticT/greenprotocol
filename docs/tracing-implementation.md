# Pipeline Tracing Implementation

## Overview

Implemented comprehensive tracing for LLM calls and deduplication operations in the GreenChemistry.ai pipeline to enable cost accounting, decision forensics, and recommendation transparency.

## Database Schema

### `gpc_analysis_traces` Table
Stores per-LLM-call traces including:
- Call metadata (label, model, phase)
- Timing (started_at, completed_at, latency_ms)
- Token usage (input_tokens, output_tokens, total_tokens)
- Request/response payloads (truncated for storage)
- Success status and error messages

### `gpc_dedup_log` Table
Stores pre/post deduplication state including:
- Raw recommendations (before merge)
- Deduped recommendations (after merge)
- Merge map (shows which raw recs collapsed into which final recs)
- Dedup rules applied

## Implementation

### 1. Trace Module (`lib/trace.ts`)
Created helper module with:
- `logLLMTrace()` - Logs individual LLM API calls
- `logDedupTrace()` - Logs deduplication operations
- `estimateCost()` - Rough cost estimation based on token usage
- `getAnalysisCostReport()` - Fetches aggregated cost report for an analysis

### 2. Pipeline Integration (`lib/pipeline.ts`)
Updated pipeline functions to accept `CallContext`:
```typescript
interface CallContext {
  userId?: string
  analysisId?: string
  supabase?: SupabaseClient
}
```

Modified functions:
- `callClaude()` - Now logs trace in finally block
- `parseProtocol()` - Accepts context parameter
- `evaluatePrinciple()` - Accepts context parameter
- `evaluateAllPrinciples()` - Accepts context parameter
- `assembleResult()` - Accepts context parameter
- `deduplicateRecommendations()` - Tracks merge map and logs dedup trace
- `analyzeProtocol()` - Main entry point, passes context through

### 3. API Route Integration (`app/api/analyze/route.ts`)
Updated to pass tracing context:
```typescript
const analysisResult = await analyzeProtocol(protocolText, send, {
  userId: user.id,
  supabase,
})
```

## Features

### Cost Accounting
- Track token usage per call and phase
- Estimate costs based on Anthropic pricing
- Aggregate reports per analysis

### Decision Forensics
- Store full request/response payloads (truncated)
- Track which principle evaluations succeeded/failed
- Link traces to specific analyses

### Dedup Transparency
- See exactly which recommendations were merged
- Understand why duplicates were collapsed
- Trace merge rules applied

## Data Retention

- Traces are automatically deleted when parent analysis is deleted (CASCADE)
- Request/response payloads are truncated to 500 chars to manage storage
- RLS policies ensure users can only see their own traces

## Usage Examples

### Query traces for an analysis
```sql
SELECT call_label, model, latency_ms, input_tokens, output_tokens, stop_reason
FROM gpc_analysis_traces
WHERE analysis_id = '<uuid>'
ORDER BY created_at;
```

### Calculate cost for an analysis
```typescript
const report = await getAnalysisCostReport(analysisId, supabase)
console.log(`Total cost: $${report.estimated_cost_usd.toFixed(4)}`)
console.log(`Total tokens: ${report.total_tokens}`)
console.log(`Calls by phase:`, report.calls_by_phase)
```

### View dedup logic
```sql
SELECT 
  raw_count,
  deduped_count,
  merge_map
FROM gpc_dedup_log
WHERE analysis_id = '<uuid>';
```

## Future Enhancements

1. **Cost Analytics Dashboard** - UI to visualize cost trends over time
2. **Forensics Viewer** - UI to inspect individual LLM calls and their reasoning
3. **Dedup Audit Trail** - Show users why certain recommendations were merged
4. **Model Version Tracking** - Track which model versions were used
5. **Performance Monitoring** - Alert on slow calls or high token usage

## Testing

To test the implementation:
1. Run a sample analysis: `POST /api/analyze`
2. Check `gpc_analysis_traces` table for ~15 entries
3. Check `gpc_dedup_log` table for 1 entry
4. Verify traces are linked to the correct `user_id`
5. Test cost report generation

## Migration

Run the migration:
```bash
cd supabase
supabase migration up
```

Or manually apply:
```bash
psql -f migrations/20260713000000_create_trace_tables.sql
```

## Files Changed

- `supabase/migrations/20260713000000_create_trace_tables.sql` - Database schema
- `lib/trace.ts` - Trace logging helpers
- `lib/pipeline.ts` - Pipeline integration
- `app/api/analyze/route.ts` - API route integration
- `components/PrincipleSection.tsx` - Fixed syntax error (unrelated)

## Notes

- Traces are logged asynchronously (void promise) to avoid blocking pipeline
- Tracing failures are logged but don't break the pipeline
- `analysis_id` is nullable - traces created during execution can be linked later
- RLS policies protect user privacy
- Storage is minimal (~15 JSONB rows per analysis)
