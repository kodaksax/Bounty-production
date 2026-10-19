/**
 * SBA-10 (5): when the server refuses an edit, the modal shows why, inline,
 * and keeps the poster's edits — instead of "update failed". Raw server text
 * never reaches the screen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { EditPostingModal } from '../../components/edit-posting-modal';
import { toBountyUpdateError } from '../../lib/services/bounty-update-error';

jest.mock('../../hooks/useBountyExactLocation', () => ({ useBountyExactLocation: () => ({ exact: null }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const bounty: any = {
  id: '1',
  title: 'Fix a fence',
  description: 'Two panels are down.',
  amount: 40,
  is_for_honor: false,
  location: 'Austin, TX',
  status: 'open',
  poster_id: 'user_1',
  created_at: new Date().toISOString(),
};

function renderModal(onSave: jest.Mock, onClose = jest.fn()) {
  render(<EditPostingModal visible bounty={bounty} onSave={onSave} onClose={onClose} />);
  return onClose;
}

it("shows the server's reason inline and stays open with the edits intact", async () => {
  const onSave = jest
    .fn()
    .mockRejectedValue(toBountyUpdateError({ code: 'P0001', message: 'bounty_amount_locked_by_escrow' }));
  const onClose = renderModal(onSave);

  fireEvent.changeText(screen.getByDisplayValue('40'), '80');
  fireEvent.press(screen.getByText('Save Changes'));

  await waitFor(() =>
    expect(screen.getByText(/Your payment for this bounty is already held/)).toBeTruthy()
  );
  expect(screen.queryByText(/update failed/i)).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('80')).toBeTruthy();
});

it('never shows a raw PostgREST message', async () => {
  const onSave = jest.fn().mockRejectedValue({
    code: '42501',
    message: 'new row violates row-level security policy for table "bounties"',
  });
  renderModal(onSave);
  fireEvent.press(screen.getByText('Save Changes'));
  await waitFor(() => expect(screen.getByText('You can only change bounties you posted.')).toBeTruthy());
  expect(screen.queryByText(/row-level security/)).toBeNull();
});
