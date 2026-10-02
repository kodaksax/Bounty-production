/**
 * Hunter-facing trust block on a bounty (trust-spine audit T10/T14): funding
 * state and poster evidence come only from the backend, and nothing renders a
 * reassuring default when the backend didn't answer.
 */
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../components/ui/verification-badge', () => {
  const { Text } = require('react-native');
  return { VerificationBadge: ({ status }: { status: string }) => <Text>{`badge:${status}`}</Text> };
});

const mockFundingState = jest.fn();
jest.mock('../../lib/services/bounty-funding-service', () => ({
  getBountyFundingState: (...args: any[]) => mockFundingState(...args),
}));
const mockStats = jest.fn();
jest.mock('../../lib/services/profile-stats-service', () => ({
  profileStatsService: { getActivityStatsOrNull: (...args: any[]) => mockStats(...args) },
}));

import { BountyTrustSignals } from '../../components/bounty-trust-signals';

const NEW_POSTER = { created_at: new Date().toISOString(), stripe_identity_status: 'unstarted' };
const stats = (over: Partial<Record<string, any>> = {}) => ({
  bountiesPosted: 1, bountiesCompleted: 0, hunterCompleted: 0, firstBountyPostedAt: null,
  ratingAvg: null, ratingCount: 0, ...over,
});

beforeEach(() => {
  mockFundingState.mockReset();
  mockStats.mockReset();
});

describe('BountyTrustSignals', () => {
  test('pay-at-accept bounty from a brand-new poster: says both plainly', async () => {
    mockFundingState.mockResolvedValue('held_on_selection');
    mockStats.mockResolvedValue(stats());

    const { findByText, queryByText } = render(
      <BountyTrustSignals bountyId="b1" posterId="p1" poster={NEW_POSTER} />
    );

    expect(await findByText('Payment not held yet')).toBeTruthy();
    expect(await findByText('Joined today · No completed bounties yet')).toBeTruthy();
    expect(queryByText(/badge:/)).toBeNull();
  });

  test('held escrow + verified poster with history', async () => {
    mockFundingState.mockResolvedValue('held');
    mockStats.mockResolvedValue(stats({ bountiesCompleted: 3, ratingAvg: 4.67, ratingCount: 3 }));

    const { findByText } = render(
      <BountyTrustSignals
        bountyId="b2"
        posterId="p2"
        poster={{ created_at: '2026-03-10T00:00:00.000Z', stripe_identity_status: 'verified' }}
      />
    );

    expect(await findByText('Payment held')).toBeTruthy();
    expect(await findByText('Joined Mar 2026 · 3 completed bounties · ★4.7 (3)')).toBeTruthy();
    expect(await findByText('badge:verified')).toBeTruthy();
  });

  test('backend silent (RPC missing / signed out): no funding claim, no "no history" claim', async () => {
    mockFundingState.mockResolvedValue(null);
    mockStats.mockResolvedValue(null);

    const { toJSON } = render(<BountyTrustSignals bountyId="b3" posterId="p3" poster={null} />);

    await waitFor(() => expect(mockStats).toHaveBeenCalled());
    expect(toJSON()).toBeNull();
  });

  test('for-honor bounty: no funding line', async () => {
    mockFundingState.mockResolvedValue('not_applicable');
    mockStats.mockResolvedValue(stats({ bountiesCompleted: 1 }));

    const { findByText, queryByTestId } = render(
      <BountyTrustSignals bountyId="b4" posterId="p4" poster={{ created_at: '2026-01-05T00:00:00.000Z' }} />
    );

    expect(await findByText('Joined Jan 2026 · 1 completed bounty')).toBeTruthy();
    expect(queryByTestId('bounty-funding-state')).toBeNull();
  });
});
