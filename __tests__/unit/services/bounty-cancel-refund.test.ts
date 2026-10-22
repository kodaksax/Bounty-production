/**
 * SBA-10 (4): "Cancel and refund" on the bounty screen and the Inbox row's
 * trash icon share one refund-then-delete path. It adds no refund logic: the
 * endpoints it calls (/wallet/refund, /bounty-payments/cancel) own the
 * owner-refund / acceptance race fix (#883, fn_claim_owner_refund).
 */
const mockGetFunding = jest.fn();
const mockCancelPayment = jest.fn();
const mockHoldState = jest.fn();
const mockDelete = jest.fn();
const mockTrack = jest.fn();

jest.mock('../../../lib/services/bounty-funding-service', () => ({
  getBountyFundingRequirement: (...a: unknown[]) => mockGetFunding(...a),
}));
jest.mock('../../../lib/services/bounty-payments-service', () => {
  class BountyPaymentError extends Error {
    constructor(message: string, public httpStatus: number, public code?: string) {
      super(message);
    }
  }
  return {
    BountyPaymentError,
    bountyPaymentsService: {
      cancelBountyPayment: (...a: unknown[]) => mockCancelPayment(...a),
      getBountyPaymentHoldState: (...a: unknown[]) => mockHoldState(...a),
    },
  };
});
jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: { delete: (...a: unknown[]) => mockDelete(...a) },
}));
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrack(...a) },
}));

import {
  BountyRefundFailedError,
  canPosterCancelBounty,
  cancelAndRefundBounty,
  describeCancelRefund,
  describeCancelRefundDone,
  planCancelRefund,
} from '../../../lib/services/bounty-cancel-refund';

const v1 = { id: 'b1', title: 'Fix fence', amount: 40, is_for_honor: false, status: 'open', accepted_by: null } as any;
const v2 = { ...v1, id: 'b2', payment_architecture_version: 2 } as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockDelete.mockResolvedValue(true);
  mockTrack.mockResolvedValue(undefined);
});

describe('canPosterCancelBounty', () => {
  it('only while open and nobody is hired', () => {
    expect(canPosterCancelBounty({ status: 'open', accepted_by: null })).toBe(true);
    expect(canPosterCancelBounty({ status: 'open', accepted_by: 'h1' })).toBe(false);
    expect(canPosterCancelBounty({ status: 'in_progress' } as any)).toBe(false);
    expect(canPosterCancelBounty({ status: 'cancelled' } as any)).toBe(false);
  });
});

describe('planCancelRefund', () => {
  it('refunds the full reward to the Bounty balance for a funded v1 bounty', async () => {
    mockGetFunding.mockResolvedValue({ alreadyFunded: true });
    await expect(planCancelRefund(v1)).resolves.toEqual({ refundAmount: 40, destination: 'wallet' });
  });

  it('refunds to the original payment method for Stripe-native escrow', async () => {
    mockHoldState.mockResolvedValue('held');
    await expect(planCancelRefund(v2)).resolves.toEqual({
      refundAmount: 40,
      destination: 'original_payment_method',
    });
    expect(mockHoldState).toHaveBeenCalledWith('b2');
  });

  // Production 060079f5: paid $5 on the website, deleted from the app 2.5
  // minutes later. The server said already_funded=false (it only read the v1
  // wallet ledger), so the poster was told nothing was charged and the
  // charge was never refunded. The payment row is what decides now.
  it('refunds a captured web payment even when the server reports it unfunded', async () => {
    mockHoldState.mockResolvedValue('held');
    mockGetFunding.mockResolvedValue({ alreadyFunded: false });
    const plan = await planCancelRefund(v2);
    expect(plan).toEqual({ refundAmount: 40, destination: 'original_payment_method' });
    expect(describeCancelRefund(v2, plan).message).not.toContain("haven't been charged");
  });

  it('plans a refund for a v2 payment already on its way back, so /cancel can confirm it', async () => {
    mockHoldState.mockResolvedValue('returning');
    await expect(planCancelRefund(v2)).resolves.toEqual({
      refundAmount: 40,
      destination: 'original_payment_method',
    });
  });

  it('has nothing to refund when the v2 bounty was never paid, without asking the wallet ledger', async () => {
    mockHoldState.mockResolvedValue('none');
    await expect(planCancelRefund(v2)).resolves.toEqual({ refundAmount: 0, destination: null });
    expect(mockGetFunding).not.toHaveBeenCalled();
  });

  it('falls back to the server when the v2 payment row cannot be read', async () => {
    mockHoldState.mockResolvedValue('unknown');
    mockGetFunding.mockResolvedValue({ alreadyFunded: true });
    await expect(planCancelRefund(v2)).resolves.toEqual({
      refundAmount: 40,
      destination: 'original_payment_method',
    });
    mockGetFunding.mockResolvedValue({ alreadyFunded: false });
    await expect(planCancelRefund(v2)).resolves.toEqual({ refundAmount: 0, destination: null });
  });

  it('never reads bounty_payments for a v1 bounty', async () => {
    mockGetFunding.mockResolvedValue({ alreadyFunded: true });
    await planCancelRefund(v1);
    expect(mockHoldState).not.toHaveBeenCalled();
  });

  it('has nothing to refund on an unfunded pay-at-accept bounty', async () => {
    mockGetFunding.mockResolvedValue({ alreadyFunded: false });
    await expect(planCancelRefund(v1)).resolves.toEqual({ refundAmount: 0, destination: null });
  });

  it('never asks the server for a for-honor bounty', async () => {
    await expect(planCancelRefund({ ...v1, is_for_honor: true, amount: 0 })).resolves.toEqual({
      refundAmount: 0,
      destination: null,
    });
    expect(mockGetFunding).not.toHaveBeenCalled();
  });
});

describe('describeCancelRefund', () => {
  it('states the amount and where it goes', () => {
    const c = describeCancelRefund(v1, { refundAmount: 40, destination: 'wallet' });
    expect(c.title).toBe('Cancel and refund?');
    expect(c.message).toContain('$40 goes back to your Bounty balance.');
    expect(c.message).toContain("can't be undone");
    expect(c.confirmLabel).toBe('Cancel and refund');
    expect(describeCancelRefund(v2, { refundAmount: 40, destination: 'original_payment_method' }).message).toContain(
      '$40 goes back to your original payment method.'
    );
  });

  it('says plainly when nothing was charged', () => {
    const c = describeCancelRefund(v1, { refundAmount: 0, destination: null });
    expect(c.message).toContain("You haven't been charged for it, so there's nothing to refund.");
    expect(c.confirmLabel).toBe('Cancel bounty');
    expect(describeCancelRefund({ is_for_honor: true } as any, { refundAmount: 0, destination: null }).message).toContain(
      'no money is involved'
    );
  });

  it('formats cents and confirms afterwards', () => {
    expect(describeCancelRefund(v1, { refundAmount: 12.5, destination: 'wallet' }).message).toContain('$12.50');
    expect(describeCancelRefundDone({ refundAmount: 40, destination: 'wallet' })).toBe(
      "It's off the feed, and $40 is on its way back to your Bounty balance."
    );
    expect(describeCancelRefundDone({ refundAmount: 0, destination: null })).toBe("It's off the feed.");
    expect(describeCancelRefundDone({ refundAmount: 40, destination: 'original_payment_method' })).toBe(
      "It's off the feed, and $40 is on its way back to your original payment method. Banks usually take 5–10 business days to show it."
    );
  });
});

describe('cancelAndRefundBounty', () => {
  it('refunds through the wallet endpoint, then deletes', async () => {
    const refundEscrow = jest.fn().mockResolvedValue(true);
    await cancelAndRefundBounty(v1, { refundEscrow }, { refundAmount: 40, destination: 'wallet' });
    expect(refundEscrow).toHaveBeenCalledWith('b1', 'Fix fence', 100);
    expect(mockDelete).toHaveBeenCalledWith('b1');
    expect(refundEscrow.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0]);
    expect(mockTrack).toHaveBeenCalledWith('escrow_refunded', expect.objectContaining({ architecture: 'v1' }));
  });

  it('cancels Stripe-native escrow and requires a terminal status', async () => {
    mockCancelPayment.mockResolvedValue({ status: 'refunded' });
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).resolves.toEqual({ refundAmount: 40, destination: 'original_payment_method' });
    expect(mockCancelPayment).toHaveBeenCalledWith('b2', { allowRefundPending: true });
    expect(mockCancelPayment.mock.invocationCallOrder[0]).toBeLessThan(mockDelete.mock.invocationCallOrder[0]);
    expect(mockTrack).toHaveBeenCalledWith('escrow_refunded', expect.objectContaining({ architecture: 'v2' }));
  });

  // Stripe accepted the refund; it is on its way to the card. This used to
  // throw "still pending", show "Refund Failed: contact support" and leave
  // the bounty undeletable on every retry (the server answers refund_pending
  // idempotently).
  it('treats a refund Stripe has accepted as done, and deletes', async () => {
    mockCancelPayment.mockResolvedValue({ status: 'refund_pending', refunded: true });
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).resolves.toEqual({ refundAmount: 40, destination: 'original_payment_method' });
    expect(mockDelete).toHaveBeenCalledWith('b2');
  });

  it('reports nothing refunded when an authorization was only voided', async () => {
    mockCancelPayment.mockResolvedValue({ status: 'canceled', canceled: true });
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).resolves.toEqual({ refundAmount: 0, destination: null });
    expect(mockDelete).toHaveBeenCalledWith('b2');
  });

  it('deletes without claiming a refund when the server has no payment for the bounty', async () => {
    const { BountyPaymentError } = jest.requireMock('../../../lib/services/bounty-payments-service');
    mockCancelPayment.mockRejectedValue(new BountyPaymentError('No payment record for this bounty.', 404, 'no_payment'));
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).resolves.toEqual({ refundAmount: 0, destination: null });
    expect(mockDelete).toHaveBeenCalledWith('b2');
    expect(mockTrack).not.toHaveBeenCalledWith('escrow_refunded', expect.anything());
  });

  it('keeps the bounty when the refund itself is refused', async () => {
    const { BountyPaymentError } = jest.requireMock('../../../lib/services/bounty-payments-service');
    mockCancelPayment.mockRejectedValue(new BountyPaymentError('Refund could not be processed.', 502, 'refund_failed'));
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).rejects.toBeInstanceOf(BountyRefundFailedError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('leaves the bounty in place when the refund fails (including a lost acceptance race)', async () => {
    // fn_claim_owner_refund refusing because a hunter was just accepted
    // surfaces here as a failed refund: nothing is deleted.
    const refundEscrow = jest.fn().mockResolvedValue(false);
    await expect(
      cancelAndRefundBounty(v1, { refundEscrow }, { refundAmount: 40, destination: 'wallet' })
    ).rejects.toBeInstanceOf(BountyRefundFailedError);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith('payment_failed', expect.objectContaining({ stage: 'cancel' }));
  });

  it('treats a non-terminal Stripe cancel as a failed refund', async () => {
    mockCancelPayment.mockResolvedValue({ status: 'requires_capture' });
    await expect(
      cancelAndRefundBounty(v2, { refundEscrow: jest.fn() }, { refundAmount: 40, destination: 'original_payment_method' })
    ).rejects.toBeInstanceOf(BountyRefundFailedError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('just deletes when nothing is held, planning on its own when no plan is passed', async () => {
    mockGetFunding.mockResolvedValue({ alreadyFunded: false });
    const refundEscrow = jest.fn();
    await expect(cancelAndRefundBounty(v1, { refundEscrow })).resolves.toEqual({ refundAmount: 0, destination: null });
    expect(refundEscrow).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith('b1');
  });

  it('reports a failed delete as an ordinary error', async () => {
    mockDelete.mockResolvedValue(false);
    await expect(
      cancelAndRefundBounty(v1, { refundEscrow: jest.fn() }, { refundAmount: 0, destination: null })
    ).rejects.toThrow('Failed to delete bounty');
  });
});
