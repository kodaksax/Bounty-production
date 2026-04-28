-- Migration: drop text overload of rpc_create_conversation
-- Created: 2026-04-27
-- Issue: PGRST203 — "Could not choose the best candidate function between
--         public.rpc_create_conversation(p_bounty_id => text, p_name => text, p_participant_ids => text[]),
--         public.rpc_create_conversation(p_participant_ids => uuid[], p_bounty_id => uuid, p_name => text)"
--
-- Root Cause:
--   The 20260412_fix_staging_schema_issues migration used CREATE OR REPLACE with
--   (p_bounty_id text, p_name text, p_participant_ids text[]) parameters.
--   Since the existing function had signature (p_participant_ids uuid[], p_bounty_id uuid, p_name text),
--   CREATE OR REPLACE created a NEW overload instead of replacing it.
--   PostgREST (PGRST203) refuses to choose between ambiguous overloads on every
--   rpc_create_conversation call, breaking conversation creation on bounty accept.
--
-- Fix:
--   Drop the text/text[] overload. The canonical signature is
--   (p_participant_ids uuid[], p_bounty_id uuid, p_name text) — uuid-typed params
--   are the correct types for user IDs and bounty IDs in this schema.
--   PostgREST + PostgreSQL handle implicit text→uuid coercion from JSON strings
--   so existing call sites (useAcceptRequest, supabase-messaging) continue to work.

DROP FUNCTION IF EXISTS public.rpc_create_conversation(text, text, text[]);

-- Reload PostgREST schema cache so it sees only the single uuid overload.
NOTIFY pgrst, 'reload schema';
