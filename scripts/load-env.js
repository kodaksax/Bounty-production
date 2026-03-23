const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv(serviceRoot) {
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

