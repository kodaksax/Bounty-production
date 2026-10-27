# Poster activation funnel

Decided 2026-10-26. This replaces every funnel, cohort and "activated" count
that used `onboarding_completed` as the activation gate.

## Definition

| Step | Event | Filter |
| --- | --- | --- |
| 1 | `signup_completed` | none (server-sent, `source: server_profile_insert`) |
| 2 | `role_selected` | `role = poster` |
| 3 | `bounty_started` | first real interaction with the composer |
| 4 | `bounty_published` | none |

**KPI:** `poster_activated`, counted once per person (PostHog math
`first_time_for_user`). It fires on the first successful publish
(`lib/analytics/lifecycle.ts`).

Every query excludes `app_env = staging` and `is_internal = true`, and sets
`filterTestAccounts`.

## Why `onboarding_completed` is retired

It records that the onboarding screens ended. It is neither necessary nor
sufficient for posting. PostHog, 90 days to 2026-10-26, non-internal:

- 13 of 29 activated posters (45%) had no `onboarding_completed` before their
  first publish.
- 314 of 330 people who completed onboarding never posted.

The flag on `profiles.onboarding_completed` still controls routing (whether the
app sends someone back into onboarding). That use stays.

## Where it lives

| What | PostHog |
| --- | --- |
| Funnel (steps 1–4) | [ZRXRVayO "Poster activation funnel"](https://us.posthog.com/project/461576/insights/ZRXRVayO) |
| KPI, weekly | [vC1kRCrT "Poster activated (KPI)"](https://us.posthog.com/project/461576/insights/vC1kRCrT) |
| Full marketplace funnel | [kSuLqUW9](https://us.posthog.com/project/461576/insights/kSuLqUW9): `onboarding_completed` step replaced by `role_selected` (poster) |

## Data boundaries

- **The funnel starts 2026-10-20.** That is when the server began sending
  `signup_completed` for every new profile (PR #936). Before then, the client
  event covered about 17% of new profiles, so any earlier window understates
  step 1 and inflates every later rate.
- `role_selected` moved from the pre-auth Welcome screen to the post-auth
  `app/onboarding/role-select.tsx` around 2026-09-28. The poster share fell
  from ~50% (Welcome, September) to ~15% (role-select, October). Compare rates
  across that date with care.
- `poster_activated`'s guard is per (user, device), so a reinstall can fire it
  twice. `first_time_for_user` dedupes that. Cross-check against Supabase:
  `min(bounties.created_at)` per non-internal poster. On 2026-10-26 the two
  agreed closely (60 days: 29 persons in PostHog, 25 posters in Postgres).

## Baseline (2026-10-20 to 2026-10-26)

72 signed up → 11 chose poster → 2 started a bounty → 0 published. Postgres
agrees: no non-internal profile posted a first bounty in that window, out of
69 new profiles.

## Not yet moved off `onboarding_completed`

- `public.v_marketing_campaign_performance.activated` (prod-only view,
  redefined in `supabase/migrations/20261021180000_install_attribution_writer.sql`)
  still counts `onboarding_completed`. Its `bounty_creators` column is the
  poster-activation equivalent. Changing `activated` needs a new migration and
  a prod go-ahead.
- PostHog insight `Pf0TYWDY` ("Behavioral signal lift") uses
  `onboarding_completed` as a predictor, not as a gate. It was left as is.
