-- Read-only. Applications whose poster_id is not the bounty's real poster, and
-- whether any of them got as far as a hire.
--
-- Expected: 0 rows. Result on production, 2026-11-04: 0 rows.
--
-- This cannot see forged rows that were later deleted. Hunters can delete their
-- own pending applications, and removing a bounty cascades. An accepted forged
-- row would be locked against deletion by trg_bounty_requests_guard_assignment,
-- so a successful self-hire does stay visible here while its bounty exists.
SELECT
  r.id                                AS request_id,
  r.bounty_id,
  r.status::text                      AS request_status,
  r.created_at,
  r.accepted_at,
  r.poster_id = r.hunter_id           AS poster_is_applicant,
  r.poster_id = b.user_id             AS matches_user_id,
  b.poster_id IS NULL                 AS bounty_poster_null,
  b.status::text                      AS bounty_status,
  b.funding_mode,
  b.accepted_request_id = r.id        AS is_accepted_request,
  EXISTS (
    SELECT 1 FROM public.wallet_transactions w
     WHERE w.bounty_id = b.id AND w.type = 'escrow' AND w.status = 'completed'
  )                                   AS has_escrow
FROM public.bounty_requests r
LEFT JOIN public.bounties b ON b.id = r.bounty_id
WHERE b.id IS NULL
   OR r.poster_id IS DISTINCT FROM COALESCE(b.poster_id, b.user_id)
ORDER BY r.created_at DESC;
