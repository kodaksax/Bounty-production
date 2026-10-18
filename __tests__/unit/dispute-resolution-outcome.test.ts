/**
 * Regression tests for the 2026-10-12 admin audit: a dispute resolution must
 * report what happened to the money, not just that the dispute row changed.
 *
 * Production evidence: dispute #19 is `resolved_hunter_wins` with only the
 * escrow debit on the ledger (no release), while the admin screen said
 * "Funds released to hunter." For Phase 2 (Stripe) bounties the payment
 * service rejects every admin release/cancel with 403 not_poster, and that
 * failure was swallowed in the same way.
 */
const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'admin-user-id', app_metadata: { role: 'admin' } } } },
      }),
    },
  },
}));

jest.mock('../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), warning: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../lib/services/bounty-service', () => ({ bountyService: { getById: jest.fn() } }));
jest.mock('../../lib/services/cancellation-service', () => ({
  cancellationService: { getCancellationById: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../../lib/services/payment-service', () => ({
  paymentService: { releaseEscrow: jest.fn(), refundEscrow: jest.fn() },
}));
jest.mock('../../lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { releaseBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));

import { disputeService } from '../../lib/services/dispute-service';

const { bountyService } = require('../../lib/services/bounty-service');
const { bountyPaymentsService } = require('../../lib/services/bounty-payments-service');

const WALLET_BOUNTY = { id: 'b-1', user_id: 'poster-1', title: 'Fix fence', amount: 40, accepted_by: 'hunter-1' };
const STRIPE_BOUNTY = { ...WALLET_BOUNTY, payment_architecture_version: 2 };

/** bounty_disputes select/update + dispute_audit_log insert, capturing writes. */
function mockTables(dispute: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bounty_disputes') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: dispute, error: null }),
          }),
        }),
        update: jest.fn().mockImplementation((patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: jest.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }
    if (table === 'dispute_audit_log') {
      return {
        insert: jest.fn().mockImplementation((row: Record<string, unknown>) => {
          auditRows.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }
    return { insert: jest.fn().mockResolvedValue({ error: null }) };
  });
  return { updates, auditRows };
}

const OPEN_DISPUTE = { id: 19, bounty_id: 'b-1', initiator_id: 'poster-1', reason: 'x', status: 'under_review' };

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe('resolveDisputeWithOutcome', () => {
  it('reports an uncertain settlement when the wallet release RPC errors', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_release_wallet_escrow_for_dispute'
          ? { data: null, error: { message: 'release failed' } }
          : { data: null, error: null }
      )
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.resolved).toBe(true);
    expect(outcome.settlement.status).toBe('unknown');
    expect(outcome.settlement.detail).toMatch(/do not retry/i);
  });

  it('explains the Phase 2 admin limitation instead of claiming funds were released', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(STRIPE_BOUNTY);
    const err = Object.assign(new Error('Only the poster can release funds.'), { code: 'not_poster', httpStatus: 403 });
    bountyPaymentsService.releaseBountyPayment.mockRejectedValue(err);

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.resolved).toBe(true);
    expect(outcome.settlement.status).toBe('failed');
    expect(outcome.settlement.detail).toMatch(/only lets the poster/);
  });

  it('reports released when the wallet RPC applied the release', async () => {
    const { auditRows } = mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_release_wallet_escrow_for_dispute'
          ? { data: [{ applied: true, transaction_id: 'tx-1', release_amount: 40 }], error: null }
          : { data: null, error: null }
      )
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome).toEqual({ resolved: true, settlement: { status: 'released' } });
    expect(auditRows).toContainEqual(
      expect.objectContaining({
        action: 'resolved',
        actor_id: 'admin-user-id',
        details: expect.objectContaining({ winner: 'hunter', settlement: 'released' }),
      })
    );
  });

  it('reports already_settled when the RPC no-ops against an existing release/refund', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_refund_wallet_escrow_for_dispute'
          ? { data: [{ applied: false, transaction_id: 'tx-old', refund_amount: null }], error: null }
          : { data: null, error: null }
      )
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Refund', 'poster');

    expect(outcome.settlement.status).toBe('already_settled');
  });

  it('reports an unconfirmed Stripe transfer as pending instead of released', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(STRIPE_BOUNTY);
    bountyPaymentsService.releaseBountyPayment.mockResolvedValue({
      released: false,
      transferId: 'tr-pending',
      status: 'release_pending',
    });

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.settlement.status).toBe('pending_confirmation');
    expect(mockRpc).not.toHaveBeenCalledWith(
      'send_system_notification',
      expect.objectContaining({ p_body: expect.stringContaining('Funds released') })
    );
  });

  it('recognizes a repeated release request already waiting for Stripe confirmation', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(STRIPE_BOUNTY);
    bountyPaymentsService.releaseBountyPayment.mockRejectedValue(
      Object.assign(
        new Error('Transfer requested. Waiting for Stripe confirmation.'),
        { code: 'release_pending' }
      )
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.settlement.status).toBe('pending_confirmation');
  });

  it('reports a reused confirmed Stripe release as already settled', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(STRIPE_BOUNTY);
    bountyPaymentsService.releaseBountyPayment.mockResolvedValue({
      released: true,
      transferId: 'tr-confirmed',
      status: 'released',
      reused: true,
    });

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.settlement.status).toBe('already_settled');
  });

  it('directs uncertain Stripe errors to reconciliation rather than retry', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(STRIPE_BOUNTY);
    bountyPaymentsService.releaseBountyPayment.mockRejectedValue(
      Object.assign(new Error('Stripe transfer record update failed'), { code: 'record_update_failed' })
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.settlement.status).toBe('unknown');
    expect(outcome.settlement.detail).toMatch(/reconciliation; do not retry/i);
    expect(outcome.settlement.detail).not.toMatch(/No money moved/i);
  });

  it('does not resolve or settle when the bounty/payment lookup fails', async () => {
    const { updates } = mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(null);

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Hunter did the work', 'hunter');

    expect(outcome.resolved).toBe(false);
    expect(outcome.settlement.status).toBe('failed');
    expect(outcome.settlement.detail).toMatch(/Failed to load the bounty/i);
    expect(updates).toHaveLength(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('reports nothing_held when there is no escrow row to move', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_refund_wallet_escrow_for_dispute'
          ? { data: [{ applied: false, transaction_id: null, refund_amount: null }], error: null }
          : { data: null, error: null }
      )
    );

    const outcome = await disputeService.resolveDisputeWithOutcome('19', 'Refund', 'poster');

    expect(outcome.settlement.status).toBe('nothing_held');
  });

  it('keeps resolveDispute() returning true for existing callers', async () => {
    mockTables(OPEN_DISPUTE);
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_release_wallet_escrow_for_dispute'
          ? { data: null, error: { message: 'release failed' } }
          : { data: null, error: null }
      )
    );

    await expect(disputeService.resolveDispute('19', 'x', 'hunter')).resolves.toBe(true);
  });
});

describe('retryDisputeSettlement', () => {
  it('settles a resolved dispute whose money never moved (the dispute #19 shape)', async () => {
    const { auditRows } = mockTables({ ...OPEN_DISPUTE, status: 'resolved_hunter_wins', winner: 'hunter' });
    bountyService.getById.mockResolvedValue(WALLET_BOUNTY);
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'fn_release_wallet_escrow_for_dispute'
          ? { data: [{ applied: true, transaction_id: 'tx-2', release_amount: 40 }], error: null }
          : { data: null, error: null }
      )
    );

    const settlement = await disputeService.retryDisputeSettlement('19');

    expect(settlement.status).toBe('released');
    expect(mockRpc).toHaveBeenCalledWith('fn_release_wallet_escrow_for_dispute', { p_dispute_id: 19 });
    expect(auditRows).toContainEqual(expect.objectContaining({ action: 'settlement_retried' }));
  });

  it('refuses a dispute that is not resolved for a winner, without touching money', async () => {
    mockTables({ ...OPEN_DISPUTE, status: 'under_review', winner: null });

    const settlement = await disputeService.retryDisputeSettlement('19');

    expect(settlement.status).toBe('failed');
    expect(mockRpc).not.toHaveBeenCalledWith('fn_release_wallet_escrow_for_dispute', expect.anything());
    expect(mockRpc).not.toHaveBeenCalledWith('fn_refund_wallet_escrow_for_dispute', expect.anything());
  });

  it('does not treat a failed bounty lookup as an honor bounty during retry', async () => {
    mockTables({ ...OPEN_DISPUTE, status: 'resolved_hunter_wins', winner: 'hunter' });
    bountyService.getById.mockResolvedValue(null);

    const settlement = await disputeService.retryDisputeSettlement('19');

    expect(settlement.status).toBe('failed');
    expect(settlement.detail).toMatch(/Failed to load the bounty/i);
    expect(mockRpc).not.toHaveBeenCalledWith('fn_release_wallet_escrow_for_dispute', expect.anything());
  });
});

describe('escalateDispute', () => {
  it('does not write the nonexistent escalated_at column', async () => {
    const { updates } = mockTables(OPEN_DISPUTE);

    await disputeService.escalateDispute('19', 'manual');

    expect(updates[0]).toEqual(expect.objectContaining({ escalated: true }));
    expect(updates[0]).not.toHaveProperty('escalated_at');
  });
});
