/**
 * Every Edge Function must declare its gateway auth in supabase/config.toml.
 *
 * deploy-edge-functions.yml runs `supabase functions deploy <fn>`, which
 * defaults a function with no `[functions.<fn>]` block to verify_jwt = true.
 * A function called by pg_cron with a shared secret, or by a third-party
 * webhook, then gets a gateway 401 (UNAUTHORIZED_INVALID_JWT_FORMAT) before
 * its own auth runs. That is how `reconciliation` stopped running on
 * 2026-11-09 22:49 UTC: Stripe payout reconciliation silently failed every
 * 15 minutes for 16 days.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const functionsDir = path.join(root, 'supabase/functions');

const functions = fs
  .readdirSync(functionsDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_'))
  .filter(d => fs.existsSync(path.join(functionsDir, d.name, 'index.ts')))
  .map(d => d.name);

function declaredVerifyJwt(fn: string): string | undefined {
  const escaped = fn.replace(/[-]/g, '\\-');
  const block = new RegExp(`^\\[functions\\.${escaped}\\]\\s*\\n([^\\[]*)`, 'm').exec(config);
  return block ? /^verify_jwt\s*=\s*(true|false)/m.exec(block[1])?.[1] : undefined;
}

describe('supabase/config.toml verify_jwt declarations', () => {
  it('finds the functions directory', () => {
    expect(functions.length).toBeGreaterThan(10);
  });

  it.each(functions)('%s declares verify_jwt explicitly', fn => {
    expect(declaredVerifyJwt(fn)).toMatch(/^(true|false)$/);
  });

  // Called without a Supabase JWT: pg_cron with a shared secret, or a
  // third-party webhook. Each authenticates inside the function.
  it.each([
    'reconciliation',
    'admin-withdrawals',
    'expire-bounty-requests',
    'identity-webhooks',
    'webhooks',
    'geocode-bounties',
    'moderation-sweep',
    'process-analytics-person',
    'email-inbound',
  ])('%s is reachable without a user JWT', fn => {
    expect(declaredVerifyJwt(fn)).toBe('false');
  });

  it('pg_cron callers of those functions do not send a JWT the gateway could check', () => {
    // If this ever changes (cron sends a real JWT), verify_jwt could be true.
    const migrations = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .map(f => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'))
      .join('\n');
    expect(migrations).toMatch(/reconciliation_cron_secret/);
  });
});
