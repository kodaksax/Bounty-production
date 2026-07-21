-- Sync RLS enablement + policies across environments.
--
-- CONTEXT: an environment audit found that production has Row Level Security
-- correctly enabled (with policies) on the tables below, but the development
-- and staging Supabase branches do not — 17 tables on development and 13 on
-- staging had RLS disabled entirely, meaning the anon/authenticated roles
-- (i.e. the mobile app's own credentials) could read or write every row with
-- no restriction. This migration ports production's exact policies so dev
-- and staging match. Written to be safe to run on ALL THREE environments,
-- including production: DROP POLICY IF EXISTS + CREATE POLICY makes each
-- policy a no-op where it already exists identically, and ENABLE ROW LEVEL
-- SECURITY is idempotent.
--
-- NOT included: spatial_ref_sys. This is a PostGIS extension-owned reference
-- table (coordinate system constants, no user data) — Supabase's linter flags
-- it generically but there is nothing user-controlled to protect, and it is
-- standard practice to leave it as-is.
--
-- completion_ready, notifications_outbox, and stripe_events intentionally get
-- RLS enabled with NO policies, matching production: these are service-role
-- only tables (written/read exclusively by edge functions using the service
-- role key, which bypasses RLS). Enabling RLS with zero policies is what
-- blocks anon/authenticated from touching them directly while leaving
-- service-role access untouched.
--
-- REVIEW BEFORE APPLYING to development/staging: confirm the app's usage of
-- these tables on those branches matches production's assumptions (e.g. any
-- feature exercised only on staging/dev that reads one of these tables in a
-- way production's policies don't allow will start failing once RLS is on).

-- ---------------------------------------------------------------------------
-- Tables that get RLS enabled with NO policies (service-role only by design)
-- ---------------------------------------------------------------------------
alter table public.completion_ready enable row level security;
alter table public.notifications_outbox enable row level security;
alter table public.stripe_events enable row level security;

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------
alter table public.payment_methods enable row level security;

drop policy if exists "payment_methods_select_own" on public.payment_methods;
create policy "payment_methods_select_own" on public.payment_methods
  for select to public
  using (auth.uid() = user_id);

drop policy if exists "payment_methods_insert_own" on public.payment_methods;
create policy "payment_methods_insert_own" on public.payment_methods
  for insert to public
  with check (auth.uid() = user_id);

drop policy if exists "payment_methods_update_own" on public.payment_methods;
create policy "payment_methods_update_own" on public.payment_methods
  for update to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "payment_methods_delete_own" on public.payment_methods;
create policy "payment_methods_delete_own" on public.payment_methods
  for delete to public
  using (auth.uid() = user_id);

drop policy if exists "service_role_manage_payment_methods" on public.payment_methods;
create policy "service_role_manage_payment_methods" on public.payment_methods
  for all to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- push_tokens
-- ---------------------------------------------------------------------------
alter table public.push_tokens enable row level security;

drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own" on public.push_tokens
  for select to public
  using (auth.uid() = user_id);

drop policy if exists "push_tokens_insert_own" on public.push_tokens;
create policy "push_tokens_insert_own" on public.push_tokens
  for insert to public
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_update_own" on public.push_tokens;
create policy "push_tokens_update_own" on public.push_tokens
  for update to public
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens_delete_own" on public.push_tokens;
create policy "push_tokens_delete_own" on public.push_tokens
  for delete to public
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- user_devices
-- ---------------------------------------------------------------------------
alter table public.user_devices enable row level security;

drop policy if exists "Users can view their own devices" on public.user_devices;
create policy "Users can view their own devices" on public.user_devices
  for select to public
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own devices" on public.user_devices;
create policy "Users can insert their own devices" on public.user_devices
  for insert to public
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own devices" on public.user_devices;
create policy "Users can update their own devices" on public.user_devices
  for update to public
  using (auth.uid() = user_id);

drop policy if exists "Users can delete their own devices" on public.user_devices;
create policy "Users can delete their own devices" on public.user_devices
  for delete to public
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- bounty_requests
-- ---------------------------------------------------------------------------
alter table public.bounty_requests enable row level security;

drop policy if exists "Hunters can create applications" on public.bounty_requests;
create policy "Hunters can create applications" on public.bounty_requests
  for insert to public
  with check (auth.uid() = hunter_id);

drop policy if exists "Hunters can view their own applications" on public.bounty_requests;
create policy "Hunters can view their own applications" on public.bounty_requests
  for select to public
  using (auth.uid() = hunter_id);

drop policy if exists "Hunters can delete their own pending applications" on public.bounty_requests;
create policy "Hunters can delete their own pending applications" on public.bounty_requests
  for delete to public
  using (auth.uid() = hunter_id and status = 'pending'::request_status_enum);

drop policy if exists "Posters can view requests for their bounties" on public.bounty_requests;
create policy "Posters can view requests for their bounties" on public.bounty_requests
  for select to public
  using (exists (select 1 from bounties where bounties.id = bounty_requests.bounty_id and bounties.poster_id = auth.uid()));

drop policy if exists "Posters can update requests for their bounties" on public.bounty_requests;
create policy "Posters can update requests for their bounties" on public.bounty_requests
  for update to public
  using (exists (select 1 from bounties where bounties.id = bounty_requests.bounty_id and bounties.poster_id = auth.uid()));

drop policy if exists "Posters can delete requests for their bounties" on public.bounty_requests;
create policy "Posters can delete requests for their bounties" on public.bounty_requests
  for delete to public
  using (exists (select 1 from bounties where bounties.id = bounty_requests.bounty_id and bounties.poster_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- completion_submissions (already enabled on staging; harmless to re-apply)
-- ---------------------------------------------------------------------------
alter table public.completion_submissions enable row level security;

drop policy if exists "completion_submissions_select_related" on public.completion_submissions;
create policy "completion_submissions_select_related" on public.completion_submissions
  for select to public
  using (
    auth.uid() = hunter_id
    or exists (
      select 1 from bounties
      where bounties.id = completion_submissions.bounty_id
        and (bounties.poster_id = auth.uid() or bounties.accepted_by = auth.uid())
    )
  );

drop policy if exists "completion_submissions_select_hunter" on public.completion_submissions;
create policy "completion_submissions_select_hunter" on public.completion_submissions
  for select to authenticated
  using (auth.uid() = hunter_id);

drop policy if exists "completion_submissions_select_poster" on public.completion_submissions;
create policy "completion_submissions_select_poster" on public.completion_submissions
  for select to authenticated
  using (exists (select 1 from bounties where bounties.id = completion_submissions.bounty_id and bounties.poster_id = auth.uid()));

drop policy if exists "completion_submissions_insert_hunter" on public.completion_submissions;
create policy "completion_submissions_insert_hunter" on public.completion_submissions
  for insert to authenticated
  with check (auth.uid() = hunter_id);

drop policy if exists "completion_submissions_update_hunter" on public.completion_submissions;
create policy "completion_submissions_update_hunter" on public.completion_submissions
  for update to authenticated
  using (auth.uid() = hunter_id and status = any (array['pending'::text, 'revision_requested'::text]))
  with check (auth.uid() = hunter_id and status = any (array['pending'::text, 'revision_requested'::text]));

drop policy if exists "completion_submissions_update_poster" on public.completion_submissions;
create policy "completion_submissions_update_poster" on public.completion_submissions
  for update to authenticated
  using (exists (select 1 from bounties where bounties.id = completion_submissions.bounty_id and bounties.poster_id = auth.uid()))
  with check (exists (select 1 from bounties where bounties.id = completion_submissions.bounty_id and bounties.poster_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- bounty_cancellations
-- ---------------------------------------------------------------------------
alter table public.bounty_cancellations enable row level security;

drop policy if exists "bounty_cancellations_select_related" on public.bounty_cancellations;
create policy "bounty_cancellations_select_related" on public.bounty_cancellations
  for select to authenticated
  using (
    auth.uid() = requester_id
    or auth.uid() = responder_id
    or exists (
      select 1 from bounties
      where bounties.id = bounty_cancellations.bounty_id
        and (bounties.poster_id = auth.uid() or bounties.accepted_by = auth.uid())
    )
  );

drop policy if exists "bounty_cancellations_insert_related" on public.bounty_cancellations;
create policy "bounty_cancellations_insert_related" on public.bounty_cancellations
  for insert to authenticated
  with check (
    auth.uid() = requester_id
    and exists (
      select 1 from bounties
      where bounties.id = bounty_cancellations.bounty_id
        and (bounties.poster_id = auth.uid() or bounties.accepted_by = auth.uid())
    )
  );

drop policy if exists "bounty_cancellations_update_responder" on public.bounty_cancellations;
create policy "bounty_cancellations_update_responder" on public.bounty_cancellations
  for update to authenticated
  using (
    auth.uid() is not null
    and auth.uid() <> requester_id
    and exists (
      select 1 from bounties
      where bounties.id = bounty_cancellations.bounty_id
        and (bounties.poster_id = auth.uid() or bounties.accepted_by = auth.uid())
    )
  )
  with check (auth.uid() = responder_id);

-- ---------------------------------------------------------------------------
-- bounty_disputes (already enabled on staging; needed on development)
-- ---------------------------------------------------------------------------
alter table public.bounty_disputes enable row level security;

drop policy if exists "Admin manage" on public.bounty_disputes;
create policy "Admin manage" on public.bounty_disputes
  for all to authenticated
  using ((auth.jwt() ->> 'role') = 'admin')
  with check ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists "Admins can view all disputes" on public.bounty_disputes;
create policy "Admins can view all disputes" on public.bounty_disputes
  for select to public
  using (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

drop policy if exists "Only admins can update disputes" on public.bounty_disputes;
create policy "Only admins can update disputes" on public.bounty_disputes
  for update to public
  using (((auth.jwt() -> 'app_metadata') ->> 'role') = 'admin');

drop policy if exists "Bounty participants can create workflow disputes" on public.bounty_disputes;
create policy "Bounty participants can create workflow disputes" on public.bounty_disputes
  for insert to public
  with check (
    initiator_id = auth.uid()
    and dispute_stage = any (array['in_progress'::text, 'review_verify'::text])
    and exists (
      select 1 from bounties b
      where b.id = bounty_disputes.bounty_id
        and b.status = 'in_progress'::bounty_status_enum
        and (b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Participants insert" on public.bounty_disputes;
create policy "Participants insert" on public.bounty_disputes
  for insert to authenticated
  with check (auth.uid() = initiator_id);

drop policy if exists "Participants select" on public.bounty_disputes;
create policy "Participants select" on public.bounty_disputes
  for select to authenticated
  using (
    auth.uid() is not null
    and exists (
      select 1 from bounties b
      where b.id = bounty_disputes.bounty_id
        and (b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Initiator update" on public.bounty_disputes;
create policy "Initiator update" on public.bounty_disputes
  for update to authenticated
  using (auth.uid() = initiator_id)
  with check (auth.uid() = initiator_id);

drop policy if exists "Initiator delete" on public.bounty_disputes;
create policy "Initiator delete" on public.bounty_disputes
  for delete to authenticated
  using (auth.uid() = initiator_id);

-- ---------------------------------------------------------------------------
-- dispute_appeals
-- ---------------------------------------------------------------------------
alter table public.dispute_appeals enable row level security;

drop policy if exists "Users can view their own appeals" on public.dispute_appeals;
create policy "Users can view their own appeals" on public.dispute_appeals
  for select to public
  using (appellant_id = auth.uid());

drop policy if exists "Users can create appeals for their disputes" on public.dispute_appeals;
create policy "Users can create appeals for their disputes" on public.dispute_appeals
  for insert to public
  with check (
    appellant_id = auth.uid()
    and exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_appeals.dispute_id
        and bd.status::text = 'resolved'
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Admins can view all appeals" on public.dispute_appeals;
create policy "Admins can view all appeals" on public.dispute_appeals
  for select to public
  using ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists "Admins can update appeals" on public.dispute_appeals;
create policy "Admins can update appeals" on public.dispute_appeals
  for update to public
  using ((auth.jwt() ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- dispute_comments
-- ---------------------------------------------------------------------------
alter table public.dispute_comments enable row level security;

drop policy if exists "Users can view public comments on their disputes" on public.dispute_comments;
create policy "Users can view public comments on their disputes" on public.dispute_comments
  for select to public
  using (
    not is_internal
    and exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_comments.dispute_id
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Users can add comments to their disputes" on public.dispute_comments;
create policy "Users can add comments to their disputes" on public.dispute_comments
  for insert to public
  with check (
    user_id = auth.uid()
    and not is_internal
    and exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_comments.dispute_id
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Admins can view all comments" on public.dispute_comments;
create policy "Admins can view all comments" on public.dispute_comments
  for select to public
  using ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists "Admins can add any comments" on public.dispute_comments;
create policy "Admins can add any comments" on public.dispute_comments
  for insert to public
  with check (user_id = auth.uid() and (auth.jwt() ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- dispute_evidence
-- ---------------------------------------------------------------------------
alter table public.dispute_evidence enable row level security;

drop policy if exists "Anyone can view evidence for disputes they're involved in" on public.dispute_evidence;
create policy "Anyone can view evidence for disputes they're involved in" on public.dispute_evidence
  for select to public
  using (
    exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_evidence.dispute_id
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Users can add evidence to their disputes" on public.dispute_evidence;
create policy "Users can add evidence to their disputes" on public.dispute_evidence
  for insert to public
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_evidence.dispute_id
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- dispute_resolutions
-- ---------------------------------------------------------------------------
alter table public.dispute_resolutions enable row level security;

drop policy if exists "Anyone can view resolutions for disputes they're involved in" on public.dispute_resolutions;
create policy "Anyone can view resolutions for disputes they're involved in" on public.dispute_resolutions
  for select to public
  using (
    exists (
      select 1 from bounty_disputes bd join bounties b on bd.bounty_id = b.id
      where bd.id = dispute_resolutions.dispute_id
        and (bd.initiator_id = auth.uid() or b.poster_id = auth.uid() or b.accepted_by = auth.uid())
    )
  );

drop policy if exists "Only admins can create resolutions" on public.dispute_resolutions;
create policy "Only admins can create resolutions" on public.dispute_resolutions
  for insert to public
  with check ((auth.jwt() ->> 'role') = 'admin');

-- ---------------------------------------------------------------------------
-- dispute_audit_log
-- ---------------------------------------------------------------------------
alter table public.dispute_audit_log enable row level security;

drop policy if exists "Admins can view all audit logs" on public.dispute_audit_log;
create policy "Admins can view all audit logs" on public.dispute_audit_log
  for select to public
  using ((auth.jwt() ->> 'role') = 'admin');

drop policy if exists "System can insert audit logs" on public.dispute_audit_log;
create policy "System can insert audit logs" on public.dispute_audit_log
  for insert to public
  with check (true);

-- ---------------------------------------------------------------------------
-- admin_warnings (already enabled on staging; needed on development)
-- ---------------------------------------------------------------------------
alter table public.admin_warnings enable row level security;

drop policy if exists "Users can read their own warnings" on public.admin_warnings;
create policy "Users can read their own warnings" on public.admin_warnings
  for select to public
  using (user_id = auth.uid());

drop policy if exists "Admins can manage warnings" on public.admin_warnings;
create policy "Admins can manage warnings" on public.admin_warnings
  for all to public
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'::text));
