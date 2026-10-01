-- ROLLBACK for 20261001120100_bounty_lifecycle_guard_and_refund_gate
-- Generated 2026-10-01T18:18:50.192Z from the LIVE pre-migration state of production (xwlwqzzphmmhghiqvkeu).
-- It restores that environment exactly, including the vulnerable policies;
-- run it only to back the migration out.

BEGIN;


DROP TRIGGER IF EXISTS trg_bounties_guard_lifecycle ON public.bounties;

DROP FUNCTION IF EXISTS public.fn_bounties_guard_lifecycle();

-- Deploy the previous wallet / bounty-payments edge functions BEFORE running this,

-- or their /refund and /cancel calls will fail on the missing function.

DROP FUNCTION IF EXISTS public.fn_owner_refund_block_reason(uuid, uuid);

COMMIT;
