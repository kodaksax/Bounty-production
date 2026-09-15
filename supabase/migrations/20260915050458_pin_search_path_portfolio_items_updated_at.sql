-- Follow-up to 20260915050320_portfolio_items.sql: get_advisors flagged
-- set_portfolio_items_updated_at with a mutable search_path (function_search_path_mutable).
-- Pins it, consistent with this project's existing
-- pin_search_path_on_security_definer_functions /
-- pin_search_path_on_remaining_mutable_functions migrations.
create or replace function public.set_portfolio_items_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
