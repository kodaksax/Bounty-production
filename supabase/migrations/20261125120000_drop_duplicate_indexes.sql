-- Drop exact-duplicate indexes (performance advisor: duplicate_index).
--
-- Production (2026-11-25) has 13 pairs of byte-identical indexes: same table,
-- same access method, same columns/order, same predicate, neither UNIQUE,
-- neither backing a constraint. Each pair is pure write amplification: every
-- INSERT/UPDATE maintains two identical trees and writes the WAL twice, and
-- Realtime (profiles, notifications and bounties are in the
-- supabase_realtime publication) decodes that WAL. Reads gain nothing: the
-- planner picks either copy arbitrarily, which is why idx_scan is split
-- between them.
--
-- Which copy survives: the one defined by an earlier migration in this
-- directory, so the repo stays the source of truth. Several duplicates were
-- created out of band (dashboard / services/api migrations) and exist only in
-- production.
--
-- Safety: every DROP is guarded on the keeper existing, so no environment can
-- end up with neither index (e.g. a fresh branch where the keeper's table or
-- column was never created by a migration). DROP INDEX takes a brief ACCESS
-- EXCLUSIVE lock; every table here is under 6k rows, so it is instantaneous.
-- Rollback: supabase/rollbacks/production/20261125120000_drop_duplicate_indexes.down.sql

DO $$
DECLARE
  -- keeper, duplicate-to-drop
  pairs text[][] := ARRAY[
    -- bounties (geom): keeper referenced by 20260320 / 20260725* migrations
    ['idx_bounties_geom_gist',                   'idx_bounties_geom'],
    -- marketing_clicks: keeper from 20261021180000_install_attribution_writer
    ['marketing_clicks_unmatched_ip_idx',        'idx_mkt_clicks_fingerprint'],
    -- notifications (user_id, created_at DESC): keeper from baseline schema
    ['idx_notifications_user_id_created_at',     'idx_notifications_user_created'],
    -- notifications (user_id, read): duplicate came from services/api/migrations
    ['idx_notifications_user_id_read',           'idx_notifications_user_read'],
    -- platform_reserves (user_id, status)
    ['idx_platform_reserves_user_id_status',     'idx_platform_reserves_user'],
    -- profiles (stripe_connect_account_id) partial
    ['idx_profiles_stripe_connect_account',      'idx_profiles_stripe_connect'],
    -- profiles (geom): neither is in a migration; keep the one the planner uses
    ['profiles_geom_gix',                        'idx_profiles_geom'],
    -- remediation_workflows (risk_action_id)
    ['idx_remediation_workflows_risk_action_id', 'idx_remediation_workflows_action'],
    -- risk_actions (user_id, status)
    ['idx_risk_actions_user_id_status',          'idx_risk_actions_user'],
    -- risk_communications (risk_action_id)
    ['idx_risk_communications_risk_action_id',   'idx_risk_communications_action'],
    -- wallet_transactions (bounty_id) partial: keeper from 20260107 perf indexes
    ['idx_wallet_transactions_bounty_id',        'idx_wallet_tx_bounty_id'],
    -- wallet_transactions (sender_id, created_at DESC): neither in a migration
    ['idx_wallet_tx_sender_created',             'idx_wallet_transactions_sender_id_created_at'],
    -- wallet_transactions (stripe_charge_id) partial: keeper from 20260417 idempotency guards
    ['idx_wallet_tx_stripe_charge_id',           'idx_wallet_tx_stripe_charge']
  ];
  i int;
  v_keep regclass;
  v_drop regclass;
BEGIN
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    v_keep := to_regclass('public.' || pairs[i][1]);
    v_drop := to_regclass('public.' || pairs[i][2]);
    IF v_drop IS NULL THEN
      CONTINUE;
    END IF;
    IF v_keep IS NULL THEN
      RAISE NOTICE 'keeping % (its duplicate % does not exist here)', pairs[i][2], pairs[i][1];
      CONTINUE;
    END IF;
    -- Only drop when the two really are identical in this environment.
    IF regexp_replace(pg_get_indexdef(v_keep), '^CREATE INDEX \S+ ON ', '')
       IS DISTINCT FROM
       regexp_replace(pg_get_indexdef(v_drop), '^CREATE INDEX \S+ ON ', '') THEN
      RAISE NOTICE 'keeping %: not identical to % here', pairs[i][2], pairs[i][1];
      CONTINUE;
    END IF;
    EXECUTE format('DROP INDEX public.%I', pairs[i][2]);
  END LOOP;
END $$;
