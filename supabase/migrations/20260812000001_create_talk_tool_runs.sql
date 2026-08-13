CREATE TABLE public.gpc_talk_tool_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.gpc_talk_conversations(id) ON DELETE CASCADE,
  analysis_id UUID NOT NULL REFERENCES public.gpc_analyses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_message_id UUID REFERENCES public.gpc_talk_messages(id) ON DELETE SET NULL,
  assistant_message_id UUID REFERENCES public.gpc_talk_messages(id) ON DELETE SET NULL,
  turn_id UUID NOT NULL,
  provider_round INTEGER NOT NULL CHECK (provider_round >= 0),
  call_id TEXT NOT NULL CHECK (char_length(call_id) BETWEEN 1 AND 200),
  tool_name TEXT NOT NULL CHECK (char_length(tool_name) BETWEEN 1 AND 100),
  validated_arguments JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'timed_out', 'cancelled', 'skipped_limit')),
  reason_code TEXT NOT NULL CHECK (reason_code IN ('none', 'deadline_exceeded', 'client_cancelled', 'call_limit_exceeded', 'invalid_request', 'tool_error', 'diagnostic_write_failed')),
  reason_detail TEXT CHECK (reason_detail IS NULL OR char_length(reason_detail) <= 500),
  dispatch_budget_ms INTEGER CHECK (dispatch_budget_ms IS NULL OR dispatch_budget_ms >= 0),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  telemetry JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, turn_id, call_id)
);

ALTER TABLE public.gpc_talk_tool_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own talk tool runs"
  ON public.gpc_talk_tool_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.record_scoped_tool_run(
  p_user_id UUID,
  p_conversation_id UUID,
  p_user_message_id UUID,
  p_turn_id UUID,
  p_provider_round INTEGER,
  p_call_id TEXT,
  p_tool_name TEXT,
  p_validated_arguments JSONB,
  p_status TEXT,
  p_reason_code TEXT,
  p_reason_detail TEXT,
  p_dispatch_budget_ms INTEGER,
  p_started_at TIMESTAMPTZ,
  p_completed_at TIMESTAMPTZ,
  p_elapsed_ms INTEGER,
  p_telemetry JSONB
)
RETURNS SETOF public.gpc_talk_tool_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_user_message public.gpc_talk_messages%ROWTYPE;
  v_tool_run public.gpc_talk_tool_runs%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated route user is required' USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NULL OR p_user_message_id IS NULL OR p_turn_id IS NULL
    OR p_provider_round IS NULL OR p_provider_round < 0
    OR p_call_id IS NULL OR char_length(p_call_id) NOT BETWEEN 1 AND 200
    OR p_tool_name IS NULL OR char_length(p_tool_name) NOT BETWEEN 1 AND 100
    OR p_validated_arguments IS NULL OR jsonb_typeof(p_validated_arguments) <> 'object'
    OR octet_length(p_validated_arguments::TEXT) > 16384
    OR p_status NOT IN ('completed', 'failed', 'timed_out', 'cancelled', 'skipped_limit')
    OR p_reason_code NOT IN ('none', 'deadline_exceeded', 'client_cancelled', 'call_limit_exceeded', 'invalid_request', 'tool_error', 'diagnostic_write_failed')
    OR (p_reason_detail IS NOT NULL AND char_length(p_reason_detail) > 500)
    OR (p_dispatch_budget_ms IS NOT NULL AND p_dispatch_budget_ms < 0)
    OR (p_elapsed_ms IS NOT NULL AND p_elapsed_ms < 0)
    OR p_telemetry IS NULL OR jsonb_typeof(p_telemetry) <> 'object'
    OR octet_length(p_telemetry::TEXT) > 16384
  THEN
    RAISE EXCEPTION 'Invalid scoped tool-run diagnostic' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conversation
  FROM public.gpc_talk_conversations
  WHERE id = p_conversation_id
    AND user_id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_user_message
  FROM public.gpc_talk_messages
  WHERE id = p_user_message_id
    AND conversation_id = v_conversation.id
    AND user_id = p_user_id
    AND role = 'user'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped user message not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.gpc_talk_tool_runs (
    conversation_id,
    analysis_id,
    user_id,
    user_message_id,
    turn_id,
    provider_round,
    call_id,
    tool_name,
    validated_arguments,
    status,
    reason_code,
    reason_detail,
    dispatch_budget_ms,
    started_at,
    completed_at,
    elapsed_ms,
    telemetry
  ) VALUES (
    v_conversation.id,
    v_conversation.analysis_id,
    p_user_id,
    v_user_message.id,
    p_turn_id,
    p_provider_round,
    p_call_id,
    p_tool_name,
    p_validated_arguments,
    p_status,
    p_reason_code,
    p_reason_detail,
    p_dispatch_budget_ms,
    p_started_at,
    p_completed_at,
    p_elapsed_ms,
    p_telemetry
  ) RETURNING * INTO v_tool_run;

  RETURN NEXT v_tool_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_scoped_tool_runs_to_assistant_message(
  p_user_id UUID,
  p_conversation_id UUID,
  p_turn_id UUID,
  p_assistant_message_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation public.gpc_talk_conversations%ROWTYPE;
  v_assistant_message public.gpc_talk_messages%ROWTYPE;
  v_updated_count INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated route user is required' USING ERRCODE = '42501';
  END IF;

  IF p_conversation_id IS NULL OR p_turn_id IS NULL OR p_assistant_message_id IS NULL THEN
    RAISE EXCEPTION 'Invalid scoped tool-run link' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conversation
  FROM public.gpc_talk_conversations
  WHERE id = p_conversation_id
    AND user_id = p_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped conversation not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_assistant_message
  FROM public.gpc_talk_messages
  WHERE id = p_assistant_message_id
    AND conversation_id = v_conversation.id
    AND user_id = p_user_id
    AND role = 'assistant'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoped assistant message not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.gpc_talk_tool_runs
  SET assistant_message_id = v_assistant_message.id
  WHERE conversation_id = v_conversation.id
    AND user_id = p_user_id
    AND turn_id = p_turn_id
    AND assistant_message_id IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.gpc_talk_tool_runs FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.record_scoped_tool_run(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_scoped_tool_runs_to_assistant_message(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_scoped_tool_run(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_scoped_tool_runs_to_assistant_message(UUID, UUID, UUID, UUID) TO service_role;

CREATE INDEX idx_gpc_talk_tool_runs_conversation_created ON public.gpc_talk_tool_runs(conversation_id, created_at);
CREATE INDEX idx_gpc_talk_tool_runs_user_message ON public.gpc_talk_tool_runs(user_message_id);
CREATE INDEX idx_gpc_talk_tool_runs_assistant_message ON public.gpc_talk_tool_runs(assistant_message_id);
