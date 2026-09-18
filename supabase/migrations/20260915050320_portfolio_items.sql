-- Server-backed portfolio ("work samples provided by hunter"). Replaces the
-- AsyncStorage-only implementation in lib/services/portfolio-service.ts,
-- whose item metadata never left the device it was added on, so a poster
-- viewing a hunter's profile from a different device saw nothing.
--
-- Also adopts and locks down the `portfolio_pictures` Storage bucket, which
-- already existed live (public, empty, zero RLS policies, not referenced
-- anywhere in git) -- a shadow resource from earlier work.

create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'image' check (type in ('image', 'video', 'file')),
  url text not null,
  thumbnail_url text,
  title text,
  description text,
  category text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists portfolio_items_user_id_idx on public.portfolio_items (user_id, position);

alter table public.portfolio_items enable row level security;

-- Portfolio items are meant to be poster-visible (the whole point of a work
-- sample is that someone deciding whether to hire this hunter can see it),
-- so unlike profiles' self-only base-table RLS, any authenticated user may
-- read any row. Nothing sensitive is stored here.
drop policy if exists portfolio_items_select_authenticated on public.portfolio_items;
create policy portfolio_items_select_authenticated
  on public.portfolio_items for select
  to authenticated
  using (true);

drop policy if exists portfolio_items_insert_own on public.portfolio_items;
create policy portfolio_items_insert_own
  on public.portfolio_items for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists portfolio_items_update_own on public.portfolio_items;
create policy portfolio_items_update_own
  on public.portfolio_items for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists portfolio_items_delete_own on public.portfolio_items;
create policy portfolio_items_delete_own
  on public.portfolio_items for delete
  to authenticated
  using (auth.uid() = user_id);

-- Max portfolio size: 5 work samples per spec. Enforced app-side too
-- (portfolioService.canAddItem), but this app's history has repeated
-- app-only-check bypasses, so this is defense-in-depth, not the only gate.
create or replace function public.enforce_portfolio_item_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.portfolio_items where user_id = new.user_id) >= 5 then
    raise exception 'Maximum of 5 portfolio items allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists portfolio_items_limit_trigger on public.portfolio_items;
create trigger portfolio_items_limit_trigger
  before insert on public.portfolio_items
  for each row execute function public.enforce_portfolio_item_limit();

create or replace function public.set_portfolio_items_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portfolio_items_updated_at_trigger on public.portfolio_items;
create trigger portfolio_items_updated_at_trigger
  before update on public.portfolio_items
  for each row execute function public.set_portfolio_items_updated_at();

grant select, insert, update, delete on public.portfolio_items to authenticated;

-- Lock down the pre-existing portfolio_pictures bucket: images only, 5MB cap.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'portfolio_pictures';

-- Public bucket (consistent with the existing profiles/Profilepictures
-- buckets): the public URL read path does not consult storage.objects RLS,
-- so read access does not depend on these policies. Writes are scoped to a
-- `${auth.uid()}/...` path prefix so a hunter can only manage their own files.
drop policy if exists portfolio_pictures_insert_own on storage.objects;
create policy portfolio_pictures_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'portfolio_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_pictures_update_own on storage.objects;
create policy portfolio_pictures_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'portfolio_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'portfolio_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_pictures_delete_own on storage.objects;
create policy portfolio_pictures_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'portfolio_pictures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
