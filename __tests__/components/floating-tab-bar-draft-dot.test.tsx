/**
 * The Post tab's "unfinished post" dot on FloatingTabBar
 * (components/ui/floating-tab-bar.tsx) — the nudge back to a saved draft.
 */

import { render, screen } from '@testing-library/react-native';

jest.mock('lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-blur', () => ({ BlurView: () => null }));

import { FloatingTabBar } from 'components/ui/floating-tab-bar';

const renderBar = (props: { activeScreen: string; postDraftPending?: boolean }) =>
  render(<FloatingTabBar onNavigate={jest.fn()} {...props} />);

describe('FloatingTabBar — unfinished post dot', () => {
  it('dots the Post tab while a draft is saved and the poster is elsewhere', () => {
    renderBar({ activeScreen: 'bounty', postDraftPending: true });

    expect(screen.getByTestId('post-draft-dot')).toBeTruthy();
    expect(screen.getByLabelText('Post a bounty, unfinished post saved')).toBeTruthy();
  });

  it('hides the dot on the Post tab itself — the composer offers the resume there', () => {
    renderBar({ activeScreen: 'postings', postDraftPending: true });

    expect(screen.queryByTestId('post-draft-dot')).toBeNull();
  });

  it('shows nothing without a draft', () => {
    renderBar({ activeScreen: 'bounty' });

    expect(screen.queryByTestId('post-draft-dot')).toBeNull();
    expect(screen.getByLabelText('Post a new bounty')).toBeTruthy();
  });
});
