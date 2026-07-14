-- ─── GPC Analysis Traces Table ─────────────────────────────────────
-- Store per-LLM-call traces: model, tokens, latency, request/response
CREATE TABLE gpc_analysis_traces (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  
  -- Call metadata
  call_label TEXT NOT NULL,              -- e.g. "parse", "principle-3", "assemble"
  model TEXT NOT NULL,                   -- e.g. "claude-sonnet-4-5-20250929"
  phase TEXT NOT NULL,                   -- e.g. "parse", "principle", "assemble"
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER NOT NULL,
  
  -- Usage
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  
  -- Request/response (for forensics)
  request_payload JSONB NOT NULL,        -- {system, userContent, schema}
  response_payload JSONB NOT NULL,       -- {stop_reason, content, usage}
  
  -- Result metadata
  stop_reason TEXT NOT NULL,             -- e.g. "tool_use", "end_turn"
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: Users can only view their own traces
ALTER TABLE gpc_analysis_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own traces"
  ON gpc_analysis_traces FOR SELECT
  USING (auth.uid() = user_id);

-- Indexes for common queries
CREATE INDEX idx_gpc_analysis_traces_analysis_id ON gpc_analysis_traces(analysis_id);
CREATE INDEX idx_gpc_analysis_traces_user_id ON gpc_analysis_traces(user_id);
CREATE INDEX idx_gpc_analysis_traces_created_at ON gpc_analysis_traces(created_at DESC);
CREATE INDEX idx_gpc_analysis_traces_model ON gpc_analysis_traces(model);
CREATE INDEX idx_gpc_analysis_traces_phase ON gpc_analysis_traces(phase);

-- ─── GPC Dedup Log Table ────────────────────────────────────────────
-- Store pre-dedup recommendations + merge map for transparency
CREATE TABLE gpc_dedup_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  
  -- Pre-dedup state
  raw_recommendations JSONB NOT NULL,    -- Array of recommendations before merge
  raw_count INTEGER NOT NULL,
  
  -- Post-dedup state
  deduped_recommendations JSONB NOT NULL, -- Array of recommendations after merge
  deduped_count INTEGER NOT NULL,
  
  -- Merge map: shows which raw recs collapsed into which final recs
  merge_map JSONB NOT NULL,              -- { "step:chemical": [raw_indices] }
  
  -- Metadata
  dedup_rules TEXT NOT NULL DEFAULT 'severity+confidence',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: Users can only view their own dedup logs
ALTER TABLE gpc_dedup_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dedup logs"
  ON gpc_dedup_log FOR SELECT
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_gpc_dedup_log_analysis_id ON gpc_dedup_log(analysis_id);
CREATE INDEX idx_gpc_dedup_log_user_id ON gpc_dedup_log(user_id);
CREATE INDEX idx_gpc_dedup_log_created_at ON gpc_dedup_log(created_at DESC);

-- Comment for documentation
COMMENT ON TABLE gpc_analysis_traces IS 'Per-LLM-call traces for cost accounting and forensics';
COMMENT ON TABLE gpc_dedup_log IS 'Pre/post deduplication state for recommendation transparency';
