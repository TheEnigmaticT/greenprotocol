CREATE TABLE public.gpc_recommendation_rejection_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recommendation_id TEXT,
  recommendation_index INTEGER NOT NULL CHECK (recommendation_index >= 0),
  reason TEXT NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gpc_recommendation_rejection_feedback_analysis
  ON public.gpc_recommendation_rejection_feedback(analysis_id, created_at DESC);
CREATE INDEX idx_gpc_recommendation_rejection_feedback_user
  ON public.gpc_recommendation_rejection_feedback(user_id, created_at DESC);

ALTER TABLE public.gpc_recommendation_rejection_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recommendation rejection feedback"
  ON public.gpc_recommendation_rejection_feedback FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recommendation rejection feedback"
  ON public.gpc_recommendation_rejection_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

REVOKE UPDATE, DELETE ON TABLE public.gpc_recommendation_rejection_feedback FROM anon, authenticated, public;
