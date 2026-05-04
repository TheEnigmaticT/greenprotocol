CREATE POLICY "Users can update own analyses"
  ON gpc_analyses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
