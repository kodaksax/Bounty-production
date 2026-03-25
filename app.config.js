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
  dotenv.config({ path: envFile });
} else if (fs.existsSync(path.resolve(process.cwd(), '.env'))) {
  dotenv.config();
}

module.exports = ({ config }) => {
  return {
    ...config,
    extra: {
      APP_ENV,
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_API_BASE_URL || null,
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || null,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || null,
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    },
  };
};
