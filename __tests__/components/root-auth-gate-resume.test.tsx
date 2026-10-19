/**
 * Root auth gate (app/index.tsx): where a signed-in, onboarded user lands on
 * a cold start. They reopen the tab they last left (within the restore
 * window), otherwise the feed, and a later re-run of the gate must never move
 * them off the tab they are on now. A notification that opened the app wins
 * over the remembered tab (SBA-12).
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
}));

let mockBootstrap: any = { status: 'authenticated', onboardingComplete: true };
jest.mock('../../hooks/useAppBootstrap', () => ({
  useAppBootstrap: () => mockBootstrap,
}));

let mockAuth: any;
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuth,
}));

const mockGetRestorableLastScreen = jest.fn();
jest.mock('../../lib/storage/last-screen', () => ({
  getRestorableLastScreen: (...args: any[]) => mockGetRestorableLastScreen(...args),
}));

jest.mock('../../lib/storage/onboarding', () => ({
  hasDeviceSignedInBefore: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../lib/utils/auth-diagnostics', () => ({
  logAuthLifecycleEvent: jest.fn(),
}));
jest.mock('../../app/auth/sign-in-form', () => ({ SignInForm: () => null }));
jest.mock('../../app/initial-navigation/initialNavigation', () => ({
  markInitialNavigationDone: jest.fn(),
}));

const Index = require('../../app/index').default;
const {
  __resetDeferredDeepLinksForTests,
  openDeepLink,
} = require('../../lib/navigation/deferred-deep-link');

/** What lib/context/notification-context.tsx does with a tapped notification. */
const tapNotification = (path: string) => openDeepLink(path, (p: string) => mockPush(p));
const NEW_APPLICATION = '/tabs/bounty-app?tab=messages&initialTab=requests';

describe('root auth gate — resume last tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetDeferredDeepLinksForTests();
    mockSearchParams = {};
    mockBootstrap = { status: 'authenticated', onboardingComplete: true };
    mockAuth = {
      session: { user: { id: 'user-1' } },
      isPasswordRecovery: false,
      accountBlockedReason: null,
      environmentError: false,
      isAuthStale: false,
      attemptRefresh: jest.fn(),
    };
  });

  it('reopens the tab the user last left', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    render(<Index />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=wallet')
    );
    expect(mockGetRestorableLastScreen).toHaveBeenCalledWith('user-1');
  });

  it('lands on the feed when there is nothing to restore', async () => {
    mockGetRestorableLastScreen.mockResolvedValue(null);
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app'));
  });

  it('honours a redirect_to deep link over the remembered tab', async () => {
    mockSearchParams = { redirect_to: '/tabs/postings-screen' };
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/postings-screen'));
    expect(mockGetRestorableLastScreen).not.toHaveBeenCalled();
  });

  it('sends an un-onboarded user to onboarding, not a remembered tab', async () => {
    mockBootstrap = { status: 'authenticated', onboardingComplete: false };
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'));
    expect(mockGetRestorableLastScreen).not.toHaveBeenCalled();
  });

  it('does not re-route when the gate re-runs after the user has moved on', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    const { rerender } = render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

    // The user has since switched to Profile (saved), and a stale/recovered
    // connection flips isAuthStale, re-running the gate effect.
    mockGetRestorableLastScreen.mockResolvedValue('profile');
    mockAuth = { ...mockAuth, isAuthStale: true };
    rerender(<Index />);
    mockAuth = { ...mockAuth, isAuthStale: false };
    rerender(<Index />);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockGetRestorableLastScreen).toHaveBeenCalledTimes(1);
  });
  describe('a notification that opened the app (SBA-12)', () => {
    it('wins over the remembered tab when it arrives while the gate is deciding', async () => {
      let resolveLastScreen: (screen: string | null) => void = () => {};
      mockGetRestorableLastScreen.mockReturnValue(
        new Promise(resolve => {
          resolveLastScreen = resolve;
        })
      );
      render(<Index />);
      // The notification handler fires ~100 ms after launch, while the last
      // tab is still being read.
      tapNotification(NEW_APPLICATION);
      resolveLastScreen('wallet');

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(NEW_APPLICATION));
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).not.toHaveBeenCalledWith('/tabs/bounty-app?tab=wallet');
      // The gate lands on it itself: one shell, not a second one pushed on top.
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('wins when it arrives before the session is restored', async () => {
      mockBootstrap = { status: 'loading', onboardingComplete: false };
      mockGetRestorableLastScreen.mockResolvedValue('wallet');
      const { rerender } = render(<Index />);
      tapNotification(NEW_APPLICATION);
      expect(mockPush).not.toHaveBeenCalled();

      mockBootstrap = { status: 'authenticated', onboardingComplete: true };
      rerender(<Index />);

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(NEW_APPLICATION));
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockGetRestorableLastScreen).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('opens a non-tab destination on top of where the gate lands, not under it', async () => {
      mockBootstrap = { status: 'loading', onboardingComplete: false };
      mockGetRestorableLastScreen.mockResolvedValue('wallet');
      const { rerender } = render(<Index />);
      tapNotification('/postings/abc-123');
      expect(mockPush).not.toHaveBeenCalled();

      mockBootstrap = { status: 'authenticated', onboardingComplete: true };
      rerender(<Index />);

      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/postings/abc-123'));
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=wallet');
      expect(mockReplace.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0]);
    });

    it('opens straight away once the gate has already navigated (warm tap)', async () => {
      mockGetRestorableLastScreen.mockResolvedValue('wallet');
      render(<Index />);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));

      tapNotification(NEW_APPLICATION);
      expect(mockPush).toHaveBeenCalledWith(NEW_APPLICATION);
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });

    it('still opens if the gate unmounts without navigating', () => {
      mockBootstrap = { status: 'loading', onboardingComplete: false };
      const { unmount } = render(<Index />);
      tapNotification('/postings/abc-123');
      expect(mockPush).not.toHaveBeenCalled();
      unmount();
      expect(mockPush).toHaveBeenCalledWith('/postings/abc-123');
    });
  });
});
