CREATE TABLE gpc_talk_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES gpc_analyses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  scope JSONB NOT NULL,
  context_snapshot JSONB NOT NULL,
  context_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_talk_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES gpc_talk_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('streaming', 'complete', 'failed', 'cancelled')),
  ttft_ms INTEGER CHECK (ttft_ms IS NULL OR ttft_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gpc_talk_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES gpc_talk_conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('chemistry_incompatible', 'condition_unavailable', 'yield_assumption_wrong', 'evidence_not_applicable', 'other')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gpc_talk_conversations_analysis_id ON gpc_talk_conversations(analysis_id);
CREATE INDEX idx_gpc_talk_conversations_user_id ON gpc_talk_conversations(user_id);
CREATE INDEX idx_gpc_talk_messages_conversation_id ON gpc_talk_messages(conversation_id, created_at);
CREATE INDEX idx_gpc_talk_messages_user_id ON gpc_talk_messages(user_id);
CREATE INDEX idx_gpc_talk_feedback_conversation_id ON gpc_talk_feedback(conversation_id);

ALTER TABLE gpc_talk_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_talk_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpc_talk_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own talk conversations"
  ON gpc_talk_conversations FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own talk conversations"
  ON gpc_talk_conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own talk conversations"
  ON gpc_talk_conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own talk messages"
  ON gpc_talk_messages FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own talk messages"
  ON gpc_talk_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own talk messages"
  ON gpc_talk_messages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own talk feedback"
  ON gpc_talk_feedback FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own talk feedback"
  ON gpc_talk_feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);
