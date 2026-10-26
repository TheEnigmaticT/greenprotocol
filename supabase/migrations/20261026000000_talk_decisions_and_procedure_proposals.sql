-- Chat actions: recommendation approve/reject receipts and reviewable procedure-edit proposals.
--
-- 1. gpc_talk_actions may now hold several decisions per conversation
--    (approve -> reject -> approve). The old UNIQUE (conversation_id, action_type)
--    made the first approval permanent for the conversation. Ordering is by a
--    monotonic identity column that is assigned while the conversation row lock
--    is held, so "latest decision" is well defined even though now() is the
--    transaction start time.
-- 2. Idempotency: a decision RPC replays the latest receipt only when that receipt
--    is the same decision on the same recommendation AND the analysis revision has
--    not moved since it was written. Any intervening change (another decision, a
--    UI edit, a re-score) bumps the revision, so the next explicit request is
--    applied again instead of being swallowed.
-- 3. gpc_talk_proposals stores model-proposed procedure edits until the scientist
--    applies or cancels them. Nothing here changes gpc_analyses.

-- ---------------------------------------------------------------------------
-- Decision receipts
-- ---------------------------------------------------------------------------

ALTER TABLE public.gpc_talk_actions
  DROP CONSTRAINT IF EXISTS gpc_talk_actions_action_type_check;
ALTER TABLE public.gpc_talk_actions
  ADD CONSTRAINT gpc_talk_actions_action_type_check
  CHECK (action_type IN ('approve_recommendation', 'reject_recommendation'));

ALTER TABLE public.gpc_talk_actions
  DROP CONSTRAINT IF EXISTS gpc_talk_actions_conversation_id_action_type_key;

ALTER TABLE public.gpc_talk_actions
  ADD COLUMN IF NOT EXISTS decision_sequence BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS idx_gpc_talk_actions_conversation_latest
  ON public.gpc_talk_actions(conversation_id, decision_sequence DESC);

-- Single implementation for both decisions. Not callable by API roles: only the
-- SECURITY DEFINER wrappers below reach it.
CREATE OR REPLACE FUNCTION public.gpc_decide_scoped_recommendation(
  p_conversation_id UUID,
  p_action_type TEXT
)
RETURNS public.gpc_talk_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_target_accepted BOOLEAN;
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_analysis public.gpc_analyses%ROWTYPE;
  v_latest public.gpc_talk_actions%ROWTYPE;
  v_action public.gpc_talk_actions%ROWTYPE;
  v_recommendation_id TEXT;
  v_context_recommendation_id TEXT;
  v_recommendation JSONB;
  v_recommendation_count INTEGER;
  v_recommendation_index INTEGER;
  v_label TEXT;
  v_already_applied BOOLEAN;
  v_revision_number INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  IF p_action_type = 'approve_recommendation' THEN
    v_target_accepted := TRUE;
  ELSIF p_action_type = 'reject_recommendation' THEN
    v_target_accepted := FALSE;
  ELSE
    RAISE EXCEPTION 'Unsupported recommendation decision' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_conversation
  FROM public.gpc_talk_conversations c
  WHERE c.id = p_conversation_id
    AND c.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.scope->>'kind' IS DISTINCT FROM 'recommendation'
    OR NULLIF(btrim(v_conversation.scope->>'recommendationId'), '') IS NULL THEN
    RAISE EXCEPTION 'Conversation does not have a decidable recommendation scope' USING ERRCODE = '22023';
  END IF;

  v_recommendation_id := btrim(v_conversation.scope->>'recommendationId');
  v_context_recommendation_id := NULLIF(btrim(v_conversation.context_snapshot->'scope'->>'recommendationId'), '');

  IF v_context_recommendation_id IS DISTINCT FROM v_recommendation_id THEN
    RAISE EXCEPTION 'Conversation scope integrity check failed' USING ERRCODE = '22023';
  END IF;

  SELECT a.* INTO v_analysis
  FROM public.gpc_analyses a
  WHERE a.id = v_conversation.analysis_id
    AND a.user_id = v_user_id
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

  SELECT candidates.ordinality - 1, candidates.item
  INTO v_recommendation_index, v_recommendation
  FROM jsonb_array_elements(COALESCE(v_analysis.analysis_result->'recommendations', '[]'::jsonb))
    WITH ORDINALITY AS candidates(item, ordinality)
  WHERE candidates.item->>'id' = v_recommendation_id;

  -- Double-submit replay: same decision, same target, nothing has changed since.
  SELECT t.* INTO v_latest
  FROM public.gpc_talk_actions t
  WHERE t.conversation_id = v_conversation.id
    AND t.status = 'completed'
  ORDER BY t.decision_sequence DESC
  LIMIT 1;

  IF FOUND
    AND v_latest.action_type = p_action_type
    AND v_latest.target_recommendation_id = v_recommendation_id
    AND v_latest.revision_number = v_analysis.revision_number THEN
    RETURN v_latest;
  END IF;

  -- Only an explicit isAccepted value counts as already decided; a missing value is pending.
  v_already_applied := (v_recommendation->>'isAccepted')::BOOLEAN IS NOT DISTINCT FROM v_target_accepted;
  v_label := NULLIF(btrim(v_recommendation->'alternative'->>'chemical'), '');
  IF v_label IS NULL THEN
    v_label := NULLIF(btrim(v_recommendation->'original'->>'chemical'), '');
  END IF;
  IF v_label IS NULL THEN
    v_label := v_recommendation_id;
  END IF;

  IF v_already_applied THEN
    v_revision_number := v_analysis.revision_number;
  ELSE
    UPDATE public.gpc_analyses a
    SET analysis_result = jsonb_set(
          v_analysis.analysis_result,
          ARRAY['recommendations', v_recommendation_index::TEXT, 'isAccepted'],
          to_jsonb(v_target_accepted),
          TRUE
        ),
        revision_number = v_analysis.revision_number + 1
    WHERE a.id = v_analysis.id
      AND a.revision_number = v_analysis.revision_number
    RETURNING a.revision_number INTO v_revision_number;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Scoped analysis changed before the decision' USING ERRCODE = '40001';
    END IF;
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
    p_action_type,
    'completed',
    v_recommendation_id,
    v_label,
    v_already_applied,
    v_revision_number,
    now()
  )
  RETURNING * INTO v_action;

  RETURN v_action;
END;
$$;

REVOKE ALL ON FUNCTION public.gpc_decide_scoped_recommendation(UUID, TEXT) FROM public, anon, authenticated;

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
BEGIN
  RETURN QUERY
  SELECT d.id, d.target_recommendation_id, d.label, d.already_applied, d.revision_number
  FROM public.gpc_decide_scoped_recommendation(p_conversation_id, 'approve_recommendation') d;
END;
$$;

-- already_accepted is kept as the column name for client compatibility; for a
-- rejection it means "was already rejected".
CREATE OR REPLACE FUNCTION public.reject_scoped_recommendation(p_conversation_id UUID)
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
BEGIN
  RETURN QUERY
  SELECT d.id, d.target_recommendation_id, d.label, d.already_applied, d.revision_number
  FROM public.gpc_decide_scoped_recommendation(p_conversation_id, 'reject_recommendation') d;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_scoped_recommendation(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION public.reject_scoped_recommendation(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_scoped_recommendation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_scoped_recommendation(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Procedure-edit proposals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.gpc_talk_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.gpc_talk_conversations(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_revision_number INTEGER NOT NULL CHECK (base_revision_number > 0),
  base_text_hash TEXT NOT NULL CHECK (base_text_hash ~ '^[0-9a-f]{64}$'),
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 300),
  -- Mirrors MIN_PROTOCOL_CHARS / MAX_PROTOCOL_CHARS in lib/protocol-limits.ts.
  proposed_text TEXT NOT NULL CHECK (char_length(proposed_text) BETWEEN 20 AND 50000),
  diff TEXT NOT NULL CHECK (char_length(diff) BETWEEN 1 AND 200000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'stale')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gpc_talk_proposals_conversation
  ON public.gpc_talk_proposals(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpc_talk_proposals_user_id
  ON public.gpc_talk_proposals(user_id);
-- At most one reviewable proposal per conversation; a newer proposal supersedes the older one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gpc_talk_proposals_one_pending
  ON public.gpc_talk_proposals(conversation_id) WHERE status = 'pending';

ALTER TABLE public.gpc_talk_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own talk proposals" ON public.gpc_talk_proposals;
CREATE POLICY "Users can view own talk proposals"
  ON public.gpc_talk_proposals FOR SELECT
  USING (auth.uid() = user_id);

-- Hosted default privileges grant everything (including TRUNCATE) to API roles; keep only owner-scoped reads.
REVOKE ALL ON TABLE public.gpc_talk_proposals FROM anon, authenticated, public;
GRANT SELECT ON TABLE public.gpc_talk_proposals TO authenticated;

CREATE OR REPLACE FUNCTION public.create_talk_procedure_proposal(
  p_conversation_id UUID,
  p_summary TEXT,
  p_proposed_text TEXT,
  p_diff TEXT,
  p_base_text_hash TEXT
)
RETURNS TABLE (proposal_id UUID, base_revision_number INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_analysis public.gpc_analyses%ROWTYPE;
  v_proposal_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_conversation
  FROM public.gpc_talk_conversations c
  WHERE c.id = p_conversation_id
    AND c.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_conversation.status <> 'active' THEN
    RAISE EXCEPTION 'Conversation is closed' USING ERRCODE = '55000';
  END IF;

  -- The read-only index scope (recommendationIndex) can never carry a proposal.
  IF v_conversation.scope->>'kind' = 'recommendation'
    AND NULLIF(btrim(v_conversation.scope->>'recommendationId'), '') IS NULL THEN
    RAISE EXCEPTION 'Read-only conversations cannot propose procedure edits' USING ERRCODE = '22023';
  END IF;

  SELECT a.* INTO v_analysis
  FROM public.gpc_analyses a
  WHERE a.id = v_conversation.analysis_id
    AND a.user_id = v_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped analysis not found' USING ERRCODE = 'P0002';
  END IF;

  IF encode(sha256(convert_to(v_analysis.protocol_text, 'UTF8')), 'hex') <> p_base_text_hash THEN
    RAISE EXCEPTION 'Saved procedure changed before the proposal was stored' USING ERRCODE = '40001';
  END IF;

  UPDATE public.gpc_talk_proposals p
  SET status = 'cancelled', decided_at = now()
  WHERE p.conversation_id = v_conversation.id
    AND p.status = 'pending';

  INSERT INTO public.gpc_talk_proposals (
    conversation_id, analysis_id, user_id, base_revision_number, base_text_hash,
    summary, proposed_text, diff
  ) VALUES (
    v_conversation.id, v_analysis.id, v_user_id, v_analysis.revision_number, p_base_text_hash,
    p_summary, p_proposed_text, p_diff
  )
  RETURNING id INTO v_proposal_id;

  RETURN QUERY SELECT v_proposal_id, v_analysis.revision_number;
END;
$$;

-- outcome is 'applied' (the scientist confirmed; the caller now re-runs the edited
-- text as a NEW analysis) or 'stale' (the saved procedure no longer matches the
-- text the proposal was written against). Neither outcome modifies gpc_analyses.
CREATE OR REPLACE FUNCTION public.apply_talk_procedure_proposal(
  p_conversation_id UUID,
  p_proposal_id UUID
)
RETURNS TABLE (
  outcome TEXT,
  proposal_id UUID,
  summary TEXT,
  proposed_text TEXT,
  base_revision_number INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_proposal public.gpc_talk_proposals%ROWTYPE;
  v_analysis public.gpc_analyses%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_conversation
  FROM public.gpc_talk_conversations c
  WHERE c.id = p_conversation_id
    AND c.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.* INTO v_proposal
  FROM public.gpc_talk_proposals p
  WHERE p.id = p_proposal_id
    AND p.conversation_id = v_conversation.id
    AND p.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procedure proposal not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Procedure proposal is no longer pending' USING ERRCODE = '55000';
  END IF;

  SELECT a.* INTO v_analysis
  FROM public.gpc_analyses a
  WHERE a.id = v_proposal.analysis_id
    AND a.user_id = v_user_id
  FOR SHARE;

  IF NOT FOUND
    OR encode(sha256(convert_to(v_analysis.protocol_text, 'UTF8')), 'hex') <> v_proposal.base_text_hash THEN
    UPDATE public.gpc_talk_proposals p
    SET status = 'stale', decided_at = now()
    WHERE p.id = v_proposal.id;
    RETURN QUERY SELECT 'stale'::TEXT, v_proposal.id, v_proposal.summary, NULL::TEXT, v_proposal.base_revision_number;
    RETURN;
  END IF;

  UPDATE public.gpc_talk_proposals p
  SET status = 'applied', decided_at = now()
  WHERE p.id = v_proposal.id;

  RETURN QUERY SELECT 'applied'::TEXT, v_proposal.id, v_proposal.summary, v_proposal.proposed_text, v_proposal.base_revision_number;
END;
$$;

-- Cancelling is idempotent; an applied or stale proposal cannot be cancelled.
CREATE OR REPLACE FUNCTION public.cancel_talk_procedure_proposal(
  p_conversation_id UUID,
  p_proposal_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_proposal public.gpc_talk_proposals%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_proposal
  FROM public.gpc_talk_proposals p
  WHERE p.id = p_proposal_id
    AND p.conversation_id = p_conversation_id
    AND p.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Procedure proposal not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_proposal.status = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'Procedure proposal is no longer pending' USING ERRCODE = '55000';
  END IF;

  UPDATE public.gpc_talk_proposals p
  SET status = 'cancelled', decided_at = now()
  WHERE p.id = v_proposal.id;

  RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.create_talk_procedure_proposal(UUID, TEXT, TEXT, TEXT, TEXT) FROM public, anon;
REVOKE ALL ON FUNCTION public.apply_talk_procedure_proposal(UUID, UUID) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_talk_procedure_proposal(UUID, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_talk_procedure_proposal(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_talk_procedure_proposal(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_talk_procedure_proposal(UUID, UUID) TO authenticated;
