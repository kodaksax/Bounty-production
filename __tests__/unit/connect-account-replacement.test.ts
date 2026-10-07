import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import {
  hasNonzeroStripeBalance,
  reserveAccountOperation,
  finishAccountOperation,
  isDefinitiveStripeRejection,
  isDefinitiveDatabaseRejection,
} from '../../supabase/functions/_shared/connect-account-operations';

const source = fs.readFileSync(path.join(__dirname, '../../supabase/functions/connect/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261006230000_connect_account_replacement.sql'), 'utf8');
const operations = require('../../supabase/functions/_shared/connect-account-operations');

function replacementHarness() {
  const profile = {
    id: 'user', stripe_connect_account_id: 'acct_old', balance: 123,
    stripe_connect_onboarded_at: '2026-01-01', account_status: 'active',
  };
  const replacement = {
    id: 'replacement', user_id: 'user', old_account_id: 'acct_old',
    candidate_account_id: null as string | null, country: 'US', email: 'test@example.com',
    manual_payouts: true, state: 'pending', created_at: new Date().toISOString(),
  };
  let saveFails = false;
  let operationActive = false;
  let walletRow: any = null;
  let handler: (request: Request) => Promise<Response>;
  const db: any = {
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'user' } } })) },
    from: jest.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      let patch: any;
      const result = () => {
        const row: any = table === 'profiles' ? profile
          : table === 'wallet_transactions' ? walletRow : replacement;
        if (!row) return { data: null, error: null };
        if (filters.some(([key, value]) => row[key] !== value)) return { data: null, error: null };
        if (patch && saveFails) return { data: null, error: { message: 'database unavailable' } };
        if (patch) Object.assign(row, patch);
        return { data: { ...row }, error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        update: (value: unknown) => { patch = value; return query; },
        insert: (value: unknown) => { walletRow = { id: 'withdrawal', ...(value as any) }; patch = value; return query; },
        maybeSingle: async () => result(),
        limit: () => query, order: () => query, gte: () => query, in: () => query,
        single: async () => result(),
        then: (resolve: any) => Promise.resolve(result()).then(resolve),
      };
      return query;
    }),
    rpc: jest.fn(async (name: string, args: any) => {
      if (name === 'reserve_connect_account_operation') {
        if (operationActive || replacement.state === 'pending' || profile.stripe_connect_account_id !== args.p_account_id) {
          return { data: null, error: { message: 'busy or stale' } };
        }
        operationActive = true;
        return { data: 'operation', error: null };
      }
      if (name === 'finish_connect_account_operation') {
        operationActive = false;
        return { data: null, error: null };
      }
      if (name === 'complete_connect_account_replacement') {
        if (replacement.state !== 'pending' || profile.stripe_connect_account_id !== replacement.old_account_id) {
          return { error: { message: 'canceled or stale' } };
        }
        profile.stripe_connect_account_id = args.p_candidate_account_id;
        replacement.state = 'completed';
      }
      return { data: replacement, error: null };
    }),
  };
  const stripe: any = {
    accounts: {
      retrieve: jest.fn(async (id: string) => ({
        id, type: 'express', country: 'US', payouts_enabled: true,
        metadata: { user_id: 'user', replacement_id: replacement.id },
      })),
      create: jest.fn(async () => ({ id: 'acct_new' })),
    },
    balance: { retrieve: jest.fn(async () => ({ available: [{ amount: 0, currency: 'usd' }], pending: [] })) },
    payouts: {
      list: jest.fn(() => (async function* () {})()),
      create: jest.fn(async () => ({ id: 'po_native', status: 'pending', arrival_date: 123 })),
    },
    accountLinks: { create: jest.fn(async () => ({ url: 'https://connect.stripe.com/setup' })) },
  };
  class StripeMock {
    static createFetchHttpClient() { return {}; }
    constructor() { return stripe; }
  }
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports: {},
    require: (specifier: string) => {
      if (specifier.includes('supabase-js')) return { createClient: () => db };
      if (specifier === 'npm:stripe@14') return { default: StripeMock };
      if (specifier.includes('connect-account-operations')) return operations;
      if (specifier.includes('payout-audit')) return { writePayoutAudit: jest.fn() };
      if (specifier.includes('payout-state')) return require('../../supabase/functions/_shared/payout-state');
      return {};
    },
    Deno: {
      serve: (callback: typeof handler) => { handler = callback; },
      env: { get: (key: string) => key === 'APP_URL' ? 'https://bountyfinder.app'
        : key === 'CONNECT_NATIVE_PAYOUTS' ? 'true' : 'test-config' },
    },
    crypto: { randomUUID: () => 'request' },
    Request, Response, URL, Date, console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  });
  return {
    db, stripe, profile, replacement,
    failSave: (value: boolean) => { saveFails = value; },
    request: (body: unknown = { replacementId: replacement.id }, token = 'test-session', route = 'replace-account') =>
      handler(new Request('https://test.example/connect/' + route, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })),
  };
}

describe('replacement account safety', () => {
  test.each([
    { available: [{ amount: 1, currency: 'eur' }], pending: [] },
    { available: [], pending: [{ amount: -1, currency: 'usd' }] },
    { available: [{ amount: 0, source_types: { card: 1, bank_account: -1 } }], pending: [] },
    { available: [], pending: [], connect_reserved: [{ amount: -10 }] },
    { available: [], pending: [], instant_available: [{ amount: 0, net_available: [{ amount: 2 }] }] },
    { available: [], pending: [], issuing: { available: [{ amount: 4 }] } },
    null,
    { pending: [] },
    { available: [{}], pending: [] },
  ])('rejects nonzero or malformed balance %p', value => {
    expect(hasNonzeroStripeBalance(value)).toBe(true);
  });

  test('accepts a drained multi-currency account', () => {
    expect(hasNonzeroStripeBalance({
      available: [{ amount: 0, currency: 'usd', source_types: { card: 0 } }, { amount: 0, currency: 'eur' }],
      pending: [], connect_reserved: [{ amount: 0 }],
    })).toBe(false);
  });

  test('creates a NEW Express account with per-replacement Stripe idempotency and server-owned links', async () => {
    const h = replacementHarness();
    const response = await h.request();
    expect(response.status).toBe(200);
    expect(h.stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'express', country: 'US', metadata: { user_id: 'user', replacement_id: 'replacement' } }),
      { idempotencyKey: 'connect_replacement_replacement' }
    );
    expect(h.db.rpc).toHaveBeenCalledWith('complete_connect_account_replacement', {
      p_user_id: 'user', p_replacement_id: 'replacement', p_candidate_account_id: 'acct_new',
    });
    expect(h.profile.balance).toBe(123);
    expect(h.stripe.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({
      account: 'acct_new', return_url: 'https://bountyfinder.app/wallet/connect/return',
    }));
  });

  test('blocks pending payouts on later pages without creating or swapping accounts', async () => {
    const h = replacementHarness();
    h.stripe.payouts.list.mockImplementation(() => (async function* () {
      yield { status: 'paid' }; yield { status: 'in_transit' };
    })());
    expect((await h.request()).status).toBe(409);
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
    expect(h.profile.stripe_connect_account_id).toBe('acct_old');
  });

  test('fails closed on Stripe balance failure', async () => {
    const h = replacementHarness();
    h.stripe.balance.retrieve.mockRejectedValue(new Error('provider unavailable'));
    expect((await h.request()).status).toBe(500);
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
    expect(h.profile.stripe_connect_account_id).toBe('acct_old');
  });

  test('a database failure retains the old account; retry reuses identical create parameters/key', async () => {
    const h = replacementHarness();
    h.failSave(true);
    expect((await h.request()).status).toBe(503);
    expect(h.profile.stripe_connect_account_id).toBe('acct_old');
    h.failSave(false);
    expect((await h.request()).status).toBe(200);
    expect(h.stripe.accounts.create.mock.calls[0]).toEqual(h.stripe.accounts.create.mock.calls[1]);
  });

  test('lost successful response resumes the candidate, not another account', async () => {
    const h = replacementHarness();
    expect((await h.request()).status).toBe(200);
    expect((await h.request()).status).toBe(200);
    expect(h.stripe.accounts.create).toHaveBeenCalledTimes(1);
  });

  test('cancellation during Stripe creation cannot swap the profile', async () => {
    const h = replacementHarness();
    h.stripe.accounts.create.mockImplementation(async () => {
      h.replacement.state = 'canceled';
      return { id: 'acct_new' };
    });
    expect((await h.request()).status).toBe(409);
    expect(h.profile.stripe_connect_account_id).toBe('acct_old');
    expect(h.replacement.candidate_account_id).toBe('acct_new');
    expect(h.stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  test('stale active identity cannot issue onboarding to an old candidate', async () => {
    const h = replacementHarness();
    h.replacement.state = 'completed';
    h.replacement.candidate_account_id = 'acct_new';
    h.profile.stripe_connect_account_id = 'acct_other';
    expect((await h.request()).status).toBe(409);
    expect(h.stripe.accountLinks.create).not.toHaveBeenCalled();
  });

  test('expired unknown create attempts cannot replay a pruned Stripe key', async () => {
    const h = replacementHarness();
    h.replacement.created_at = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    expect((await h.request()).status).toBe(409);
    expect(h.stripe.accounts.create).not.toHaveBeenCalled();
  });

  test('native payout cannot use a stale account read after a concurrent replacement', async () => {
    const h = replacementHarness();
    h.replacement.state = 'completed';
    h.stripe.balance.retrieve.mockImplementation(async () => {
      h.profile.stripe_connect_account_id = 'acct_new';
      return { available: [{ amount: 1000, currency: 'usd' }], pending: [] };
    });
    expect((await h.request({ amount: 10 }, 'test-session', 'payout')).status).toBe(409);
    expect(h.stripe.payouts.create).not.toHaveBeenCalled();
    expect(h.profile.balance).toBe(123);
  });

  test('a concurrent pending replacement blocks native money movement', async () => {
    const h = replacementHarness();
    h.stripe.balance.retrieve.mockResolvedValue({ available: [{ amount: 1000, currency: 'usd' }], pending: [] });
    expect((await h.request({ amount: 10 }, 'test-session', 'payout')).status).toBe(409);
    expect(h.stripe.payouts.create).not.toHaveBeenCalled();
  });

  test('uncertain native Stripe outcome retains its durable gate and blocks a second payout', async () => {
    const h = replacementHarness();
    h.replacement.state = 'completed';
    h.stripe.balance.retrieve.mockResolvedValue({ available: [{ amount: 1000, currency: 'usd' }], pending: [] });
    h.stripe.payouts.create.mockRejectedValue({ type: 'StripeConnectionError' });
    expect((await h.request({ amount: 10 }, 'test-session', 'payout')).status).toBe(503);
    expect(h.db.rpc).not.toHaveBeenCalledWith('finish_connect_account_operation', expect.anything());
    expect((await h.request({ amount: 10 }, 'test-session', 'payout')).status).toBe(409);
    expect(h.stripe.payouts.create).toHaveBeenCalledTimes(1);
    expect(h.profile.balance).toBe(123);
  });

  test('native payout history failure retains its durable gate', async () => {
    const h = replacementHarness();
    h.replacement.state = 'completed';
    h.stripe.balance.retrieve.mockResolvedValue({ available: [{ amount: 1000, currency: 'usd' }], pending: [] });
    h.failSave(true);
    const response = await h.request({ amount: 10 }, 'test-session', 'payout');
    expect(response.status).toBe(200);
    expect((await response.json()).warning).toContain('support');
    expect(h.db.rpc).not.toHaveBeenCalledWith('finish_connect_account_operation', expect.anything());
  });

  test('normal native success finishes only after persisting history and never touches legacy balance', async () => {
    const h = replacementHarness();
    h.replacement.state = 'completed';
    h.stripe.balance.retrieve.mockResolvedValue({ available: [{ amount: 1000, currency: 'usd' }], pending: [] });
    expect((await h.request({ amount: 10 }, 'test-session', 'payout')).status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('finish_connect_account_operation', { p_operation_id: 'operation' });
    expect(h.profile.balance).toBe(123);
  });
});

describe('durable reservation and migration contracts', () => {
  test('reservations pass the expected active identity to the database and fail closed', async () => {
    const db: any = { rpc: jest.fn(async () => ({ data: null, error: { message: 'busy or stale' } })) };
    await expect(reserveAccountOperation(db, 'user', 'acct_old', 'native_payout', 'attempt'))
      .rejects.toThrow(/reconciliation/);
    expect(db.rpc).toHaveBeenCalledWith('reserve_connect_account_operation', {
      p_user_id: 'user', p_account_id: 'acct_old', p_kind: 'native_payout', p_operation_key: 'attempt',
    });
    db.rpc.mockResolvedValue({ error: { message: 'database unavailable' } });
    await expect(finishAccountOperation(db, 'operation')).rejects.toThrow(/support/);
  });

  test('network/API/idempotency errors are uncertain, not definitive rejections', () => {
    for (const type of ['StripeConnectionError', 'StripeAPIError', 'StripeIdempotencyError', undefined]) {
      expect(isDefinitiveStripeRejection({ type })).toBe(false);
    }
    expect(isDefinitiveStripeRejection({ type: 'StripeInvalidRequestError' })).toBe(true);
    expect(isDefinitiveDatabaseRejection({ code: '23505' })).toBe(true);
    expect(isDefinitiveDatabaseRejection({ code: 'P0001' })).toBe(true);
    expect(isDefinitiveDatabaseRejection({ code: '08006' })).toBe(false);
    expect(isDefinitiveDatabaseRejection({ message: 'network failure' })).toBe(false);
  });

  test('profile lock, active-operation uniqueness and client isolation are present; no expiry unlocks', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("WHERE state = 'active'");
    expect(migration).toContain('v_account IS DISTINCT FROM p_account_id');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).not.toMatch(/DELETE FROM (?:public\.)?(?:wallet_transactions|reconciliation_findings)/i);
    expect(migration).not.toMatch(/UPDATE (?:public\.)?(?:wallet_transactions|reconciliation_findings)/i);
    expect(migration).not.toMatch(/state\s*=\s*'finished'.*(?:interval|created_at)/i);
    for (const field of ['stripe_connect_onboarded_at = NULL', 'stripe_connect_payouts_enabled = false',
      'stripe_connect_charges_enabled = false', 'stripe_connect_onboarding_complete = false',
      'stripe_connect_requirements = NULL', 'payout_failed_at = NULL']) expect(migration).toContain(field);
  });

  test('every financial path reserves before moving money and stale retries retain their original identity', () => {
    const nativeStart = source.indexOf('async function handleConnectNativePayout');
    const nativeEnd = source.indexOf('interface InstantCardSummary', nativeStart);
    const native = source.slice(nativeStart, nativeEnd > nativeStart ? nativeEnd : source.indexOf('Deno.serve', nativeStart));
    expect(native.indexOf('reserveAccountOperation(')).toBeLessThan(native.indexOf('stripe.payouts.create('));
    for (const start of ['/transfer', '/retry-transfer']) {
      const startIndex = source.indexOf(`if (subPath === '${start}')`);
      const block = source.slice(startIndex, source.indexOf(`if (req.method === 'GET' && isPayoutsPath)`, startIndex));
      expect(block.indexOf('reserveAccountOperation(')).toBeLessThan(block.indexOf('transfer = await stripe.transfers.create('));
    }
    const releases = fs.readFileSync(path.join(__dirname, '../../supabase/functions/bounty-payments/index.ts'), 'utf8');
    expect(releases.indexOf("'bounty_release_v3'")).toBeLessThan(releases.indexOf('stripe.paymentIntents.capture(', releases.indexOf("'bounty_release_v3'")));
    expect(releases.indexOf("'bounty_release_v2'")).toBeLessThan(releases.indexOf('transfer = await stripe.transfers.create('));
    const admin = fs.readFileSync(path.join(__dirname, '../../supabase/functions/admin-withdrawals/index.ts'), 'utf8');
    expect(admin.indexOf("'admin_retry'")).toBeLessThan(admin.indexOf("rpc('retry_failed_withdrawal'"));
    expect(admin).toContain('stripe_connect_account_id !== p.stripe_connect_account_id');
    expect(source).toContain('stripe_connect_account_id !== p.stripe_connect_account_id');
  });

  test('webhook writes use account CAS and old payouts resolve exact historical identities', () => {
    const webhooks = fs.readFileSync(path.join(__dirname, '../../supabase/functions/webhooks/index.ts'), 'utf8');
    expect(webhooks).toContain(".eq('id', userId).eq('stripe_connect_account_id', account.id).select('id').maybeSingle()");
    expect(webhooks).toContain('if (!updatedProfile) return;');
    expect(webhooks).toContain(".eq('type', 'withdrawal').eq('stripe_payout_id', payout.id)");
    expect(webhooks).toContain(".eq('stripe_connect_account_id', accountId).maybeSingle()");
  });

  test('replacement browser is ephemeral and nonopening results are retryable without optimistic proof', () => {
    const onboarding = fs.readFileSync(path.join(__dirname, '../../app/wallet/connect/embedded-onboarding.tsx'), 'utf8');
    expect(onboarding).toContain('preferEphemeralSession: !!replacementId');
    expect(onboarding).toContain("result.type === 'locked' || result.type === 'opened'");
    expect(onboarding).toContain('if (!replacementId) await supabase');
    expect(onboarding).toContain("replacementId ? 'replace-account' : 'create-account-link'");
  });
});
