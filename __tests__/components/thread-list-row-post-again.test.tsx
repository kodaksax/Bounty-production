/**
 * The "Post again" button on a My Bounties row
 * (components/bounty-inbox/thread-list-row.tsx): shown only when the inbox
 * passes onPostAgain (the poster's finished bounties), and it calls it.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('lib/services/userProfile', () => ({ userProfileService: { getProfile: jest.fn(async () => null) } }));
jest.mock('lib/services/supabase-messaging', () => ({ generateInitials: () => 'AB' }));

import { BountyConversationRow } from 'components/bounty-inbox/thread-list-row';

const base = {
  person: null,
  bountyTitle: 'Haul away yard trash',
  status: 'cancelled' as const,
  preview: 'Cancelled',
  onPress: jest.fn(),
};

it('shows Post again when given a handler, and calls it', () => {
  const onPostAgain = jest.fn();
  render(<BountyConversationRow {...base} onPostAgain={onPostAgain} />);

  fireEvent.press(screen.getByLabelText('Post again: Haul away yard trash'));
  expect(onPostAgain).toHaveBeenCalledTimes(1);
  expect(base.onPress).not.toHaveBeenCalled();
});

it('has no Post again button without one', () => {
  render(<BountyConversationRow {...base} />);
  expect(screen.queryByTestId('inbox-row-post-again')).toBeNull();
});
