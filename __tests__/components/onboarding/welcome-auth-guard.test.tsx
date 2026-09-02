/**
 * Backstop for the "sent back to Welcome after signing up" failure, plus a
 * regression check that welcome.tsx never falls back to the old two-design
 * A/B branching (deleted 2026-08-24 — see app/onboarding/welcome.tsx's top
 * comment for why: a stale per-device cached arm survived account deletion
 * and could show a deleted-and-recreated account the wrong design).
 *
 * /onboarding/welcome is the PRE-AUTH entry screen — role CTAs plus a "Log In"
 * button. Rendering it to someone who already holds a session tells them their
 * brand-new account doesn't exist and invites them to authenticate a second
 * time. The gate in app/onboarding/index.tsx no longer routes signed-in users
 * here, but this screen is reachable other ways (back gesture, deep link, a
 * session arriving while it is already open), so it defends itself.
 */

import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
}));

const mockAuthContext = { isLoggedIn: false, isLoading: false, session: null as any };
jest.mock('hooks/use-auth-context', () => ({
  useAuthContext: () => mockAuthContext,
}));

const mockUpdateData = jest.fn();
jest.mock('lib/context/onboarding-context', () => ({
  useOnboarding: () => ({
    data: { intent: null },
    updateData: mockUpdateData,
  }),
}));

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn() },
  useHapticFeedback: () => ({ triggerHaptic: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// A lightweight stand-in that still exposes the onLoginPress action, so the
// pre-auth-CTA-visibility assertions below stay meaningful without pulling in
// ProofCard's network/location dependencies.
jest.mock('components/onboarding/PosterFirstWelcome', () => ({
  PosterFirstWelcome: (props: { onLoginPress: () => void }) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity accessibilityLabel="Log in to an existing account" onPress={props.onLoginPress}>
        <Text>Log In</Text>
      </TouchableOpacity>
    );
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OnboardingWelcome = require('../../../app/onboarding/welcome').default;

describe('onboarding welcome auth guard', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockAuthContext.isLoggedIn = false;
    mockAuthContext.isLoading = false;
  });

  it('redirects a signed-in user away instead of asking them to log in again', async () => {
    mockAuthContext.isLoggedIn = true;

    const utils = render(<OnboardingWelcome />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/onboarding'));
    // The pre-auth CTAs must not be on screen, not even for one frame.
    expect(utils.queryByLabelText('Log in to an existing account')).toBeNull();
  });

  it('does not render the pre-auth CTAs while auth is still resolving', () => {
    mockAuthContext.isLoading = true;

    const utils = render(<OnboardingWelcome />);

    expect(utils.queryByLabelText('Log in to an existing account')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the single canonical welcome screen to a logged-out visitor, with no A/B branching', () => {
    const utils = render(<OnboardingWelcome />);

    // Always PosterFirstWelcome now — there is no other design left to fall
    // back to, so this alone is the full regression check for the old bug.
    expect(utils.getByLabelText('Log in to an existing account')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
