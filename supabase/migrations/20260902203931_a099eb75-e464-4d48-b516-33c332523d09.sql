REVOKE ALL ON public.market_snapshots FROM anon, authenticated;
REVOKE ALL ON public.signal_log FROM anon, authenticated;
REVOKE ALL ON public.trade_log FROM anon, authenticated;

CREATE POLICY "no public access to market_snapshots" ON public.market_snapshots AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "no public access to signal_log" ON public.signal_log AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "no public access to trade_log" ON public.trade_log AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);