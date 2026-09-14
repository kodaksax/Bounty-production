/**
 * EditPostingModal must not offer what the posting policy forbids.
 *
 * `trg_bounties_enforce_posting_policy` only fires on INSERT, so editing was
 * the one route to a For Honor listing (or a sub-minimum amount) while
 * production has `honor_posts_enabled = false`.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPolicy = { honorPostsEnabled: false, minimumAmount: 5 };
jest.mock('../../hooks/usePostingPolicy', () => ({
  usePostingPolicy: () => mockPolicy,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { EditPostingModal } = require('../../components/edit-posting-modal');

function makeBounty(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    title: 'Mount a TV',
    description: 'Living room wall',
    amount: 40,
    is_for_honor: false,
    location: 'Austin',
    ...overrides,
  } as any;
}

function renderModal(bounty = makeBounty(), onSave = jest.fn().mockResolvedValue(undefined)) {
  const utils = render(
    <EditPostingModal visible bounty={bounty} onClose={jest.fn()} onSave={onSave} />
  );
  return { ...utils, onSave };
}

describe('EditPostingModal posting policy', () => {
  beforeEach(() => {
    mockPolicy.honorPostsEnabled = false;
    mockPolicy.minimumAmount = 5;
  });

  it('hides the For Honor toggle while honor posts are disabled', () => {
    const { queryByText } = renderModal();
    expect(queryByText('For Honor')).toBeNull();
  });

  it('shows the toggle when honor posts are enabled', () => {
    mockPolicy.honorPostsEnabled = true;
    const { getByText } = renderModal();
    expect(getByText('For Honor')).toBeTruthy();
  });

  it('keeps the toggle for a bounty that is already For Honor', () => {
    const { getByText } = renderModal(makeBounty({ is_for_honor: true, amount: 0 }));
    expect(getByText('For Honor')).toBeTruthy();
  });

  it('rejects changing the amount below the posting minimum', () => {
    const { getByPlaceholderText, getByText, onSave } = renderModal();
    fireEvent.changeText(getByPlaceholderText('0'), '2');
    fireEvent.press(getByText('Save Changes'));
    expect(getByText('Amount must be at least $5')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('still lets a legacy sub-minimum listing edit its title', async () => {
    const { getByDisplayValue, getByText, onSave } = renderModal(makeBounty({ amount: 3 }));
    fireEvent.changeText(getByDisplayValue('Mount a TV'), 'Mount a big TV');
    fireEvent.press(getByText('Save Changes'));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mount a big TV', amount: 3 }))
    );
  });
});
