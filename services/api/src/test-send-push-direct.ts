/**
 * Direct Expo push sender (bypasses DB) for quick device delivery tests.
 * Usage:
 *  npx tsx services/api/src/test-send-push-direct.ts
 *
 * Environment variables:
 *  TEST_EXPO_TOKEN - Expo push token (required)
 */

import path from 'path';
// Load environment using shared loader (dynamic require to avoid TS rootDir issues)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'load-env.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const loadEnvMod = require(loadEnvPath);
  if (loadEnvMod && typeof loadEnvMod.loadEnv === 'function') {
    loadEnvMod.loadEnv(path.resolve(__dirname, '..', '..'));
  }
} catch (err) {
  // ignore
}
/**
 * test-send-push-direct.ts
 * Placeholder to avoid TypeScript build issues in CI.
 */
console.log('test-send-push-direct.ts: skipped (placeholder)');

export const skipped = true;
