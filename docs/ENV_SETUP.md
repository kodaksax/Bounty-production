# Environment setup for Expo / EAS / Supabase / Stripe

This file shows the exact `eas` secret commands and verification steps for BOUNTYExpo.

1) Add secrets to EAS (example):

```bash
# Staging secrets
eas secret:create --name STAGING_SUPABASE_URL --value "https://your-staging-branch.supabase.co" --profile preview
eas secret:create --name STAGING_SUPABASE_ANON_KEY --value "pk.staging_example" --profile preview
eas secret:create --name STRIPE_TEST_PUBLISHABLE_KEY --value "pk_test_staging_example" --profile preview

# Production secrets
eas secret:create --name PRODUCTION_SUPABASE_URL --value "https://your-production.supabase.co" --profile production
eas secret:create --name PRODUCTION_SUPABASE_ANON_KEY --value "pk.prod_example" --profile production
eas secret:create --name STRIPE_LIVE_PUBLISHABLE_KEY --value "pk_live_example" --profile production
```

2) Verify `eas.json` profiles (this repo already contains `development`, `preview`, and `production` profiles).

3) Local development with Expo Go (no EAS build):

Install `cross-env` once:

```bash
npm install --save-dev cross-env
```

Start Expo with a chosen env (script added to `package.json`):

```bash
npm run start:dev     # loads .env.development
npm run start:staging # loads .env.staging
npm run start:prod    # loads .env.production
```

4) Verify values at runtime in the app:

```ts
import Constants from 'expo-constants';
console.log('env', Constants.expoConfig?.extra);
```

5) Notes & security:
- Only publishable keys and anon supabase keys belong on the client.
- Keep secret keys on your server (or use EAS secrets for build-time injection).
- If you need to change endpoints without rebuilding, consider a small server-side remote-config endpoint.
