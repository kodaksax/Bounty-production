/**
 * Earned-only badges cross-user (trust-spine audit T23): a locked milestone or
 * verification chip on someone else's profile reads as a credential.
 */
import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

import { MilestoneBadgeChips } from '../../components/ui/milestone-badge-chips';
import { VerificationBadgeChips } from '../../components/ui/verification-badge-chips';

describe('MilestoneBadgeChips', () => {
  const someEarned = { bounties_posted: 2, bounties_completed: 0, average_rating: undefined, rating_count: 0 };

  test('own profile keeps locked milestones as goals', () => {
    const { getByText } = render(<MilestoneBadgeChips input={someEarned} />);
    expect(getByText('First Bounty Posted')).toBeTruthy();
    expect(getByText('Top Rated')).toBeTruthy();
    expect(getByText('5 Posted Bounties Completed')).toBeTruthy();
  });

  test("someone else's profile shows only earned milestones", () => {
    const { getByText, queryByText } = render(<MilestoneBadgeChips input={someEarned} isOwnProfile={false} />);
    expect(getByText('First Bounty Posted')).toBeTruthy();
    expect(queryByText('Top Rated')).toBeNull();
    expect(queryByText('5 Posted Bounties Completed')).toBeNull();
  });

  test('nothing earned -> no section at all on another profile', () => {
    const { toJSON } = render(<MilestoneBadgeChips input={{}} isOwnProfile={false} />);
    expect(toJSON()).toBeNull();
  });
});

describe('VerificationBadgeChips', () => {
  test("unearned ID badge is not rendered on someone else's profile", () => {
    const { toJSON } = render(
      <VerificationBadgeChips isOwnProfile={false} input={{ stripe_identity_status: 'unstarted' } as any} />
    );
    const text = JSON.stringify(toJSON());
    expect(text).not.toMatch(/ID Verified/i);
  });
});
