-- "You're live" email: point its button at the website bounty page.
--
-- The button linked to bountyexpo-workspace://postings/<id>, which mail clients
-- such as Gmail strip (see process-notification APP_LINK_BASE) and which does
-- nothing for a poster who posted on bountyfinder.net without the app. The web
-- page (poster-web) works for every poster: it signs them in by email.
--
-- Only the ctaUrl changes; the trigger is untouched.
-- Rollback: supabase/rollbacks/production/20261008000000_bounty_posted_email_web_link.down.sql

create or replace function public.fn_email_bounty_posted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_url    text;
  v_key    text;
  v_poster uuid;
  v_reward text;
begin
  v_poster := coalesce(new.poster_id, new.user_id);
  if v_poster is null then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'SUPABASE_URL';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY';
  if v_url is null or v_key is null then
    raise warning 'fn_email_bounty_posted: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in vault (bounty %)', new.id;
    return null;
  end if;

  v_reward := case
    when new.is_for_honor then 'For honor'
    when new.amount = trunc(new.amount) then '$' || trunc(new.amount)::text
    else '$' || to_char(new.amount, 'FM999999990.00')
  end;

  perform net.http_post(
    url     := v_url || '/functions/v1/send-notification-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'userIds',  jsonb_build_array(v_poster),
      'category', 'marketplace',
      'type',     'bounty_posted',
      'title',    'You''re live',
      'body',     coalesce(new.title, ''),
      'data',     jsonb_build_object(
        'bountyId',      new.id,
        'bountyTitle',   coalesce(new.title, ''),
        'rewardDisplay', v_reward,
        'isInPerson',    (new.work_type::text = 'in_person'),
        'payAtHire',     (new.funding_mode = 'at_accept'),
        'ctaUrl',        'https://www.bountyfinder.net/bounty?id=' || new.id::text
      )
    )
  );

  return null;
exception when others then
  raise warning 'fn_email_bounty_posted failed for bounty %: %', new.id, sqlerrm;
  return null;
end;
$function$;
