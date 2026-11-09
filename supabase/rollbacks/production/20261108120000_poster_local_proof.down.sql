-- Rollback for 20261108120000_poster_local_proof.sql
BEGIN;

DROP FUNCTION IF EXISTS public.fn_poster_local_proof(double precision, double precision, double precision);

NOTIFY pgrst, 'reload schema';

COMMIT;
