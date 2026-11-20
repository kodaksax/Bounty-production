/**
 * Root auth gate (app/index.tsx) in the post_first arm of
 * home_post_navigation_test: a cold start with nothing else to open lands on
 * Post, while a notification, a deep link, a remembered tab (now including
 * the feed) and onboarding keep their own destinations.
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

let mockExperience: any = { variant: 'post_first', enrollment: 'enrolled' };
jest.mock('../../lib/experiments/home-post-navigation', () => ({
  ...jest.requireActual('../../lib/experiments/home-post-navigation'),
  resolveNavigationExperience: jest.fn(() => Promise.resolve(mockExperience)),
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

const POST_LANDING = '/tabs/bounty-app?tab=postings&entry=app_launch';

describe('root auth gate — post_first arm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetDeferredDeepLinksForTests();
    mockSearchParams = {};
    mockBootstrap = { status: 'authenticated', onboardingComplete: true };
    mockExperience = { variant: 'post_first', enrollment: 'enrolled' };
    mockAuth = {
      session: { user: { id: 'user-1' } },
      isPasswordRecovery: false,
      accountBlockedReason: null,
      environmentError: false,
      isAuthStale: false,
      attemptRefresh: jest.fn(),
    };
  });

  it('lands on Post when there is nothing to restore', async () => {
    mockGetRestorableLastScreen.mockResolvedValue(null);
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(POST_LANDING));
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('reopens the feed for someone who just left it', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('bounty');
    render(<Index />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=bounty')
    );
  });

  it('reopens any other remembered tab', async () => {
    mockGetRestorableLastScreen.mockResolvedValue('wallet');
    render(<Index />);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=wallet')
    );
  });

  it('lets a notification win over the Post landing', async () => {
    const { resolveNavigationExperience } = require('../../lib/experiments/home-post-navigation');
    let release: (value: unknown) => void = () => {};
    resolveNavigationExperience.mockReturnValueOnce(
      new Promise(resolve => {
        release = resolve;
      })
    );
    mockGetRestorableLastScreen.mockResolvedValue(null);
    render(<Index />);
    // The notification handler fires while the gate waits for the flag.
    openDeepLink('/tabs/bounty-app?tab=messages&initialTab=requests', (p: string) => mockPush(p));
    release(mockExperience);
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app?tab=messages&initialTab=requests')
    );
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('sends an un-onboarded user to onboarding, never to Post', async () => {
    mockBootstrap = { status: 'authenticated', onboardingComplete: false };
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'));
    expect(mockReplace).not.toHaveBeenCalledWith(POST_LANDING);
  });

  it.each([
    ['not enrolled', { variant: 'control', enrollment: 'not_enrolled' }],
    ['flag unavailable', { variant: 'control', enrollment: 'flag_unavailable' }],
  ])('lands on the feed when %s', async (_label, experience) => {
    mockExperience = experience;
    mockGetRestorableLastScreen.mockResolvedValue('bounty');
    render(<Index />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/tabs/bounty-app'));
  });
});
