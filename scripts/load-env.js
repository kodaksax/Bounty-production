const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv(serviceRoot) {
  // NODE_ENV/APP_ENV unset means we're about to fall back to the bare `.env`
  // file, not a specific environment. That file is intentionally scoped to
  // development-safe values (see the header comment in .env), but a script
  // running this way is NOT explicitly targeting any environment — surface
  // that loudly so nobody mistakes it for "the environment I meant to hit".
  if (!process.env.NODE_ENV && !process.env.APP_ENV) {
    console.warn(
      '[env] NODE_ENV/APP_ENV not set — falling back to the bare `.env` file ' +
      '(development-scoped by convention). Set NODE_ENV or APP_ENV explicitly ' +
      '(development/staging/production) to target a specific environment.'
    );
  }

  const envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env';

  // Try service-local env file first when provided
  if (serviceRoot) {
    const serviceEnv = path.resolve(serviceRoot, envName);
    if (fs.existsSync(serviceEnv)) {
      dotenv.config({ path: serviceEnv });
      console.log(`[env] Loaded environment from ${serviceEnv}`);
      return;
    }
  }

  // Try repo-root env file
  const rootEnv = path.resolve(process.cwd(), envName);
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
    console.log(`[env] Loaded environment from ${rootEnv}`);
    return;
  }

  // Final fallback: try plain .env at repo root
  const local = dotenv.config();
  if (local.error) {
    const rootPlain = path.resolve(process.cwd(), '.env');
    if (fs.existsSync(rootPlain)) {
      dotenv.config({ path: rootPlain });
      console.log(`[env] Loaded environment from ${rootPlain}`);
      return;
    }

    console.warn('[env] No .env found; continuing with existing environment');
  }
}

module.exports = { loadEnv };

