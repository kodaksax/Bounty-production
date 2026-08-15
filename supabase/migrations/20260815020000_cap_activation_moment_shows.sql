-- Database backstop for activation prompt presentation counts. The client
-- engine also enforces this limit, but the table must remain bounded if an
-- older client or concurrent writer attempts to increment it directly.

CREATE OR REPLACE FUNCTION public.cap_user_activation_moment_shown_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.shown_count = LEAST(COALESCE(NEW.shown_count, 0), 3);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cap_user_activation_moment_shown_count
  ON public.user_activation_moments;
CREATE TRIGGER trg_cap_user_activation_moment_shown_count
  BEFORE INSERT OR UPDATE OF shown_count
  ON public.user_activation_moments
  FOR EACH ROW
  EXECUTE FUNCTION public.cap_user_activation_moment_shown_count();

COMMENT ON FUNCTION public.cap_user_activation_moment_shown_count() IS
  'Clamps activation moment shown_count to the universal three-show backstop.';