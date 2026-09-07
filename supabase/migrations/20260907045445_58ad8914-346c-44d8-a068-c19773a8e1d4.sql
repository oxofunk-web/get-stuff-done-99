CREATE POLICY "AI notes are server-only"
  ON public.ai_notes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
