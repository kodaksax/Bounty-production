const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Environment resolution order:
// 1) APP_ENV (primary source of truth for this app)
// 2) EXPO_PUBLIC_ENVIRONMENT (fallback for older tooling / Expo configs)
// 3) 'development' (default when neither is set)
// If both APP_ENV and EXPO_PUBLIC_ENVIRONMENT are defined, APP_ENV takes precedence.
const APP_ENV = process.env.APP_ENV || process.env.EXPO_PUBLIC_ENVIRONMENT || 'development';
const envFile = path.resolve(process.cwd(), `.env.${APP_ENV}`);

if (fs.existsSync(envFile)) {
  // override: true ensures this env file wins over any .env/.env.local already
  // loaded by Expo's built-in env loader before app.config.js runs.
  // quiet: true suppresses dotenv v17 stdout logging that would corrupt JSON
  // output when tools like expo-doctor or expo install --check parse stdout.
  dotenv.config({ path: envFile, override: true, quiet: true });
} else if (fs.existsSync(path.resolve(process.cwd(), '.env'))) {
  dotenv.config({ override: true, quiet: true });
}

// Detect likely secret-like env keys and warn at build-time if any are present.
// We intentionally only check variable NAMES (not values) and ignore EXPO_PUBLIC_* keys.
{
  const secretNamePattern = /SECRET|SERVICE_ROLE|PRIVATE_KEY|SERVICE_KEY|SERVICE_ACCOUNT|_TOKEN|_PASSWORD/i;
  const unsafe = Object.keys(process.env).filter(
    (k) => secretNamePattern.test(k) && !k.startsWith('EXPO_PUBLIC_')
  );
  if (unsafe.length > 0) {
    // Short, non-sensitive warning: list variable NAMES only
    console.warn(
      `[build-time warning] Detected ${unsafe.length} environment variable(s) that look like secrets and may be embedded into the app: ${unsafe.join(
        ', '
      )}. Use EAS secrets or remove them from the build environment to avoid baking sensitive keys.`
    );
  }
}

module.exports = ({ config }) => {
  return {
    ...config,
    // Ensure a scheme is always present at runtime so Linking works in
    // Expo Go / dev environments. Allow override via `EXPO_SCHEME` env var
    // or an existing `config.scheme` / `config.slug` / `config.name`.
    scheme: process.env.EXPO_SCHEME || config.scheme || config.slug || config.name || 'bountyexpo',
    android: {
      ...(config.android || {}),
      // Allow EAS file secret to provide google-services.json.
      // Create the secret with:
      //   eas secret:create --scope project --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ||
        (config.android && config.android.googleServicesFile) ||
        './google-services.json',
    },
    extra: {
      ...(config.extra || {}),
      APP_ENV,
      EXPO_PUBLIC_API_URL:
        process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_API_BASE_URL || (config.extra && config.extra.EXPO_PUBLIC_API_URL) || null,
      EXPO_PUBLIC_SUPABASE_URL:
        process.env.EXPO_PUBLIC_SUPABASE_URL || (config.extra && config.extra.EXPO_PUBLIC_SUPABASE_URL) || null,
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || (config.extra && config.extra.EXPO_PUBLIC_SUPABASE_ANON_KEY) || null,
      EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL:
        process.env.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL || (config.extra && config.extra.EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL) || null,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:
        process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || (config.extra && config.extra.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY) || null,
    },
  };
};
