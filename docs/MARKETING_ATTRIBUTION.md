# Marketing attribution

Which click produced a signup, how sure we are, and where that is written.

## The pipeline

```text
website / guerilla / share link
  └─ app-link            records marketing_clicks (click_id, utm_*, ip_hash, posthog_distinct_id)
       └─ store           Android: click_id rides in the Play Install Referrer
                          iPhone:  website copied https://www.bountyfinder.net/?install=<click_id>
            └─ first app open   captureInstallHandoff() pins referrer / clipboard click id
                 └─ first authenticated session
                      └─ marketing-attribute → fn_claim_install_attribution → marketing_attribution
                                              → PostHog $identify (web person → user), deterministic only
web sign-in (/bounty) ──────┘ platform: 'web', first touch + PostHog id from the same browser
```

Every first session writes a row, `unattributed` included, so coverage is measurable from
`marketing_attribution` alone.

## Match methods

| `match_method`         | Evidence                                                        | Confidence |
| ---------------------- | --------------------------------------------------------------- | ---------- |
| `play_referrer`        | Play Install Referrer (click id and/or UTMs; organic Play installs report `google-play / organic`) | 1.0 |
| `clipboard_handoff`    | iOS: the click id the website copied, read back on first open   | 1.0        |
| `web_session`          | Signed up in the browser that visited the site                  | 1.0        |
| `branch_deferred_link` | Branch, only if Branch reports `match_guaranteed`               | 1.0 / 0.6  |
| `fingerprint`          | Same daily IP hash + OS within 24 h                             | 0.3–0.7    |
| `unattributed`         | Nothing                                                         | 0          |

`marketing_attribution.attribution_reportable` is false for any match below 0.9. The reporting
views (`v_marketing_user_outcomes`, `v_marketing_campaign_performance`) and `rpc_marketing_report`
filter on it, the app never puts a non-reportable source on the PostHog person, and the server
never merges PostHog persons on one. Fingerprint rows are kept as leads only.

The rules live in `supabase/functions/_shared/install-attribution.ts` and are unit-tested in
`__tests__/unit/install-attribution.test.ts`.

## iOS clipboard handoff

On an iPhone App Store tap the website copies `https://www.bountyfinder.net/?install=<click_id>`.
On first open the app first asks `marketing-attribute` (`action: 'probe'`, anonymous) whether an
unclaimed iPhone click came from its IP in the last day, and only then reads the clipboard, which
is when iOS shows its paste prompt. Organic installs never see the prompt. Switch it off with
`IOS_CLIPBOARD_HANDOFF` in Bounty-landing-page `assets/app.js`.

## Links

Public CTAs point at `app-link`, either directly (the website, so the query string survives) or
through `https://bountyfinder.net/r/<source>/<campaign>` (Cloudflare `_redirects`). The website
adds `utm_*` (the visitor's first touch), `ph` (PostHog distinct id) and `cid` (click id).

If `BRANCH_KEY` is unset (true as of 2026-10-21), `app-link` redirects by user agent: iOS to the
App Store, Android to Play with the referrer, anything else to `PUBLIC_MARKETING_ORIGIN`.

## Required configuration

- Supabase Edge Functions: `POSTHOG_PROJECT_API_KEY`, `ATTRIBUTION_IP_SALT` (shared with the `go`
  redirector so either one's clicks match)
- Optional: `BRANCH_KEY`, `POSTHOG_HOST`, `PUBLIC_MARKETING_ORIGIN`
- Migration `20261021180000_install_attribution_writer.sql`

`20260808000000_add_posthog_person_property_sync.sql` was never applied to production and nothing
calls its `claim_marketing_attribution`. Calling it is what silenced attribution from 2026-09-09
to 2026-10-21.

## Checking it works

```sql
-- new rows every day
select attributed_at::date, match_method, count(*) from marketing_attribution
where attributed_at > now() - interval '7 days' group by 1, 2 order by 1 desc;

-- share of new profiles with a reportable, deterministic row
select count(*) profiles,
       count(*) filter (where a.match_confidence >= 0.9) deterministic,
       count(*) filter (where a.match_confidence >= 0.9 and a.first_utm_source is not null) with_source
from profiles p left join marketing_attribution a on a.user_id = p.id
where not coalesce(p.is_internal, false) and p.created_at > '<release time>';
```
