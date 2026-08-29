import { bountyHoldsUnreleasedEscrow } from '../../../lib/utils/payment-architecture';

describe('bountyHoldsUnreleasedEscrow', () => {
  it('is true for a funded paid bounty still in escrow', () => {
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'open' })).toBe(true);
    expect(
      bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'in_progress' })
    ).toBe(true);
    expect(
      bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'cancellation_requested' })
    ).toBe(true);
  });

  it('is false once the escrow is released or refunded', () => {
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'completed' })).toBe(false);
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'cancelled' })).toBe(false);
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'archived' })).toBe(false);
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: false, status: 'deleted' })).toBe(false);
  });

  it('is false for honor bounties and unfunded bounties', () => {
    expect(bountyHoldsUnreleasedEscrow({ amount: 50, is_for_honor: true, status: 'open' })).toBe(false);
    expect(bountyHoldsUnreleasedEscrow({ amount: 0, is_for_honor: false, status: 'open' })).toBe(false);
    expect(bountyHoldsUnreleasedEscrow(null)).toBe(false);
    expect(bountyHoldsUnreleasedEscrow(undefined)).toBe(false);
  });
});
