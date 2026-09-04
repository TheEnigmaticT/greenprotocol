ALTER TABLE gpc_analysis_runs
  ADD COLUMN run_source TEXT NOT NULL DEFAULT 'human'
    CHECK (run_source IN ('human', 'sentinel')),
  ADD COLUMN protocol_input_tokens INTEGER
    CHECK (protocol_input_tokens IS NULL OR protocol_input_tokens >= 0);

CREATE INDEX idx_gpc_analysis_runs_source_created_at
  ON gpc_analysis_runs(run_source, created_at DESC);
