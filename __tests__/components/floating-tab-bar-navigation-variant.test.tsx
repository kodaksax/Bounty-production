/**
 * FloatingTabBar under home_post_navigation_test: the post_first arm swaps
 * Home and Post, moves the centre emphasis and the "Main screen" label to
 * Post, and every tab still navigates to its own destination.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-blur', () => ({ BlurView: () => null }));

import { FloatingTabBar } from 'components/ui/floating-tab-bar';

// Labels of the tab buttons, left to right (each composite and its host
// share the label, so keep first occurrences only).
const tabLabels = () => {
  const labels = screen
    .UNSAFE_getAllByProps({ accessibilityRole: 'button' })
    .map(node => node.props.accessibilityLabel as string);
  return labels.filter((label, i) => labels.indexOf(label) === i);
};

describe('FloatingTabBar — home_post_navigation_test', () => {
  it('control keeps the current order, with Home as the main screen', () => {
    render(<FloatingTabBar activeScreen="bounty" onNavigate={jest.fn()} />);
    expect(tabLabels()).toEqual([
      'View your bounties',
      'View wallet and transactions',
      'View bounty dashboard - Main screen',
      'Post a new bounty',
      'View and edit profile',
    ]);
  });

  it('post_first puts Post in the centre as the main screen and Home in the 4th slot', () => {
    render(<FloatingTabBar activeScreen="postings" onNavigate={jest.fn()} variant="post_first" />);
    expect(tabLabels()).toEqual([
      'View your bounties',
      'View wallet and transactions',
      'Post a new bounty - Main screen',
      'View bounty dashboard',
      'View and edit profile',
    ]);
    expect(screen.getByLabelText('Post a new bounty - Main screen').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('post_first tabs still open their own screens', () => {
    const onNavigate = jest.fn();
    render(<FloatingTabBar activeScreen="postings" onNavigate={onNavigate} variant="post_first" />);
    fireEvent.press(screen.getByLabelText('View bounty dashboard'));
    expect(onNavigate).toHaveBeenCalledWith('bounty');
  });

  it('post_first keeps Admin in the last slot when it replaces Profile', () => {
    render(
      <FloatingTabBar activeScreen="postings" onNavigate={jest.fn()} variant="post_first" showAdmin />
    );
    expect(tabLabels()[4]).toBe('Admin panel');
  });

  it('the draft label wins on Post in either arm', () => {
    render(
      <FloatingTabBar activeScreen="bounty" onNavigate={jest.fn()} variant="post_first" postDraftPending />
    );
    expect(tabLabels()[2]).toBe('Post a bounty, unfinished post saved');
    expect(screen.getByTestId('post-draft-dot')).toBeTruthy();
  });
});
