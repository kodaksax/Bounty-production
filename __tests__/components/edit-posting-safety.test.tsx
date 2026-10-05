import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { EditPostingModal } from '../../components/edit-posting-modal';
import { CONTACT_INFO_ERROR } from '../../lib/utils/bounty-validation';
import { trustSafetyStrings } from '../../lib/strings/trust-safety';

jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../hooks/usePostingPolicy', () => ({
  usePostingPolicy: () => ({ honorPostsEnabled: true, minimumAmount: 1 }),
}));
jest.mock('../../hooks/useBountyExactLocation', () => ({
  useBountyExactLocation: () => ({ exact: null }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const bounty = {
  id: 'b1', title: 'Mount a TV', description: 'Mount the TV in the living room.',
  amount: 40, is_for_honor: false, location: 'Austin', status: 'open',
} as any;

function setup() {
  const onSave = jest.fn().mockResolvedValue(undefined);
  return {
    ...render(<EditPostingModal visible bounty={bounty} onClose={jest.fn()} onSave={onSave} />),
    onSave,
  };
}

describe('posting safety', () => {
  it.each([
    ['title', 'Call 512-555-0100 to mount a TV'],
    ['description', 'Email me at hunter@example.org for the task'],
  ])('rejects contact information in edited %s', (field, text) => {
    const screen = setup();
    fireEvent.changeText(screen.getByDisplayValue(field === 'title' ? bounty.title : bounty.description), text);
    fireEvent.press(screen.getByText('Save Changes'));
    expect(screen.getByText(CONTACT_INFO_ERROR)).toBeTruthy();
    expect(screen.onSave).not.toHaveBeenCalled();
  });

  it('warns about external payment before saving without over-blocking text', async () => {
    const screen = setup();
    fireEvent.changeText(screen.getByDisplayValue(bounty.description), 'Pay me directly with Venmo');
    expect(screen.getByText(trustSafetyStrings.posting)).toBeTruthy();
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.onSave).toHaveBeenCalled());
  });

  it('leaves ordinary task descriptions uncluttered and editable', async () => {
    const screen = setup();
    expect(screen.queryByText(trustSafetyStrings.posting)).toBeNull();
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ description: bounty.description, amount: 40 }),
    ));
  });
});
