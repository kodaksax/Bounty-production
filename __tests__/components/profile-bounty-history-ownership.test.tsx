/**
 * Senior-first poster audit (2026-11-14), fix 4: a poster tapping their own
 * job under Profile → Bounties Posted got the worker-facing detail dialog with
 * "Apply for Bounty". Their own job now opens /postings/[bountyId], decided by
 * the signed-in user's id against the bounty's poster id, never by a name.
 * Someone else's job keeps the normal detail dialog.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockPush = jest.fn();
const mockGetByUserId = jest.fn();
let mockViewerId: string | null = 'poster-1';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: mockViewerId ? { user: { id: mockViewerId } } : null }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('lib/services/bounty-service', () => ({
  bountyService: { getByUserId: (...a: unknown[]) => mockGetByUserId(...a) },
}));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));
jest.mock('../../hooks/useNormalizedProfile', () => ({ useNormalizedProfile: () => ({ profile: null, loading: false }) }));
jest.mock('../../components/ui/avatar', () => ({ Avatar: () => null, AvatarFallback: () => null, AvatarImage: () => null }));
// The worker-facing dialog. Rendering it at all is what fix 4 is about.
jest.mock('../../components/bountydetailmodal', () => {
  const { Text } = require('react-native');
  return { BountyDetailModal: () => <Text>Apply for Bounty</Text> };
});

import { ProfileBountyHistorySection } from '../../components/profile-bounty-history-section';

const job = (posterId: string) => ({
  id: 'b1',
  title: 'Remove old furniture from my garage',
  username: 'same_display_name',
  amount: 60,
  is_for_honor: false,
  status: 'open',
  poster_id: posterId,
  poster_avatar: null,
  work_type: 'in_person',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerId = 'poster-1';
});

async function tapJob() {
  const row = await screen.findByLabelText(/Bounty: Remove old furniture from my garage/);
  fireEvent.press(row);
  return row;
}

describe('Profile → Bounties Posted', () => {
  it("the poster's own job opens poster management, never the Apply dialog", async () => {
    mockGetByUserId.mockResolvedValue([job('poster-1')]);
    render(<ProfileBountyHistorySection userId="poster-1" isOwnProfile />);
    const row = await tapJob();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b1' } });
    expect(screen.queryByText('Apply for Bounty')).toBeNull();
    expect(row.props.accessibilityHint).toBe('Opens your bounty');
  });

  it("another person's job keeps the normal detail and application view", async () => {
    mockViewerId = 'hunter-9';
    mockGetByUserId.mockResolvedValue([job('poster-1')]);
    render(<ProfileBountyHistorySection userId="poster-1" />);
    await tapJob();
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByText('Apply for Bounty')).toBeTruthy();
  });

  it('ownership is the user id, not isOwnProfile or a matching display name', async () => {
    // isOwnProfile wrongly true and the same display name: still not theirs.
    mockViewerId = 'hunter-9';
    mockGetByUserId.mockResolvedValue([job('poster-1')]);
    render(<ProfileBountyHistorySection userId="poster-1" isOwnProfile />);
    await tapJob();
    expect(mockPush).not.toHaveBeenCalled();
    expect(await screen.findByText('Apply for Bounty')).toBeTruthy();
  });

  it('signed out, nothing is treated as owned', async () => {
    mockViewerId = null;
    mockGetByUserId.mockResolvedValue([job('poster-1')]);
    render(<ProfileBountyHistorySection userId="poster-1" />);
    await tapJob();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
