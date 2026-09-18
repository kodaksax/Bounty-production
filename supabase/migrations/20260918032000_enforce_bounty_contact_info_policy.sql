-- Close the contact-info posting gap for every insert/update path.
--
-- The client composers already refuse phone numbers, email addresses, and
-- links, but service-role inserts, raw PostgREST writes, and detail updates to
-- an existing bounty still reached the table. Extend the existing posting
-- policy trigger so title/description are gated at the database boundary too.

CREATE OR REPLACE FUNCTION public.fn_bounty_text_contains_contact_info(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(p_value, '') ~* '(?:[0-9][[:space:]().-]*){7,}'
    OR COALESCE(p_value, '') ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR COALESCE(p_value, '') ~* '(?:https?://|www\.)\S+|(?:^|[^[:alnum:]_])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|io|co|app|me|ly|gg|xyz|info|biz|us|tv|link|site|online|shop|store|dev|ai|edu)\M(?:/\S*)?';
$$;

COMMENT ON FUNCTION public.fn_bounty_text_contains_contact_info(text) IS
  'Returns true when poster-written bounty text contains a phone number, email address, or link.';

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_posting_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_honor_enabled boolean;
  v_minimum       numeric;
BEGIN
  SELECT honor_posts_enabled, minimum_amount
    INTO v_honor_enabled, v_minimum
  FROM public.posting_policy_config
  WHERE id = true;

  v_honor_enabled := COALESCE(v_honor_enabled, false);
  v_minimum       := COALESCE(v_minimum, 5);

  IF public.fn_bounty_text_contains_contact_info(NEW.title)
     OR public.fn_bounty_text_contains_contact_info(NEW.description)
  THEN
    RAISE EXCEPTION 'contact information is not allowed in bounty title or description'
      USING ERRCODE = 'check_violation',
            HINT    = 'Remove phone numbers, email addresses, and links from the title and description.';
  END IF;

  IF COALESCE(NEW.is_for_honor, false) AND NOT v_honor_enabled THEN
    RAISE EXCEPTION 'for-honor bounties are not currently accepted'
      USING ERRCODE = 'check_violation',
            HINT    = 'Set an amount for this bounty. Posting is free — you are charged only when you accept a hunter.';
  END IF;

  IF NOT COALESCE(NEW.is_for_honor, false)
     AND COALESCE(NEW.amount, 0) < v_minimum THEN
    RAISE EXCEPTION 'bounty amount % is below the % minimum', COALESCE(NEW.amount, 0), v_minimum
      USING ERRCODE = 'check_violation',
            HINT    = 'Raise the amount to at least the minimum shown in the app.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_bounties_enforce_posting_policy_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_honor_enabled boolean;
  v_minimum       numeric;
BEGIN
  IF NEW.is_for_honor IS NOT DISTINCT FROM OLD.is_for_honor
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
  THEN
    RETURN NEW;
  END IF;

  SELECT honor_posts_enabled, minimum_amount
    INTO v_honor_enabled, v_minimum
  FROM public.posting_policy_config
  WHERE id = true;

  v_honor_enabled := COALESCE(v_honor_enabled, false);
  v_minimum       := COALESCE(v_minimum, 5);

  IF (
       NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
     )
     AND (
       public.fn_bounty_text_contains_contact_info(NEW.title)
       OR public.fn_bounty_text_contains_contact_info(NEW.description)
     )
  THEN
    RAISE EXCEPTION 'contact information is not allowed in bounty title or description'
      USING ERRCODE = 'check_violation',
            HINT    = 'Remove phone numbers, email addresses, and links from the title and description.';
  END IF;

  IF NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor
     AND COALESCE(NEW.is_for_honor, false)
     AND NOT v_honor_enabled
  THEN
    RAISE EXCEPTION 'for-honor bounties are not currently accepted'
      USING ERRCODE = 'check_violation',
            HINT    = 'Set an amount for this bounty instead of switching it to for-honor.';
  END IF;

  IF (
       NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.is_for_honor IS DISTINCT FROM OLD.is_for_honor
     )
     AND NOT COALESCE(NEW.is_for_honor, false)
     AND COALESCE(NEW.amount, 0) < v_minimum
  THEN
    RAISE EXCEPTION 'bounty amount % is below the % minimum', COALESCE(NEW.amount, 0), v_minimum
      USING ERRCODE = 'check_violation',
            HINT    = 'Raise the amount to at least the minimum shown in the app.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bounties_enforce_posting_policy_on_update ON public.bounties;
CREATE TRIGGER trg_bounties_enforce_posting_policy_on_update
  BEFORE UPDATE OF is_for_honor, amount, title, description ON public.bounties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_bounties_enforce_posting_policy_on_update();

COMMENT ON TRIGGER trg_bounties_enforce_posting_policy_on_update ON public.bounties IS
  '#836: mirrors trg_bounties_enforce_posting_policy for title/description contact-info edits as well as amount/for-honor policy changes.';
