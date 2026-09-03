CREATE TABLE gpc_canonical_scoring_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  protocol_fingerprint TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (user_id, protocol_fingerprint)
);

CREATE INDEX idx_gpc_canonical_scoring_snapshots_user_fingerprint
  ON gpc_canonical_scoring_snapshots (user_id, protocol_fingerprint);

ALTER TABLE gpc_canonical_scoring_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own canonical scoring snapshots"
  ON gpc_canonical_scoring_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own canonical scoring snapshots"
  ON gpc_canonical_scoring_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own canonical scoring snapshots"
  ON gpc_canonical_scoring_snapshots FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
