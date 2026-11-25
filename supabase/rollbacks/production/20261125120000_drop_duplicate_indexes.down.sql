-- Reverts 20261125120000_drop_duplicate_indexes.sql.
--
-- Recreates the 13 duplicate indexes exactly as they were defined in
-- production on 2026-11-25 (pg_get_indexdef). Nothing depends on them: each
-- has an identical twin that the migration kept, so this only restores the
-- extra write cost.

CREATE INDEX IF NOT EXISTS idx_bounties_geom ON public.bounties USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_mkt_clicks_fingerprint ON public.marketing_clicks USING btree (ip_hash, clicked_at DESC) WHERE (matched_user_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications USING btree (user_id, read);
CREATE INDEX IF NOT EXISTS idx_platform_reserves_user ON public.platform_reserves USING btree (user_id, status);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_connect ON public.profiles USING btree (stripe_connect_account_id) WHERE (stripe_connect_account_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_profiles_geom ON public.profiles USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_remediation_workflows_action ON public.remediation_workflows USING btree (risk_action_id);
CREATE INDEX IF NOT EXISTS idx_risk_actions_user ON public.risk_actions USING btree (user_id, status);
CREATE INDEX IF NOT EXISTS idx_risk_communications_action ON public.risk_communications USING btree (risk_action_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_bounty_id ON public.wallet_transactions USING btree (bounty_id) WHERE (bounty_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_sender_id_created_at ON public.wallet_transactions USING btree (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_stripe_charge ON public.wallet_transactions USING btree (stripe_charge_id) WHERE (stripe_charge_id IS NOT NULL);
