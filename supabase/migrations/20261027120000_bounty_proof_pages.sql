-- Completed-bounty proof pages: https://www.bountyfinder.net/proof/<slug>-<public_id>
--
-- A completed bounty becomes a public case study only when ALL of these hold:
--
--   1. It is still eligible right now (fn_proof_eligibility): completed, not a
--      test, in person, a cash reward, a city-level public location, an
--      accepted hunter, an approved completion submission, and no dispute,
--      live cancellation, refund, moderation hold or closed/internal poster
--      account. Checked on every read, so a later dispute or moderation
--      removal takes the page down without anyone touching this table.
--   2. The poster said yes (consent_task). Accepting the Terms is NOT consent:
--      only an explicit answer recorded through proof_poster_set_consent.
--   3. A person reviewed it (proof_admin_publish): the title is fit to print,
--      every photo shows nothing identifying (faces, plates, house numbers,
--      access codes, private interiors), and each photo has accurate alt text.
--
-- Optional parts carry their own permission. Photos need consent_photos;
-- the quote needs consent_testimonial; a first name needs attribution =
-- 'first_name'. What the reviewer approved is copied into published_*.
-- Narrowing is instant and needs nobody: the guard trigger clears a published
-- copy the moment its permission is withdrawn or its text changes. Widening
-- (a new quote, photos newly allowed) waits for the next review.
--
-- Nothing here is readable by anon or authenticated. The website reads
-- published proofs through the proof-pages Edge Function (service role),
-- which calls the proof_public_* functions below; they return an allowlist of
-- fields and never a storage path, an exact location, a user id or the
-- bounty's own id. Photos are streamed by that function, so their paths
-- (which embed the bounty id and the original file name) never leave the
-- server.
--
-- Timing (time to hire, time to finish) is derived, never stored: posted =
-- bounties.created_at; hired = the single application.accepted event in
-- bounty_events (falling back to bounty_requests.accepted_at, a UTC wall time
-- — the database runs in UTC); done = the last bounty.completed event
-- (falling back to bounties.completed_at). A bounty accepted more than once
-- (reopened, re-hired) gets no hire time at all, rather than a misleading one.
-- The website also refuses to show any duration whose timestamps are out of
-- order.
--
-- Asking for consent: fn_request_proof_consent (hourly) sends one
-- proof_consent_request notification per eligible bounty, 24 hours to 30 days
-- after completion. The claim on bounty_proofs.consent_requested_at is taken
-- in the same transaction as the outbox insert, so overlapping runs or a
-- re-run never ask twice. Delivery goes through process-notification, which
-- applies the poster's 'marketing' channel preferences and quiet hours.
--
-- Rollback: supabase/rollbacks/production/20261027120000_bounty_proof_pages.down.sql

BEGIN;

-- ─── 1. Table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bounty_proofs (
  bounty_id             uuid PRIMARY KEY REFERENCES public.bounties(id) ON DELETE CASCADE,
  public_id             text NOT NULL UNIQUE CHECK (public_id ~ '^[a-z0-9]{8}$'),

  -- The poster's answers. NULL consent_task = never answered.
  consent_task          boolean,
  consent_photos        boolean NOT NULL DEFAULT false,
  consent_testimonial   boolean NOT NULL DEFAULT false,
  -- Plain text only, whoever writes it (see proof_poster_set_consent).
  testimonial           text CHECK (testimonial IS NULL OR (char_length(testimonial) BETWEEN 1 AND 600 AND testimonial !~ '[<>]')),
  attribution           text NOT NULL DEFAULT 'anonymous' CHECK (attribution IN ('anonymous', 'first_name')),
  attribution_name      text CHECK (attribution_name IS NULL OR attribution_name ~ '^[[:alpha:]][[:alpha:]''’ -]{0,29}$'),
  consent_updated_at    timestamptz,
  consent_source        text CHECK (consent_source IS NULL OR consent_source IN ('web', 'app', 'support')),
  consent_requested_at  timestamptz,

  -- The reviewer's decision, and exactly what it approved.
  published_at          timestamptz,
  reviewed_at           timestamptz,
  reviewed_by           uuid,
  review_note           text,
  published_photos      jsonb NOT NULL DEFAULT '[]'::jsonb
                        CHECK (jsonb_typeof(published_photos) = 'array' AND jsonb_array_length(published_photos) <= 6),
  published_testimonial text,
  published_attribution text,

  -- Taken down: by the poster withdrawing consent, or by a reviewer.
  revoked_at            timestamptz,
  revoked_by            uuid,
  revoke_reason         text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bounty_proofs IS
  'Publication consent and review state for completed-bounty proof pages (bountyfinder.net/proof). One row per bounty. Content is read live from bounties; only permissions and the reviewer-approved photos/quote live here. No client grants: posters write through proof_poster_set_consent, reviewers through proof_admin_publish / proof_admin_unpublish, the website reads through the proof-pages Edge Function.';

CREATE INDEX IF NOT EXISTS bounty_proofs_published_idx
  ON public.bounty_proofs (published_at DESC)
  WHERE consent_task AND published_at IS NOT NULL AND revoked_at IS NULL;

ALTER TABLE public.bounty_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bounty_proofs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.bounty_proofs TO service_role;

-- ─── 2. Helpers ─────────────────────────────────────────────────────────────

-- 8 characters from an alphabet without look-alikes (no 0/o, 1/l/i).
CREATE OR REPLACE FUNCTION public.fn_proof_new_public_id()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea;
  v_id text;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(8);
    v_id := '';
    FOR i IN 0..7 LOOP
      v_id := v_id || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bounty_proofs WHERE public_id = v_id);
  END LOOP;
  RETURN v_id;
END;
$$;

-- bounties.location is already the coarse public label written by
-- fn_bounties_privatize_location ("Alexandria, VA"). Only that exact
-- "City, ST" shape is shown; anything else (a neighbourhood, a street that
-- slipped through, a spelled-out state) makes the bounty ineligible rather
-- than guessed at.
CREATE OR REPLACE FUNCTION public.fn_proof_city_label(p_location text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_location, '')) ~ '^[A-Za-z][A-Za-z .''-]{0,39}, [A-Z]{2}$'
    THEN btrim(p_location)
  END;
$$;

-- Empty array = eligible. Each entry names one reason it is not.
CREATE OR REPLACE FUNCTION public.fn_proof_eligibility(p_bounty_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bounties%ROWTYPE;
  r text[] := '{}';
BEGIN
  SELECT * INTO b FROM public.bounties WHERE id = p_bounty_id;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;

  IF b.status::text <> 'completed' THEN r := r || 'not_completed'::text; END IF;
  IF COALESCE(b.is_test, false) THEN r := r || 'test_bounty'::text; END IF;
  IF b.work_type::text IS DISTINCT FROM 'in_person' THEN r := r || 'not_in_person'::text; END IF;
  IF COALESCE(b.is_for_honor, false) OR b.amount IS NULL OR b.amount <= 0 THEN
    r := r || 'no_cash_reward'::text;
  END IF;
  IF public.fn_proof_city_label(b.location) IS NULL THEN r := r || 'no_public_city'::text; END IF;
  IF b.accepted_request_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.bounty_requests q
        WHERE q.id = b.accepted_request_id AND q.bounty_id = b.id AND q.status::text = 'accepted') THEN
    r := r || 'no_accepted_hunter'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.completion_submissions s
                  WHERE s.bounty_id = b.id AND s.status = 'approved') THEN
    r := r || 'no_approved_completion'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bounty_disputes d WHERE d.bounty_id = b.id) THEN
    r := r || 'disputed'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bounty_cancellations c
              WHERE c.bounty_id = b.id AND COALESCE(c.status, '') <> 'rejected') THEN
    r := r || 'cancellation'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bounty_payments bp
              WHERE bp.bounty_id = b.id AND bp.status IN ('refund_pending', 'refunded')) THEN
    r := r || 'refunded'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.bounty_moderation m
              WHERE m.bounty_id = b.id AND m.state NOT IN ('active', 'approved')) THEN
    r := r || 'moderation'::text;
  END IF;
  IF COALESCE(b.poster_id, b.user_id) IS NULL OR EXISTS (
       SELECT 1 FROM public.profiles pr
        WHERE pr.id = COALESCE(b.poster_id, b.user_id)
          AND (pr.deleted_at IS NOT NULL OR COALESCE(pr.account_restricted, false) OR COALESCE(pr.is_internal, false))) THEN
    r := r || 'poster_account'::text;
  END IF;

  RETURN r;
END;
$$;

-- ─── 3. Guard: withdrawing a permission takes effect at once ────────────────

CREATE OR REPLACE FUNCTION public.fn_bounty_proofs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'bounty_proofs.public_id is permanent' USING ERRCODE = '42501';
  END IF;

  -- The whole page: consent withdrawn (or never given) means not published.
  IF NEW.consent_task IS DISTINCT FROM true THEN
    IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
      NEW.revoked_at := now();
      NEW.revoke_reason := COALESCE(NEW.revoke_reason, 'poster_withdrew_consent');
    END IF;
    NEW.published_at := NULL;
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.published_at := NULL;
  END IF;
  IF NEW.published_at IS NULL THEN
    NEW.published_photos := '[]'::jsonb;
    NEW.published_testimonial := NULL;
    NEW.published_attribution := NULL;
  END IF;

  -- Photos.
  IF NOT NEW.consent_photos THEN
    NEW.published_photos := '[]'::jsonb;
  END IF;

  -- The quote: withdrawn, or edited since it was approved.
  IF NOT NEW.consent_testimonial OR NEW.testimonial IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.testimonial IS DISTINCT FROM OLD.testimonial) THEN
    NEW.published_testimonial := NULL;
  END IF;

  -- The name: anonymous again, or a different name than was approved.
  IF NEW.attribution <> 'first_name' OR NEW.attribution_name IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.attribution_name IS DISTINCT FROM OLD.attribution_name) THEN
    NEW.published_attribution := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounty_proofs_guard ON public.bounty_proofs;
CREATE TRIGGER trg_bounty_proofs_guard
  BEFORE INSERT OR UPDATE ON public.bounty_proofs
  FOR EACH ROW EXECUTE FUNCTION public.fn_bounty_proofs_guard();

-- ─── 4. What the public may see ─────────────────────────────────────────────
--
-- One row per live proof: consented, reviewed, not revoked, still eligible.
-- Internal: no anon/authenticated grants. bounty_id is here for joins only;
-- the proof_public_* functions strip it.

CREATE OR REPLACE VIEW public.bounty_proof_public_v AS
SELECT
  p.bounty_id,
  p.public_id,
  btrim(b.title)                         AS title,
  b.amount                               AS reward,
  NULLIF(btrim(COALESCE(b.category, '')), '') AS category,
  public.fn_proof_city_label(b.location) AS city,
  b.created_at                           AS posted_at,
  CASE
    WHEN acc.n = 1 THEN acc.first_at
    WHEN acc.n = 0 THEN (SELECT q.accepted_at AT TIME ZONE 'UTC'
                           FROM public.bounty_requests q
                          WHERE q.id = b.accepted_request_id)
  END                                    AS accepted_at,
  COALESCE(done.last_at, b.completed_at AT TIME ZONE 'UTC') AS completed_at,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('n', ph.n - 1, 'role', ph.v->>'role', 'alt', ph.v->>'alt') ORDER BY ph.n), '[]'::jsonb)
     FROM jsonb_array_elements(p.published_photos) WITH ORDINALITY AS ph(v, n)) AS photos,
  p.published_testimonial                AS testimonial,
  p.published_attribution                AS attribution_name,
  p.published_at,
  GREATEST(p.updated_at, b.updated_at)   AS updated_at
FROM public.bounty_proofs p
JOIN public.bounties b ON b.id = p.bounty_id
CROSS JOIN LATERAL (
  SELECT count(*) AS n, min(e.occurred_at) AS first_at
    FROM public.bounty_events e
   WHERE e.bounty_id = b.id AND e.event_type = 'application.accepted'
) acc
CROSS JOIN LATERAL (
  SELECT max(e.occurred_at) AS last_at
    FROM public.bounty_events e
   WHERE e.bounty_id = b.id AND e.event_type = 'bounty.completed'
) done
WHERE p.consent_task
  AND p.published_at IS NOT NULL
  AND p.revoked_at IS NULL
  AND cardinality(public.fn_proof_eligibility(b.id)) = 0;

REVOKE ALL ON TABLE public.bounty_proof_public_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.bounty_proof_public_v TO service_role;

-- One proof and up to six related ones (same city and category first, then
-- same category, then same city). NULL when the id is unknown, unpublished,
-- revoked or no longer eligible: the website answers 404/410 either way.
CREATE OR REPLACE FUNCTION public.proof_public_get(p_public_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT * FROM public.bounty_proof_public_v WHERE public_id = p_public_id
  )
  SELECT jsonb_build_object(
    'proof', to_jsonb(me) - 'bounty_id',
    'related', (
      SELECT COALESCE(jsonb_agg(x.j ORDER BY x.rank DESC, x.published_at DESC), '[]'::jsonb)
        FROM (
          SELECT jsonb_build_object('public_id', o.public_id, 'title', o.title, 'reward', o.reward,
                                    'category', o.category, 'city', o.city) AS j,
                 (CASE WHEN o.category IS NOT DISTINCT FROM me.category AND o.category IS NOT NULL THEN 2 ELSE 0 END
                  + CASE WHEN o.city = me.city THEN 1 ELSE 0 END) AS rank,
                 o.published_at
            FROM public.bounty_proof_public_v o
           WHERE o.public_id <> me.public_id
             AND (o.city = me.city OR (o.category IS NOT NULL AND o.category = me.category))
           ORDER BY rank DESC, o.published_at DESC
           LIMIT 6
        ) x
    )
  )
  FROM me;
$$;

-- A page of proofs, newest first, filtered by city slug and/or categories.
-- The slug rule matches the website's slugify(): lowercase, runs of anything
-- but a-z0-9 become one hyphen, no hyphen at either end.
CREATE OR REPLACE FUNCTION public.proof_public_list(
  p_city_slug  text    DEFAULT NULL,
  p_categories text[]  DEFAULT NULL,
  p_limit      integer DEFAULT 24,
  p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT v.*
      FROM public.bounty_proof_public_v v
     WHERE (p_city_slug IS NULL
            OR btrim(regexp_replace(lower(v.city), '[^a-z0-9]+', '-', 'g'), '-') = p_city_slug)
       AND (p_categories IS NULL OR v.category = ANY (p_categories))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'public_id', x.public_id, 'title', x.title, 'reward', x.reward,
               'category', x.category, 'city', x.city,
               'posted_at', x.posted_at, 'accepted_at', x.accepted_at, 'completed_at', x.completed_at,
               'has_photos', jsonb_array_length(x.photos) > 0)
             ORDER BY x.published_at DESC, x.public_id)
        FROM (
          SELECT * FROM f
           ORDER BY published_at DESC, public_id
           LIMIT LEAST(GREATEST(COALESCE(p_limit, 24), 1), 48)
          OFFSET LEAST(GREATEST(COALESCE(p_offset, 0), 0), 10000)
        ) x
    ), '[]'::jsonb)
  );
$$;

-- Every live proof, for the sitemap, the hub page and the city/category
-- counts. Bounded; the website pages through the rest with proof_public_list.
CREATE OR REPLACE FUNCTION public.proof_public_index()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'proofs', COALESCE(jsonb_agg(jsonb_build_object(
                'public_id', x.public_id, 'title', x.title, 'reward', x.reward,
                'category', x.category, 'city', x.city, 'updated_at', x.updated_at)
              ORDER BY x.published_at DESC, x.public_id), '[]'::jsonb)
  )
  FROM (
    SELECT * FROM public.bounty_proof_public_v
     ORDER BY published_at DESC, public_id
     LIMIT 5000
  ) x;
$$;

-- The storage path of one approved photo, for the proof-pages function to
-- stream. Never returned to a browser.
CREATE OR REPLACE FUNCTION public.proof_public_photo(p_public_id text, p_index integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.published_photos -> p_index ->> 'path'
    FROM public.bounty_proofs p
   WHERE p.public_id = p_public_id
     AND p_index BETWEEN 0 AND 5
     AND EXISTS (SELECT 1 FROM public.bounty_proof_public_v v WHERE v.public_id = p.public_id);
$$;

REVOKE ALL ON FUNCTION public.proof_public_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_public_list(text, text[], integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_public_index() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_public_photo(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proof_public_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proof_public_list(text, text[], integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.proof_public_index() TO service_role;
GRANT EXECUTE ON FUNCTION public.proof_public_photo(text, integer) TO service_role;

-- ─── 5. The poster: see, give, change and withdraw permission ───────────────

CREATE OR REPLACE FUNCTION public.fn_proof_poster_state(p_bounty_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'bounty_id', b.id,
    'title', b.title,
    'eligible', cardinality(public.fn_proof_eligibility(b.id)) = 0,
    'reasons', to_jsonb(public.fn_proof_eligibility(b.id)),
    'public_id', p.public_id,
    'status', CASE
      WHEN p.bounty_id IS NULL OR p.consent_task IS NULL THEN 'not_answered'
      WHEN NOT p.consent_task THEN 'declined'
      WHEN p.published_at IS NULL THEN 'in_review'
      WHEN cardinality(public.fn_proof_eligibility(b.id)) > 0 THEN 'not_eligible'
      ELSE 'published'
    END,
    'consent_task', p.consent_task,
    'consent_photos', COALESCE(p.consent_photos, false),
    'consent_testimonial', COALESCE(p.consent_testimonial, false),
    'testimonial', p.testimonial,
    'attribution', COALESCE(p.attribution, 'anonymous'),
    'attribution_name', p.attribution_name,
    'testimonial_published', p.published_testimonial IS NOT NULL,
    'photos_published', jsonb_array_length(COALESCE(p.published_photos, '[]'::jsonb)),
    'consent_updated_at', p.consent_updated_at
  )
  FROM public.bounties b
  LEFT JOIN public.bounty_proofs p ON p.bounty_id = b.id
  WHERE b.id = p_bounty_id;
$$;

CREATE OR REPLACE FUNCTION public.proof_poster_get(p_bounty_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.bounties
        WHERE id = p_bounty_id AND COALESCE(poster_id, user_id) = auth.uid()) THEN
    -- Not found, not forbidden: ids can't be probed.
    RAISE EXCEPTION 'bounty not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.fn_proof_poster_state(p_bounty_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.proof_poster_set_consent(
  p_bounty_id        uuid,
  p_share_task       boolean,
  p_share_photos     boolean,
  p_testimonial      text,
  p_share_testimonial boolean,
  p_attribution      text,
  p_attribution_name text,
  p_source           text DEFAULT 'web'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_was_published boolean;
  -- Plain text: anything shaped like a tag goes whole (a space in its place),
  -- then stray brackets, then runs of whitespace. Same rule as poster-web's
  -- stripMarkup; the CHECK on testimonial holds it for direct writes.
  v_quote text := NULLIF(btrim(regexp_replace(regexp_replace(regexp_replace(
                    COALESCE(p_testimonial, ''), '</?[A-Za-z!][^<>]*>', ' ', 'g'), '[<>]', '', 'g'), '\s+', ' ', 'g')), '');
  v_name text := NULLIF(btrim(COALESCE(p_attribution_name, '')), '');
  v_attr text := COALESCE(p_attribution, 'anonymous');
BEGIN
  SELECT b.status::text INTO v_status
    FROM public.bounties b
   WHERE b.id = p_bounty_id AND COALESCE(b.poster_id, b.user_id) = v_uid;
  IF v_uid IS NULL OR v_status IS NULL THEN
    RAISE EXCEPTION 'bounty not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'only a completed bounty can be shared' USING ERRCODE = '22023';
  END IF;
  IF p_share_task IS NULL THEN
    RAISE EXCEPTION 'share_task is required' USING ERRCODE = '22023';
  END IF;
  IF v_attr NOT IN ('anonymous', 'first_name') THEN
    RAISE EXCEPTION 'attribution must be anonymous or first_name' USING ERRCODE = '22023';
  END IF;
  IF v_attr = 'first_name' AND (v_name IS NULL OR v_name !~ '^[[:alpha:]][[:alpha:]''’ -]{0,29}$') THEN
    RAISE EXCEPTION 'a first name is letters only, up to 30' USING ERRCODE = '22023';
  END IF;
  IF v_quote IS NOT NULL AND char_length(v_quote) > 600 THEN
    RAISE EXCEPTION 'the quote is limited to 600 characters' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_source, 'web') NOT IN ('web', 'app') THEN
    RAISE EXCEPTION 'unknown source' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bounty_proofs (bounty_id, public_id)
  VALUES (p_bounty_id, public.fn_proof_new_public_id())
  ON CONFLICT (bounty_id) DO NOTHING;

  SELECT published_at IS NOT NULL INTO v_was_published
    FROM public.bounty_proofs WHERE bounty_id = p_bounty_id FOR UPDATE;

  UPDATE public.bounty_proofs SET
    consent_task        = p_share_task,
    consent_photos      = p_share_task AND COALESCE(p_share_photos, false),
    consent_testimonial = p_share_task AND COALESCE(p_share_testimonial, false) AND v_quote IS NOT NULL,
    testimonial         = v_quote,
    attribution         = CASE WHEN v_attr = 'first_name' AND v_name IS NOT NULL THEN 'first_name' ELSE 'anonymous' END,
    attribution_name    = CASE WHEN v_attr = 'first_name' THEN v_name END,
    consent_updated_at  = now(),
    consent_source      = COALESCE(p_source, 'web'),
    -- Saying yes again after a withdrawal goes back to review.
    revoked_at          = CASE WHEN p_share_task THEN NULL ELSE revoked_at END,
    revoked_by          = CASE WHEN p_share_task THEN NULL WHEN v_was_published THEN v_uid ELSE revoked_by END,
    revoke_reason       = CASE WHEN p_share_task THEN NULL WHEN v_was_published THEN 'poster_withdrew_consent' ELSE revoke_reason END
  WHERE bounty_id = p_bounty_id;

  PERFORM public.record_bounty_event(
    'proof.consent:' || p_bounty_id || ':' || extract(epoch FROM clock_timestamp())::text,
    'proof.consent_recorded', 'proof_pages', p_bounty_id, v_uid, now(), NULL, NULL,
    jsonb_build_object('share_task', p_share_task, 'share_photos', COALESCE(p_share_photos, false),
                       'share_testimonial', COALESCE(p_share_testimonial, false) AND v_quote IS NOT NULL,
                       'attribution', v_attr, 'source', COALESCE(p_source, 'web')));
  IF v_was_published AND NOT p_share_task THEN
    PERFORM public.record_bounty_event(
      'proof.unpublished:' || p_bounty_id || ':' || extract(epoch FROM clock_timestamp())::text,
      'proof.unpublished', 'proof_pages', p_bounty_id, v_uid, now(), NULL, NULL,
      jsonb_build_object('reason', 'poster_withdrew_consent'));
  END IF;

  RETURN public.fn_proof_poster_state(p_bounty_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_proof_poster_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_poster_get(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proof_poster_set_consent(uuid, boolean, boolean, text, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proof_poster_get(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.proof_poster_set_consent(uuid, boolean, boolean, text, boolean, text, text, text) TO authenticated, service_role;

-- ─── 6. The reviewer: publish, take down, see the queue ─────────────────────
--
-- p_photos: [{ "path": "bounties/<bounty id>/proofs/<file>.jpg",
--              "role": "before" | "after" | "completion",
--              "alt":  "what the photo actually shows, 8-200 chars" }]
-- Only files already attached to this bounty or its completion submissions,
-- only formats every browser shows (no HEIC), and before/after only as a
-- pair: a single photo is "completion", never half of a comparison.

CREATE OR REPLACE FUNCTION public.proof_admin_publish(
  p_bounty_id           uuid,
  p_photos              jsonb   DEFAULT '[]'::jsonb,
  p_include_testimonial boolean DEFAULT false,
  p_note                text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p public.bounty_proofs%ROWTYPE;
  v_reasons text[];
  v_photo jsonb;
  v_path text;
  v_roles text[] := '{}';
  v_known text;
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.bounty_proofs WHERE bounty_id = p_bounty_id FOR UPDATE;
  IF NOT FOUND OR p.consent_task IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'the poster has not agreed to share this bounty' USING ERRCODE = '22023';
  END IF;
  v_reasons := public.fn_proof_eligibility(p_bounty_id);
  IF cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'not eligible: %', array_to_string(v_reasons, ', ') USING ERRCODE = '22023';
  END IF;

  p_photos := COALESCE(p_photos, '[]'::jsonb);
  IF jsonb_typeof(p_photos) <> 'array' OR jsonb_array_length(p_photos) > 6 THEN
    RAISE EXCEPTION 'photos must be an array of at most 6' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_photos) > 0 AND NOT p.consent_photos THEN
    RAISE EXCEPTION 'the poster has not agreed to share photos' USING ERRCODE = '22023';
  END IF;

  -- Every file this bounty already has, as storage paths in bounty-attachments.
  SELECT string_agg(u, E'\n') INTO v_known FROM (
    SELECT substring(e->>'remoteUri' FROM '/storage/v1/object/public/bounty-attachments/(.+)$') AS u
      FROM public.completion_submissions s,
           jsonb_array_elements(CASE jsonb_typeof(s.proof_items)
                                  WHEN 'array' THEN s.proof_items
                                  WHEN 'string' THEN (s.proof_items #>> '{}')::jsonb
                                  ELSE '[]'::jsonb END) e
     WHERE s.bounty_id = p_bounty_id AND s.status = 'approved'
    UNION ALL
    SELECT substring(COALESCE(e->>'remoteUri', e->>'url', e->>'uri') FROM '/storage/v1/object/public/bounty-attachments/(.+)$')
      FROM public.bounties b,
           jsonb_array_elements(CASE jsonb_typeof(b.attachments_json)
                                  WHEN 'array' THEN b.attachments_json
                                  WHEN 'string' THEN (b.attachments_json #>> '{}')::jsonb
                                  ELSE '[]'::jsonb END) e
     WHERE b.id = p_bounty_id
  ) k WHERE u IS NOT NULL;

  FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photos) LOOP
    v_path := v_photo->>'path';
    IF v_path IS NULL
       OR v_path !~* ('^bounties/' || p_bounty_id::text || '/[A-Za-z0-9._/ -]+\.(jpe?g|png|webp)$')
       OR v_path ~ '\.\.'
       OR position(E'\n' || v_path || E'\n' IN E'\n' || COALESCE(v_known, '') || E'\n') = 0 THEN
      RAISE EXCEPTION 'photo % is not a JPEG/PNG/WebP attached to this bounty', COALESCE(v_path, '(no path)') USING ERRCODE = '22023';
    END IF;
    IF COALESCE(v_photo->>'role', '') NOT IN ('before', 'after', 'completion') THEN
      RAISE EXCEPTION 'photo role must be before, after or completion' USING ERRCODE = '22023';
    END IF;
    IF char_length(btrim(COALESCE(v_photo->>'alt', ''))) NOT BETWEEN 8 AND 200 THEN
      RAISE EXCEPTION 'every photo needs alt text (8-200 characters) describing what it shows' USING ERRCODE = '22023';
    END IF;
    v_roles := v_roles || (v_photo->>'role');
  END LOOP;
  IF ('before' = ANY (v_roles)) <> ('after' = ANY (v_roles)) THEN
    RAISE EXCEPTION 'before and after photos must come as a pair; label a single photo "completion"' USING ERRCODE = '22023';
  END IF;

  UPDATE public.bounty_proofs SET
    published_at          = now(),
    reviewed_at           = now(),
    reviewed_by           = auth.uid(),
    review_note           = p_note,
    revoked_at            = NULL,
    revoked_by            = NULL,
    revoke_reason         = NULL,
    published_photos      = (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                'path', x->>'path', 'role', x->>'role', 'alt', btrim(x->>'alt'))), '[]'::jsonb)
                               FROM jsonb_array_elements(p_photos) x),
    published_testimonial = CASE WHEN p_include_testimonial AND p.consent_testimonial THEN p.testimonial END,
    published_attribution = CASE WHEN p.attribution = 'first_name' THEN p.attribution_name END
  WHERE bounty_id = p_bounty_id;

  PERFORM public.record_bounty_event(
    'proof.published:' || p_bounty_id || ':' || extract(epoch FROM clock_timestamp())::text,
    'proof.published', 'proof_pages', p_bounty_id, auth.uid(), now(), NULL, NULL,
    jsonb_build_object('public_id', p.public_id, 'photos', jsonb_array_length(p_photos),
                       'testimonial', p_include_testimonial AND p.consent_testimonial));

  RETURN public.fn_proof_poster_state(p_bounty_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.proof_admin_unpublish(p_bounty_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bounty_proofs
     SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
   WHERE bounty_id = p_bounty_id AND revoked_at IS NULL;
  IF FOUND THEN
    PERFORM public.record_bounty_event(
      'proof.unpublished:' || p_bounty_id || ':' || extract(epoch FROM clock_timestamp())::text,
      'proof.unpublished', 'proof_pages', p_bounty_id, auth.uid(), now(), NULL, NULL,
      jsonb_build_object('reason', btrim(p_reason)));
  END IF;
  RETURN public.fn_proof_poster_state(p_bounty_id);
END;
$$;

-- Waiting for review: the poster said yes and nobody has decided since.
CREATE OR REPLACE FUNCTION public.proof_admin_queue()
RETURNS TABLE (bounty_id uuid, public_id text, title text, city text, reward numeric,
               consent_photos boolean, has_testimonial boolean, consent_updated_at timestamptz,
               reasons text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.bounty_id, p.public_id, b.title, public.fn_proof_city_label(b.location), b.amount,
           p.consent_photos, p.consent_testimonial AND p.testimonial IS NOT NULL, p.consent_updated_at,
           public.fn_proof_eligibility(p.bounty_id)
      FROM public.bounty_proofs p
      JOIN public.bounties b ON b.id = p.bounty_id
     WHERE p.consent_task
       AND (p.published_at IS NULL OR p.reviewed_at < p.consent_updated_at)
     ORDER BY p.consent_updated_at;
END;
$$;

-- No client grant: a signed-in app user can't even attempt these. Reviewers
-- use the SQL editor (the owner, no JWT) or the service role; an admin
-- screen would call them from an Edge Function that checks is_admin()
-- first. The in-body check stays as a second line.
REVOKE ALL ON FUNCTION public.proof_admin_publish(uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_admin_unpublish(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proof_admin_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.proof_admin_publish(uuid, jsonb, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proof_admin_unpublish(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.proof_admin_queue() TO service_role;

-- A view's function calls are checked against whoever reads the view, so
-- service_role keeps EXECUTE on the two the view calls.
REVOKE ALL ON FUNCTION public.fn_proof_new_public_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_proof_eligibility(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_proof_city_label(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bounty_proofs_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_proof_eligibility(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_proof_city_label(text) TO service_role;

-- ─── 7. Asking the poster ───────────────────────────────────────────────────

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY[
  'application', 'acceptance', 'completion', 'payment', 'message', 'follow',
  'cancellation_request', 'cancellation_accepted', 'cancellation_rejected',
  'dispute_created', 'dispute_resolved', 'workflow_dispute_created',
  'stale_bounty', 'stale_bounty_cancelled', 'stale_bounty_reposted', 'update', 'review_needed',
  'balance_update', 'bounty_nearby', 'bounty_expiry', 'dispute_escalated',
  'account_warning', 'account_restricted', 'payout_paid', 'payout_failed', 'payout_canceled',
  'withdrawal_reversed', 'bank_disconnected', 'payout_method_changed',
  'verification_submitted', 'verification_verified', 'verification_rejected', 'verification_canceled',
  'marketing_promo', 'reconciliation_alert', 'reconciliation_digest', 'bounty_quality_nudge',
  'application_pending_reminder', 'application_expired', 'rating_reminder',
  'application_bounty_closed', 'payout_setup_required', 'release_waiting_on_hunter',
  'bounty_location_nudge', 'application_closure_digest',
  'proof_consent_request'
]::text[]));

CREATE OR REPLACE FUNCTION public.fn_request_proof_consent(p_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_claimed uuid;
  v_sent integer := 0;
BEGIN
  FOR r IN
    SELECT b.id, COALESCE(b.poster_id, b.user_id) AS poster_id, b.title
      FROM public.bounties b
     WHERE b.status = 'completed'
       AND NOT COALESCE(b.is_test, false)
       AND b.work_type = 'in_person'
       AND COALESCE(b.completed_at AT TIME ZONE 'UTC', b.updated_at)
             BETWEEN now() - interval '30 days' AND now() - interval '24 hours'
       AND NOT EXISTS (SELECT 1 FROM public.bounty_proofs p
                        WHERE p.bounty_id = b.id
                          AND (p.consent_requested_at IS NOT NULL OR p.consent_task IS NOT NULL))
       AND cardinality(public.fn_proof_eligibility(b.id)) = 0
     ORDER BY b.updated_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  LOOP
    BEGIN
      INSERT INTO public.bounty_proofs (bounty_id, public_id)
      VALUES (r.id, public.fn_proof_new_public_id())
      ON CONFLICT (bounty_id) DO NOTHING;

      -- The claim. A concurrent run that got here first leaves nothing to
      -- update, so it is skipped, not asked twice.
      UPDATE public.bounty_proofs
         SET consent_requested_at = now()
       WHERE bounty_id = r.id AND consent_requested_at IS NULL AND consent_task IS NULL
      RETURNING bounty_id INTO v_claimed;
      IF v_claimed IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.notifications_outbox (recipients, title, body, data, bounty_id)
      VALUES (
        jsonb_build_array(r.poster_id),
        'Can we share how your job went?',
        'Your bounty "' || left(COALESCE(r.title, 'your bounty'), 80) || '" is done. If you''re happy for us to, we''d like to show it as a real example on bountyfinder.net. Nothing is shared unless you say yes, and you can change your mind later.',
        jsonb_build_object('type', 'proof_consent_request', 'bounty_id', r.id, 'bountyId', r.id,
                           'ctaLabel', 'Share your result'),
        r.id::text
      );
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'fn_request_proof_consent: skipping bounty % after error: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_request_proof_consent(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_request_proof_consent(integer) TO service_role;

INSERT INTO public.job_health_expectations (job_name, max_silence, probe_sql, description)
VALUES ('proof-consent-requests-hourly', '3 hours', NULL, 'SQL job; heartbeat appended to cron command (proof pages)')
ON CONFLICT (job_name) DO UPDATE
  SET max_silence = EXCLUDED.max_silence, probe_sql = EXCLUDED.probe_sql, description = EXCLUDED.description;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'proof-consent-requests-hourly';
END $$;
SELECT cron.schedule('proof-consent-requests-hourly', '23 * * * *',
  $$SELECT public.fn_request_proof_consent(); SELECT public.record_job_heartbeat('proof-consent-requests-hourly');$$);

COMMIT;
