CREATE TABLE gpc_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  protocol_text TEXT NOT NULL,
  analysis_result JSONB NOT NULL,
  impact_delta JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE gpc_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
  ON gpc_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON gpc_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_gpc_analyses_user_id ON gpc_analyses(user_id);
CREATE INDEX idx_gpc_analyses_created_at ON gpc_analyses(created_at DESC);
