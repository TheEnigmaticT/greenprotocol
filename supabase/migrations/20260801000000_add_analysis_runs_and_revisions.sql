CREATE TABLE gpc_analysis_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE gpc_analysis_traces
  ADD COLUMN analysis_run_id UUID REFERENCES gpc_analysis_runs(id) ON DELETE SET NULL;

ALTER TABLE gpc_dedup_log
  ADD COLUMN analysis_run_id UUID REFERENCES gpc_analysis_runs(id) ON DELETE SET NULL;

ALTER TABLE gpc_analyses
  ADD COLUMN source_analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE RESTRICT,
  ADD COLUMN revision_number INTEGER NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  ADD COLUMN source_snapshot_hash TEXT;

CREATE UNIQUE INDEX idx_gpc_analyses_source_revision
  ON gpc_analyses(source_analysis_id, revision_number)
  WHERE source_analysis_id IS NOT NULL;

CREATE INDEX idx_gpc_analysis_runs_analysis_id ON gpc_analysis_runs(analysis_id);
CREATE INDEX idx_gpc_analysis_runs_user_id ON gpc_analysis_runs(user_id);
CREATE INDEX idx_gpc_analysis_traces_run_id ON gpc_analysis_traces(analysis_run_id);
CREATE INDEX idx_gpc_dedup_log_run_id ON gpc_dedup_log(analysis_run_id);

ALTER TABLE gpc_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analysis runs"
  ON gpc_analysis_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analysis runs"
  ON gpc_analysis_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analysis runs"
  ON gpc_analysis_runs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own analysis traces"
  ON gpc_analysis_traces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analysis traces"
  ON gpc_analysis_traces FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own dedup logs"
  ON gpc_dedup_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dedup logs"
  ON gpc_dedup_log FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
