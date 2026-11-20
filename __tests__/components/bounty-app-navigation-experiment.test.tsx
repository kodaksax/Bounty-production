/**
 * Tab shell (app/tabs/bounty-app.tsx) under home_post_navigation_test: it
 * waits for the arm before drawing anything, lays the pager and bar out in
 * that arm's order, opens a post_first cold start on Post without counting
 * it as a deliberate composer open, and records exposure once.
 */

import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(cb, [cb]);
  },
  Redirect: () => null,
}));

jest.mock('react-native-gesture-handler', () => ({
  Gesture: { Native: () => ({}) },
  GestureDetector: ({ children }: any) => children,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-blur', () => ({ BlurView: () => null }));
jest.mock('lib/haptic-feedback', () => ({
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));

const mockAuth = {
  session: { user: { id: 'user-1' } },
  isLoading: false,
  profile: { onboarding_completed: true, created_at: '2026-11-01T00:00:00Z' },
};
jest.mock('../../hooks/use-auth-context', () => ({ useAuthContext: () => mockAuth }));

const mockNeedHelp = jest.fn();
jest.mock('../../app/tabs/need-help-screen', () => ({
  NeedHelpScreen: (props: any) => {
    mockNeedHelp(props);
    return null;
  },
}));
jest.mock('../../app/tabs/inbox-screen', () => ({ InboxScreen: () => null }));
jest.mock('app/tabs/profile-screen', () => ({ ProfileScreen: () => null }));
jest.mock('app/tabs/wallet-screen', () => ({ WalletScreen: () => null }));
jest.mock('components/bounty-feed', () => {
  const R = require('react');
  return { BountyFeed: R.forwardRef(() => null) };
});
jest.mock('components/connection-status', () => ({ ConnectionStatus: () => null }));
jest.mock('../../components/moments/MomentSheet', () => ({ MomentSheet: () => null }));
jest.mock('../../components/resume-composer-sheet', () => ({ ResumeComposerSheet: () => null }));
jest.mock('../../app/hooks/useResumeComposerPrompt', () => ({
  useResumeComposerPrompt: () => ({ draftTitle: null, onContinue: jest.fn(), onDismiss: jest.fn() }),
}));
jest.mock('../../providers/moments-provider', () => ({
  MomentsProvider: ({ children }: any) => children,
}));
jest.mock('../../components/replay-mask', () => ({ ReplayMask: ({ children }: any) => children }));
jest.mock('../../hooks/useTabBackToFeed', () => ({ useTabBackToFeed: jest.fn() }));
jest.mock('../../hooks/useConversations', () => ({ useConversations: () => ({ totalUnreadCount: 0 }) }));
jest.mock('../../app/hooks/useBountyDraft', () => ({ useBountyDraftInProgress: () => false }));
jest.mock('../../lib/admin-context', () => ({
  useAdmin: () => ({ isAdmin: false, isAdminTabEnabled: false }),
}));
jest.mock('../../lib/analytics/screen-tracking', () => ({ trackScreenView: jest.fn() }));
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    profileRowStatus: jest.fn(),
    updateProfile: jest.fn(),
    getPrimaryRoleForAnalytics: () => 'poster',
  },
}));
jest.mock('../../lib/services/navigation-intent', () => ({
  navigationIntent: { getAndClearPendingNavigation: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../../lib/storage/last-screen', () => ({ saveLastScreen: jest.fn() }));
jest.mock('../../lib/context/TopInsetOverlayContext', () => ({ useTopInsetOverlay: () => null }));

let mockResolved: any;
const mockResolve = jest.fn();
const mockRecordExposure = jest.fn();
jest.mock('../../lib/experiments/home-post-navigation', () => ({
  ...jest.requireActual('../../lib/experiments/home-post-navigation'),
  getResolvedNavigationExperience: () => mockResolved,
  resolveNavigationExperience: (...args: any[]) => mockResolve(...args),
  recordNavigationExposure: (...args: any[]) => mockRecordExposure(...args),
}));

// The per-user onboarding flag the shell reads before rendering.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue('true'),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

const BountyAppRoute = require('../../app/tabs/bounty-app').default;

const tabLabels = () => {
  const labels = screen
    .UNSAFE_getAllByProps({ accessibilityRole: 'button' })
    .map(node => node.props.accessibilityLabel as string);
  return labels.filter((label, i) => labels.indexOf(label) === i);
};

const POST_FIRST = { variant: 'post_first', enrollment: 'enrolled' };
const CONTROL = { variant: 'control', enrollment: 'enrolled' };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockResolved = undefined;
});

describe('tab shell — home_post_navigation_test', () => {
  it('waits for the arm before drawing the tab bar', async () => {
    let release: (value: unknown) => void = () => {};
    mockResolve.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    render(<BountyAppRoute />);
    expect(screen.UNSAFE_queryAllByProps({ accessibilityRole: 'button' })).toHaveLength(0);
    expect(mockResolve).toHaveBeenCalledWith('user-1');

    mockResolved = POST_FIRST;
    release(POST_FIRST);
    await waitFor(() => expect(tabLabels()[2]).toBe('Post a new bounty - Main screen'));
  });

  it('control draws the current bar and lands on Home', async () => {
    mockResolved = CONTROL;
    render(<BountyAppRoute />);
    await waitFor(() => expect(tabLabels()).toHaveLength(5));
    expect(tabLabels()[2]).toBe('View bounty dashboard - Main screen');
    expect(screen.getByLabelText('View bounty dashboard - Main screen').props.accessibilityState)
      .toEqual({ selected: true });
    await waitFor(() =>
      expect(mockRecordExposure).toHaveBeenCalledWith('user-1', CONTROL, {
        landingTab: 'bounty',
        landingReason: 'default',
        primaryRole: 'poster',
        accountCreatedAt: '2026-11-01T00:00:00Z',
      })
    );
  });

  it('a post_first cold start opens on Post as an app_launch, not a tab tap', async () => {
    mockResolved = POST_FIRST;
    mockParams = { tab: 'postings', entry: 'app_launch' };
    render(<BountyAppRoute />);
    await waitFor(() => expect(tabLabels()).toHaveLength(5));
    expect(screen.getByLabelText('Post a new bounty - Main screen').props.accessibilityState)
      .toEqual({ selected: true });
    await waitFor(() =>
      expect(mockNeedHelp).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true, entryPoint: 'app_launch' })
      )
    );
    expect(mockRecordExposure).toHaveBeenCalledWith(
      'user-1',
      POST_FIRST,
      expect.objectContaining({ landingTab: 'postings', landingReason: 'app_launch' })
    );
  });

  it('a link into a post_first shell keeps its own tab', async () => {
    mockResolved = POST_FIRST;
    mockParams = { tab: 'bounty' };
    render(<BountyAppRoute />);
    await waitFor(() => expect(tabLabels()).toHaveLength(5));
    expect(screen.getByLabelText('View bounty dashboard').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(mockRecordExposure).toHaveBeenCalledWith(
      'user-1',
      POST_FIRST,
      expect.objectContaining({ landingTab: 'bounty', landingReason: 'link' })
    );
  });

  it('reports exposure once across re-renders', async () => {
    mockResolved = POST_FIRST;
    const { rerender } = render(<BountyAppRoute />);
    await waitFor(() => expect(mockRecordExposure).toHaveBeenCalledTimes(1));
    rerender(<BountyAppRoute />);
    rerender(<BountyAppRoute />);
    expect(mockRecordExposure).toHaveBeenCalledTimes(1);
  });
});
