-- Route client diagnostics through a narrow RPC so unauthenticated and expired
-- sessions remain observable without granting direct access to the log table.
CREATE TABLE IF NOT EXISTS public.client_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.client_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_logs_insert_authenticated ON public.client_logs;
REVOKE ALL ON TABLE public.client_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.write_client_log(
  p_level TEXT,
  p_message TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_level NOT IN ('info', 'warn', 'error')
    OR p_message IS NULL
    OR length(trim(p_message)) = 0
    OR length(p_message) > 1_000
    OR octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 16_384 THEN
    RAISE EXCEPTION 'Invalid client log payload' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.client_logs (level, message, metadata)
  VALUES (p_level, p_message, coalesce(p_metadata, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.write_client_log(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_client_log(TEXT, TEXT, JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';