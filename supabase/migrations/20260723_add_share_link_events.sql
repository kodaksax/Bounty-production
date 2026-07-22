-- Share link analytics: records views/redirects on the public share pages
-- (supabase/functions/share-bounty, share-profile) so bounty/profile-share
-- performance (link opens, app-open vs store-redirect outcome) is measurable
-- server-side, independent of client-side PostHog capture. Written only by
-- the share-* edge functions via the service role key; RLS stays enabled
-- with no policies, so anon/authenticated clients get a default-deny and
-- cannot read or write these rows directly.
create table if not exists share_link_events (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('bounty', 'profile')),
  content_id uuid not null,
  event_type text not null check (event_type in ('page_view', 'app_redirect', 'store_redirect')),
  user_agent text,
  referrer text,
  created_at timestamptz not null default now()
);

create index if not exists share_link_events_content_idx
  on share_link_events (content_type, content_id, created_at);

alter table share_link_events enable row level security;
