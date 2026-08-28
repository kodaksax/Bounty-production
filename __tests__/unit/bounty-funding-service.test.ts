// Unit tests for lib/services/bounty-funding-service — the client's only
// window onto deferred ("post first, pay at accept") bounty funding.
//
// The security-critical behaviour these lock down:
//   * every amount comes from the server, never from a caller-supplied prop;
//   * a READ failure degrades to "no funding required" (so an already-escrowed
//     legacy bounty stays acceptable) and never to "funding satisfied" for an
//     unfunded one — the DB trigger is what actually enforces that;
//   * failures are bucketed into a closed set of reasons, so no raw DB message
//     (which interpolates amounts and ids) can leak into analytics.

describe('bounty-funding-service (unit)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadWith(rpc: jest.Mock, isConfigured = true) {
    jest.doMock('../../lib/supabase', () => ({
      isSupabaseConfigured: isConfigured,
      supabase: { rpc },
    }));
    jest.doMock('../../lib/utils/error-logger', () => ({
      logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
    }));
    return require('../../lib/services/bounty-funding-service');
  }

  const DEFERRED_ROW = {
    bounty_id: 'b1',
    funding_mode: 'at_accept',
    requires_funding: true,
    amount_required: 50,
    already_funded: false,
    poster_balance: 20,
    shortfall: 30,
  };

  describe('getBountyFundingRequirement', () => {
    test('returns the server amounts for an unfunded deferred bounty', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: [DEFERRED_ROW], error: null });
      const svc = loadWith(rpc);

      const req = await svc.getBountyFundingRequirement('b1');

      expect(rpc).toHaveBeenCalledWith('fn_get_bounty_funding_requirement', { p_bounty_id: 'b1' });
      expect(req).toMatchObject({
        bountyId: 'b1',
        fundingMode: 'at_accept',
        requiresFunding: true,
        amountRequired: 50,
        alreadyFunded: false,
        posterBalance: 20,
        shortfall: 30,
      });
    });

    test('recomputes shortfall rather than trusting the row', async () => {
      // A server row whose shortfall disagrees with its own amount/balance must
      // not be able to under-report what the poster still owes.
      const rpc = jest.fn().mockResolvedValue({
        data: [{ ...DEFERRED_ROW, shortfall: 0 }],
        error: null,
      });
      const svc = loadWith(rpc);

      const req = await svc.getBountyFundingRequirement('b1');
      expect(req.shortfall).toBe(30);
    });

    test('reports no funding required for an already-escrowed legacy bounty', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            bounty_id: 'b2',
            funding_mode: 'at_post',
            requires_funding: false,
            amount_required: 0,
            already_funded: true,
            poster_balance: 0,
            shortfall: 0,
          },
        ],
        error: null,
      });
      const svc = loadWith(rpc);

      const req = await svc.getBountyFundingRequirement('b2');
      expect(req.requiresFunding).toBe(false);
      expect(req.amountRequired).toBe(0);
    });

    test('degrades to "no funding required" when the RPC is not deployed', async () => {
      const rpc = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function' },
      });
      const svc = loadWith(rpc);

      const req = await svc.getBountyFundingRequirement('b3');
      // Pre-migration environments must keep accepting legacy bounties.
      expect(req.requiresFunding).toBe(false);
      expect(req.fundingMode).toBe('at_post');
    });

    test('degrades safely when the RPC throws', async () => {
      const rpc = jest.fn().mockRejectedValue(new Error('network down'));
      const svc = loadWith(rpc);

      await expect(svc.getBountyFundingRequirement('b4')).resolves.toMatchObject({
        requiresFunding: false,
      });
    });

    test('does not call Supabase at all when it is unconfigured', async () => {
      const rpc = jest.fn();
      const svc = loadWith(rpc, false);

      await svc.getBountyFundingRequirement('b5');
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe('canDeferBountyFunding', () => {
    test('is true only when the server explicitly returns true', async () => {
      const rpc = jest.fn().mockResolvedValue({ data: true, error: null });
      const svc = loadWith(rpc);

      await expect(svc.canDeferBountyFunding(50)).resolves.toBe(true);
      expect(rpc).toHaveBeenCalledWith('fn_can_i_defer_bounty_funding', { p_amount: 50 });
    });

    test.each([
      ['a falsy server answer', { data: false, error: null }],
      ['a non-boolean server answer', { data: 'yes', error: null }],
      ['an RPC error', { data: null, error: { message: 'boom' } }],
    ])('is false for %s', async (_label, resolved) => {
      const svc = loadWith(jest.fn().mockResolvedValue(resolved));
      await expect(svc.canDeferBountyFunding(50)).resolves.toBe(false);
    });

    test('never asks for a zero or negative amount', async () => {
      const rpc = jest.fn();
      const svc = loadWith(rpc);

      await expect(svc.canDeferBountyFunding(0)).resolves.toBe(false);
      await expect(svc.canDeferBountyFunding(-10)).resolves.toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe('classifyAcceptFundingError', () => {
    const svc = () => loadWith(jest.fn());

    test.each([
      ['insufficient_funds_for_escrow', 'insufficient_funds'],
      ['Insufficient funds: new balance would be -30', 'insufficient_funds'],
      // The DB guard firing means an acceptance path skipped escrow. That is
      // NOT a balance problem, so it must not be folded into
      // 'insufficient_funds' — a poster with plenty of money was being shown an
      // "add funds" screen because of it.
      ['bounty_not_funded', 'not_funded'],
      ['bounty_amount_locked_by_applications', 'terms_locked'],
      ['bounty_honor_flag_locked_by_escrow', 'terms_locked'],
      ['bounty_funding_mode_is_immutable', 'terms_locked'],
      ['request_not_pending', 'state_conflict'],
      ['bounty_not_open', 'state_conflict'],
      ['Only the bounty poster can accept a request', 'not_authorized'],
      ['Your account has been suspended', 'account_inactive'],
      ['something else entirely', 'unknown'],
    ])('%s -> %s', (message, expected) => {
      expect(svc().classifyAcceptFundingError(new Error(message))).toBe(expected);
    });

    test('reads the message out of a wrapped PostgrestError', () => {
      const err: any = new Error('generic');
      err.rpc = { message: 'insufficient_funds_for_escrow' };
      // The outer message wins when it is itself meaningful; here it is not,
      // so the nested rpc error must still be found.
      const wrapped: any = { rpc: { message: 'insufficient_funds_for_escrow' } };
      expect(svc().classifyAcceptFundingError(wrapped)).toBe('insufficient_funds');
    });

    test('is "unknown" rather than throwing for empty input', () => {
      expect(svc().classifyAcceptFundingError(null)).toBe('unknown');
      expect(svc().classifyAcceptFundingError(undefined)).toBe('unknown');
    });
  });

  describe('describeAcceptFundingFailure', () => {
    test('every reason states that the bounty was NOT funded and nobody was assigned', () => {
      const svc = loadWith(jest.fn());
      // The single most important property of this copy: a poster must never
      // be left believing a hunter is now working on an unpaid job.
      for (const reason of ['insufficient_funds', 'not_funded', 'network', 'unknown'] as const) {
        const { title, message } = svc.describeAcceptFundingFailure(reason);
        expect(title).toBeTruthy();
        expect(message.toLowerCase()).toMatch(/not been funded|hasn't been funded/);
      }
    });

    test('returns copy for every known reason', () => {
      const svc = loadWith(jest.fn());
      const reasons = [
        'insufficient_funds',
        'not_funded',
        'state_conflict',
        'terms_locked',
        'not_authorized',
        'account_inactive',
        'network',
        'unknown',
      ] as const;
      for (const r of reasons) {
        expect(svc.describeAcceptFundingFailure(r).message.length).toBeGreaterThan(10);
      }
    });
  });

  describe('amountBucket', () => {
    test.each([
      [0, 'none'],
      [-5, 'none'],
      [10, 'lt_25'],
      [24.99, 'lt_25'],
      [25, '25_49'],
      [50, '50_99'],
      [100, '100_249'],
      [250, 'gte_250'],
      [5000, 'gte_250'],
    ])('%s -> %s', (amount, bucket) => {
      expect(loadWith(jest.fn()).amountBucket(amount)).toBe(bucket);
    });

    test('never returns the exact amount', () => {
      const svc = loadWith(jest.fn());
      for (const amount of [7, 33, 91, 187, 4212]) {
        expect(svc.amountBucket(amount)).not.toContain(String(amount));
      }
    });
  });
});
