# Marketing attribution links

All public app CTAs must point to the `app-link` Edge Function through this public route:

```text
https://bountyfinder.net/r/<source>/<campaign>
```

Configure the `bountyfinder.net` reverse proxy so `/r/*` maps to:

```text
https://<supabase-project>.supabase.co/functions/v1/app-link/*
```

The medium defaults to `guerilla`. Use lowercase, short campaign slugs:

```text
bountyfinder.net/r/reddit/orangecounty
bountyfinder.net/r/facebook/mission-viejo
bountyfinder.net/r/nextdoor/mission-viejo
bountyfinder.net/r/craigslist/orange-county
```

The handoff logs `app_store_redirect_clicked`, creates a Branch link, opens the app when installed, and otherwise preserves the source and campaign through the store install. Do not link directly to App Store or Play Store URLs from the public site.

If `BRANCH_KEY` is unset, or Branch link creation fails, `app-link` still logs the click (with `link_provider: 'store_fallback'`) and redirects by user agent: iOS to the App Store, Android to the Play Store (UTMs passed as the install `referrer`), anything else to `PUBLIC_MARKETING_ORIGIN`. This fallback loses deferred deep linking and install-level attribution; the click event remains.

`app-link` is called anonymously, so `supabase/config.toml` sets `verify_jwt = false` for it.

## Required deployment configuration

- EAS: `EXPO_PUBLIC_BRANCH_KEY`, `EXPO_PUBLIC_BRANCH_DOMAIN`
- Supabase Edge Functions: `POSTHOG_PROJECT_API_KEY`
- Optional Edge Function values: `BRANCH_KEY` (store fallback without it), `POSTHOG_HOST`, `PUBLIC_MARKETING_ORIGIN`

Deploy `app-link`, `marketing-attribute`, and `process-analytics-person`, then apply migration `20260808000000_add_posthog_person_property_sync.sql`. A new native EAS build is required because Branch includes native code; an OTA update is not sufficient.
