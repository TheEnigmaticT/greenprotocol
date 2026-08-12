DROP POLICY IF EXISTS "Users can update own talk conversations" ON public.gpc_talk_conversations;

CREATE OR REPLACE FUNCTION public.gpc_analyses_revision_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.revision_number <> OLD.revision_number + 1 THEN
    RAISE EXCEPTION 'Analysis updates must increment revision_number by one' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gpc_analyses_revision_guard ON public.gpc_analyses;
CREATE TRIGGER gpc_analyses_revision_guard
  BEFORE UPDATE ON public.gpc_analyses
  FOR EACH ROW EXECUTE FUNCTION public.gpc_analyses_revision_guard();

CREATE TABLE public.gpc_talk_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.gpc_talk_conversations(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type = 'approve_recommendation'),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  target_recommendation_id TEXT NOT NULL,
  label TEXT NOT NULL,
  already_applied BOOLEAN NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (conversation_id, action_type)
);

CREATE INDEX idx_gpc_talk_actions_user_id ON public.gpc_talk_actions(user_id);

ALTER TABLE public.gpc_talk_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own talk actions"
  ON public.gpc_talk_actions FOR SELECT
  USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.gpc_talk_actions FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.approve_scoped_recommendation(p_conversation_id UUID)
RETURNS TABLE (
  action_id UUID,
  recommendation_id TEXT,
  label TEXT,
  already_accepted BOOLEAN,
  revision_number INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_analysis public.gpc_analyses%ROWTYPE;
  v_existing public.gpc_talk_actions%ROWTYPE;
  v_recommendation_id TEXT;
  v_context_recommendation_id TEXT;
  v_recommendation JSONB;
  v_recommendation_count INTEGER;
  v_recommendation_index INTEGER;
  v_label TEXT;
  v_already_accepted BOOLEAN;
  v_action_id UUID;
  v_revision_number INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_conversation
  FROM public.gpc_talk_conversations
  WHERE id = p_conversation_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_existing
  FROM public.gpc_talk_actions
  WHERE conversation_id = v_conversation.id
    AND action_type = 'approve_recommendation'
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.target_recommendation_id,
      v_existing.label,
      v_existing.already_applied,
      v_existing.revision_number;
    RETURN;
  END IF;

  IF v_conversation.scope->>'kind' IS DISTINCT FROM 'recommendation'
    OR NULLIF(btrim(v_conversation.scope->>'recommendationId'), '') IS NULL THEN
    RAISE EXCEPTION 'Conversation does not have an approvable recommendation scope' USING ERRCODE = '22023';
  END IF;

  v_recommendation_id := btrim(v_conversation.scope->>'recommendationId');
  v_context_recommendation_id := NULLIF(btrim(v_conversation.context_snapshot->'scope'->>'recommendationId'), '');

  IF v_context_recommendation_id IS DISTINCT FROM v_recommendation_id THEN
    RAISE EXCEPTION 'Conversation scope integrity check failed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_analysis
  FROM public.gpc_analyses
  WHERE id = v_conversation.analysis_id
    AND user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped analysis not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::INTEGER INTO v_recommendation_count
  FROM jsonb_array_elements(COALESCE(v_analysis.analysis_result->'recommendations', '[]'::jsonb)) AS item
  WHERE item->>'id' = v_recommendation_id;

  IF v_recommendation_count <> 1 THEN
    RAISE EXCEPTION 'Scoped recommendation target is stale' USING ERRCODE = 'P0002';
  END IF;

  SELECT ordinality - 1, item
  INTO v_recommendation_index, v_recommendation
  FROM jsonb_array_elements(COALESCE(v_analysis.analysis_result->'recommendations', '[]'::jsonb)) WITH ORDINALITY AS candidates(item, ordinality)
  WHERE item->>'id' = v_recommendation_id;

  v_already_accepted := COALESCE((v_recommendation->>'isAccepted')::BOOLEAN, FALSE);
  v_label := NULLIF(btrim(v_recommendation->'alternative'->>'chemical'), '');
  IF v_label IS NULL THEN
    v_label := NULLIF(btrim(v_recommendation->'original'->>'chemical'), '');
  END IF;
  IF v_label IS NULL THEN
    v_label := v_recommendation_id;
  END IF;

  UPDATE public.gpc_analyses
  SET analysis_result = jsonb_set(
        v_analysis.analysis_result,
        ARRAY['recommendations', v_recommendation_index::TEXT, 'isAccepted'],
        'true'::jsonb,
        TRUE
      ),
      revision_number = v_analysis.revision_number + 1
  WHERE id = v_analysis.id
    AND revision_number = v_analysis.revision_number
  RETURNING revision_number INTO v_revision_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped analysis changed before approval' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.gpc_talk_actions (
    conversation_id,
    analysis_id,
    user_id,
    action_type,
    status,
    target_recommendation_id,
    label,
    already_applied,
    revision_number,
    completed_at
  ) VALUES (
    v_conversation.id,
    v_analysis.id,
    v_user_id,
    'approve_recommendation',
    'completed',
    v_recommendation_id,
    v_label,
    v_already_accepted,
    v_revision_number,
    now()
  )
  ON CONFLICT (conversation_id, action_type) DO NOTHING
  RETURNING id INTO v_action_id;

  IF v_action_id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.gpc_talk_actions
    WHERE conversation_id = v_conversation.id
      AND action_type = 'approve_recommendation';

    RETURN QUERY SELECT
      v_existing.id,
      v_existing.target_recommendation_id,
      v_existing.label,
      v_existing.already_applied,
      v_existing.revision_number;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_action_id,
    v_recommendation_id,
    v_label,
    v_already_accepted,
    v_revision_number;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_scoped_recommendation(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_scoped_recommendation(UUID) TO authenticated;
GRANT SELECT ON TABLE public.gpc_talk_actions TO authenticated;
