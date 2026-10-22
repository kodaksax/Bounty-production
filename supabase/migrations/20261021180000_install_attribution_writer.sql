-- Install attribution writer (2026-10-21)
--
-- WHY: public.marketing_attribution received its last row at
-- 2026-09-09 04:51:39Z. Until then a hand-deployed `marketing-attribute`
-- (never committed) wrote one row per first app session. The 09-09
-- "deploy all functions from main" run replaced it with the repo version,
-- which calls public.claim_marketing_attribution(p_user_id, p_properties):
-- an RPC defined only in 20260808000000, a migration that was never applied
-- to production. Every call since has either returned `unattributed` without
-- writing (no source) or 500'd with "Could not find the function" (had a
-- source). 0 rows in 41 days.
--
-- WHAT:
--   1. marketing_clicks.posthog_distinct_id: the website visitor's PostHog id,
--      carried through app-link so a deterministic claim can merge the web
--      person into the app user.
--   2. marketing_attribution.device_os / web_distinct_id, and
--      attribution_reportable: false for any inferred match below 0.9. Every
--      report reads this one column, so the threshold lives in one place.
--   3. fn_claim_install_attribution: the single, atomic, first-touch writer.
--      Service role only (called by the marketing-attribute edge function).
--   4. Reporting views and rpc_marketing_report exclude non-reportable rows
--      from campaign credit. Guarded: staging does not have these objects.
--
-- The stale 20260808000000 migration is left untouched (its profiles columns
-- do not exist in prod; see its own history). Nothing here calls it.

alter table public.marketing_clicks
  add column if not exists posthog_distinct_id text;

alter table public.marketing_attribution
  add column if not exists device_os text,
  add column if not exists web_distinct_id text;

alter table public.marketing_attribution
  add column if not exists attribution_reportable boolean
  generated always as (
    coalesce(match_method = 'unattributed', false)
    or coalesce(match_confidence, 0) >= 0.9
  ) stored;

comment on column public.marketing_attribution.attribution_reportable is
  'False for inferred (IP/OS/time) matches below 0.9 confidence. Reports and campaign totals must filter on this.';

-- Fingerprint lookups only ever scan unclaimed clicks from the last day.
create index if not exists marketing_clicks_unmatched_ip_idx
  on public.marketing_clicks (ip_hash, clicked_at desc)
  where matched_user_id is null;

create or replace function public.fn_claim_install_attribution(
  p_user_id uuid,
  p_device_os text,
  p_match_method text,
  p_match_confidence numeric,
  p_click_id uuid default null,
  p_utm jsonb default '{}'::jsonb,
  p_web_distinct_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_click public.marketing_clicks;
  v_row public.marketing_attribution;
  v_utm jsonb := coalesce(p_utm, '{}'::jsonb);
  v_match_method text := p_match_method;
  v_match_confidence numeric := p_match_confidence;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_match_method is null or p_match_method not in (
    'play_referrer', 'clipboard_handoff', 'web_session',
    'branch_deferred_link', 'fingerprint', 'unattributed'
  ) then
    raise exception 'unknown match method: %', p_match_method;
  end if;
  if p_match_confidence is null or p_match_confidence < 0 or p_match_confidence > 1 then
    raise exception 'match confidence must be between 0 and 1';
  end if;

  -- First touch is immutable: a second install never rewrites the first.
  select * into v_row from public.marketing_attribution where user_id = p_user_id;
  if found then
    return to_jsonb(v_row) || jsonb_build_object('already_attributed', true);
  end if;

  if p_click_id is not null then
    select * into v_click from public.marketing_clicks where click_id = p_click_id for update;
    if v_click.click_id is not null
       and v_click.matched_user_id is not null
       and v_click.matched_user_id <> p_user_id
       and not (p_match_confidence >= 0.9 and coalesce(v_click.match_confidence, 0) < 0.9) then
      -- Never copy a click already deterministically claimed by another user.
      -- A deterministic match may still take over a previous low-confidence
      -- fingerprint claim.
      v_click := null;
      if p_match_method = 'branch_deferred_link' then
        v_match_confidence := least(p_match_confidence, 0.6);
      else
        v_match_method := 'unattributed';
        v_match_confidence := 0;
        v_utm := '{}'::jsonb;
      end if;
    end if;
  end if;

  insert into public.marketing_attribution (
    user_id,
    first_click_id, first_campaign_id, first_creative_id,
    first_utm_source, first_utm_medium, first_utm_campaign, first_utm_content,
    first_touch_at,
    last_click_id, last_campaign_id, last_creative_id,
    last_utm_source, last_utm_campaign, last_touch_at,
    platform, match_method, match_confidence, device_os, web_distinct_id
  ) values (
    p_user_id,
    v_click.click_id, v_click.campaign_id, v_click.creative_id,
    coalesce(v_click.utm_source, nullif(v_utm->>'source', '')),
    coalesce(v_click.utm_medium, nullif(v_utm->>'medium', '')),
    coalesce(v_click.utm_campaign, nullif(v_utm->>'campaign', '')),
    coalesce(v_click.utm_content, nullif(v_utm->>'content', '')),
    v_click.clicked_at,
    v_click.click_id, v_click.campaign_id, v_click.creative_id,
    coalesce(v_click.utm_source, nullif(v_utm->>'source', '')),
    coalesce(v_click.utm_campaign, nullif(v_utm->>'campaign', '')),
    v_click.clicked_at,
    -- `platform` has always meant the marketing platform the click came
    -- through (linkedin, instagram, website), not the device OS.
    coalesce(v_click.platform, v_click.utm_source, nullif(v_utm->>'source', '')),
    v_match_method, v_match_confidence, p_device_os,
    coalesce(nullif(p_web_distinct_id, ''), v_click.posthog_distinct_id)
  )
  on conflict (user_id) do nothing
  returning * into v_row;

  if v_row.user_id is null then
    -- Lost a race with a concurrent first session for the same user.
    select * into v_row from public.marketing_attribution where user_id = p_user_id;
    return to_jsonb(v_row) || jsonb_build_object('already_attributed', true);
  end if;

  if v_click.click_id is not null then
    -- A deterministic claim may take over a click an inference had guessed at;
    -- an inference never takes a click from anyone.
    update public.marketing_clicks
       set matched_user_id = p_user_id,
           matched_at = now(),
           match_method = v_match_method,
           match_confidence = v_match_confidence
     where click_id = v_click.click_id
       and (
         matched_user_id is null
         or (v_match_confidence >= 0.9 and coalesce(match_confidence, 0) < 0.9)
       );
  end if;

  return to_jsonb(v_row) || jsonb_build_object('already_attributed', false);
end;
$$;

revoke all on function public.fn_claim_install_attribution(uuid, text, text, numeric, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.fn_claim_install_attribution(uuid, text, text, numeric, uuid, jsonb, text)
  to service_role;

-- ---------------------------------------------------------------- reporting
-- Production-only objects (created out of band in July; staging has none).
-- Column lists are unchanged, so CREATE OR REPLACE is safe.

do $do$
begin
  if to_regclass('public.v_marketing_user_outcomes') is not null then
    execute $view$
      create or replace view public.v_marketing_user_outcomes as
      select a.user_id,
          a.first_campaign_id as campaign_id,
          a.first_creative_id as creative_id,
          a.first_utm_source as utm_source,
          a.first_utm_campaign as utm_campaign,
          a.platform,
          a.match_method,
          a.match_confidence,
          a.first_touch_at,
          p.created_at as signed_up_at,
          p.onboarding_completed,
          p.stripe_connect_onboarding_complete as connect_completed,
          (select min(b.created_at) from bounties b
            where coalesce(b.poster_id, b.user_id) = a.user_id) as first_bounty_posted_at,
          (select count(*) from bounties b
            where coalesce(b.poster_id, b.user_id) = a.user_id) as bounties_posted,
          (select count(*) from bounties b
            where coalesce(b.poster_id, b.user_id) = a.user_id
              and b.status = 'completed'::bounty_status_enum) as bounties_completed_as_poster,
          (select min(r.created_at) from bounty_requests r
            where r.hunter_id = a.user_id) as first_bounty_accepted_at,
          (select count(*) from bounty_requests r
            where r.hunter_id = a.user_id) as bounties_applied_to,
          (select min(w.created_at) from wallet_transactions w
            where w.user_id = a.user_id
              and w.type = 'deposit'::wallet_tx_type_enum
              and w.status = 'completed'::wallet_tx_status_enum) as first_payment_at,
          (select coalesce(sum(w.amount), 0::numeric) from wallet_transactions w
            where w.user_id = a.user_id
              and w.type = 'deposit'::wallet_tx_type_enum
              and w.status = 'completed'::wallet_tx_status_enum) as total_deposited
      from marketing_attribution a
      join profiles p on p.id = a.user_id
      where a.attribution_reportable
    $view$;
  end if;

  if to_regclass('public.v_marketing_campaign_performance') is not null then
    execute $view$
      create or replace view public.v_marketing_campaign_performance as
      with metrics as (
        select distinct on (m.creative_id, m.platform, m.source)
            m.creative_id, m.campaign_id, m.platform, m.reach, m.impressions, m.clicks,
            m.link_clicks, m.ctr, m.likes, m.shares, m.comments, m.saves, m.video_views,
            m.engagement_rate, m.spend_cents
        from marketing_platform_metrics m
        order by m.creative_id, m.platform, m.source, m.snapshot_date desc
      ), clicks as (
        select k.creative_id,
            count(*) as tracked_clicks,
            count(*) filter (
              where k.matched_user_id is not null and coalesce(k.match_confidence, 0) >= 0.9
            ) as attributed_installs
        from marketing_clicks k
        group by k.creative_id
      ), outcomes as (
        select o.creative_id,
            count(*) as signups,
            count(*) filter (where o.onboarding_completed) as activated,
            count(*) filter (where o.first_bounty_posted_at is not null) as bounty_creators,
            sum(o.bounties_posted) as bounties_created,
            sum(o.bounties_completed_as_poster) as bounties_completed,
            count(*) filter (where o.first_payment_at is not null) as paying_users,
            sum(o.total_deposited) as revenue_deposited
        from v_marketing_user_outcomes o
        group by o.creative_id
      )
      select c.campaign_id,
          c.creative_id,
          c.platform,
          mc.audience,
          c.creative_style,
          c.cta,
          c.headline,
          c.posting_hour,
          c.posting_weekday,
          c.publish_timestamp,
          mc.objective,
          mc.geography,
          coalesce(m.reach, 0::bigint) as reach,
          coalesce(m.impressions, 0::bigint) as impressions,
          coalesce(m.clicks, 0::bigint) as clicks,
          coalesce(m.link_clicks, 0::bigint) as link_clicks,
          m.ctr,
          coalesce(m.shares, 0::bigint) as shares,
          coalesce(m.comments, 0::bigint) as comments,
          coalesce(m.saves, 0::bigint) as saves,
          m.engagement_rate,
          coalesce(cl.tracked_clicks, 0::bigint) as tracked_clicks,
          coalesce(cl.attributed_installs, 0::bigint) as installs,
          coalesce(o.signups, 0::bigint) as signups,
          coalesce(o.activated, 0::bigint) as activated,
          coalesce(o.bounty_creators, 0::bigint) as bounty_creators,
          coalesce(o.bounties_created, 0::numeric) as bounties_created,
          coalesce(o.bounties_completed, 0::numeric) as bounties_completed,
          coalesce(o.paying_users, 0::bigint) as paying_users,
          coalesce(o.revenue_deposited, 0::numeric) as revenue_deposited,
          coalesce(m.spend_cents, 0::bigint) as spend_cents,
          case when coalesce(cl.tracked_clicks, 0::bigint) > 0
            then round(coalesce(cl.attributed_installs, 0::bigint)::numeric / cl.tracked_clicks::numeric, 4)
          end as click_to_install_rate,
          case when coalesce(cl.attributed_installs, 0::bigint) > 0
            then round(coalesce(o.signups, 0::bigint)::numeric / cl.attributed_installs::numeric, 4)
          end as install_to_signup_rate,
          case when coalesce(o.signups, 0::bigint) > 0
            then round(coalesce(o.bounty_creators, 0::bigint)::numeric / o.signups::numeric, 4)
          end as signup_to_bounty_rate,
          case when coalesce(o.signups, 0::bigint) > 0 and coalesce(m.spend_cents, 0::bigint) > 0
            then round(m.spend_cents::numeric / o.signups::numeric / 100::numeric, 2)
          end as estimated_cac,
          case when coalesce(o.bounty_creators, 0::bigint) > 0 and coalesce(m.spend_cents, 0::bigint) > 0
            then round(m.spend_cents::numeric / o.bounty_creators::numeric / 100::numeric, 2)
          end as cost_per_bounty_creator
      from marketing_creatives c
      join marketing_campaigns mc on mc.campaign_id = c.campaign_id
      left join metrics m on m.creative_id = c.creative_id
      left join clicks cl on cl.creative_id = c.creative_id
      left join outcomes o on o.creative_id = c.creative_id
    $view$;
  end if;

  if to_regprocedure('public.rpc_marketing_report(integer)') is not null then
    execute $fn$
      create or replace function public.rpc_marketing_report(p_days integer default 7)
       returns jsonb
       language sql
       stable security definer
       set search_path to 'public', 'pg_catalog'
      as $body$
      with window_bounds as (
        select (now() - make_interval(days => p_days))::date as period_start,
               now()::date as period_end
      ),
      perf as (
        select * from public.v_marketing_campaign_performance
        where publish_timestamp >= (select period_start from window_bounds)
      ),
      by_campaign as (
        select campaign_id,
               sum(impressions) impressions, sum(tracked_clicks) clicks, sum(installs) installs,
               sum(signups) signups, sum(bounties_created) bounties_created,
               sum(bounties_completed) bounties_completed, sum(spend_cents) spend_cents,
               round(avg(engagement_rate)::numeric,4) engagement_rate,
               count(*) creatives
        from perf group by campaign_id
      ),
      by_platform as (
        select platform, sum(installs) installs, sum(signups) signups,
               sum(tracked_clicks) clicks, sum(impressions) impressions,
               sum(bounties_created) bounties_created,
               case when sum(tracked_clicks) > 0
                    then round(sum(installs)::numeric / sum(tracked_clicks), 4) end as click_to_install
        from perf group by platform
      ),
      best_window as (
        select posting_hour, sum(installs) installs, sum(signups) signups,
               round(avg(engagement_rate)::numeric,4) er, count(*) n
        from perf where posting_hour is not null group by posting_hour
      )
      select jsonb_build_object(
        'period_start', (select period_start from window_bounds),
        'period_end',   (select period_end from window_bounds),
        'days',         p_days,
        'totals', (select jsonb_build_object(
            'creatives_published', count(*),
            'impressions', coalesce(sum(impressions),0),
            'clicks', coalesce(sum(tracked_clicks),0),
            'installs', coalesce(sum(installs),0),
            'signups', coalesce(sum(signups),0),
            'bounties_created', coalesce(sum(bounties_created),0),
            'bounties_completed', coalesce(sum(bounties_completed),0),
            'spend_usd', round(coalesce(sum(spend_cents),0)::numeric/100, 2),
            'signup_conversion_rate', case when sum(installs) > 0
                then round(sum(signups)::numeric / sum(installs), 4) end,
            'cac_usd', case when sum(signups) > 0 and sum(spend_cents) > 0
                then round(sum(spend_cents)::numeric / sum(signups) / 100, 2) end
          ) from perf),
        'top_campaign',   (select to_jsonb(t) from (
            select * from by_campaign order by bounties_created desc, signups desc, installs desc limit 1) t),
        'worst_campaign', (select to_jsonb(t) from (
            select * from by_campaign where creatives >= 2
            order by bounties_created asc, signups asc, engagement_rate asc nulls first limit 1) t),
        'best_creative_style', (select to_jsonb(t) from (
            select creative_style, sum(installs) installs, sum(signups) signups,
                   sum(bounties_created) bounties_created, round(avg(engagement_rate)::numeric,4) er
            from perf where creative_style is not null group by creative_style
            order by bounties_created desc, signups desc, er desc nulls last limit 1) t),
        'best_cta', (select to_jsonb(t) from (
            select cta, sum(installs) installs, sum(signups) signups, sum(bounties_created) bounties_created
            from perf where cta is not null group by cta
            order by signups desc, installs desc limit 1) t),
        'best_posting_window', (select to_jsonb(t) from (
            select * from best_window order by signups desc, installs desc, er desc nulls last limit 1) t),
        'best_audience', (select to_jsonb(t) from (
            select audience, sum(installs) installs, sum(signups) signups,
                   sum(bounties_created) bounties_created, sum(bounties_completed) bounties_completed
            from perf where audience is not null group by audience
            order by bounties_completed desc, bounties_created desc, signups desc limit 1) t),
        'installs_by_platform', (select jsonb_agg(to_jsonb(t)) from by_platform t),
        'campaigns',            (select jsonb_agg(to_jsonb(t)) from by_campaign t),
        'attribution_quality', (select jsonb_build_object(
            'total_attributed', count(*),
            'deterministic', count(*) filter (where match_confidence >= 1.0),
            'probabilistic', count(*) filter (where match_confidence > 0 and match_confidence < 1.0),
            'unattributed',  count(*) filter (where match_method = 'unattributed'),
            'reportable', count(*) filter (where attribution_reportable),
            'excluded_low_confidence', count(*) filter (where not attribution_reportable)
          ) from public.marketing_attribution),
        'open_experiments', (select jsonb_agg(jsonb_build_object(
            'hypothesis', hypothesis, 'dimension', dimension,
            'variant_a', variant_a, 'variant_b', variant_b, 'started_at', started_at))
          from public.marketing_experiments where status = 'running')
      );
      $body$
    $fn$;
  end if;
end
$do$;
