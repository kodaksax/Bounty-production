/**
 * Coverage for the onboarding role step (app/onboarding/role-select.tsx).
 *
 * The step is one tap: picking a card records the role and advances. The
 * invariants are that a tap routes to the right next step, that a double tap
 * can't push that step twice, and that nothing is pre-selected on the
 * user's behalf (the answer feeds declared intent).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockFocusEffect: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useFocusEffect: (cb: () => void) => {
    mockFocusEffect = cb;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUpdateData = jest.fn();
let mockIntent: 'poster' | 'hunter' | null = null;
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: mockIntent }, updateData: mockUpdateData }),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

jest.mock('../../../components/onboarding/OnboardingProgressDots', () => ({
  ONBOARDING_TOTAL_STEPS: 5,
  OnboardingProgressDots: () => null,
}));

import RoleSelectScreen from '../../../app/onboarding/role-select';

const POSTER = /^Make today pay\./;
const HUNTER = /^I'd rather earn/;

beforeEach(() => {
  jest.clearAllMocks();
  mockIntent = null;
  mockFocusEffect = null;
});

describe('onboarding role step', () => {
  it('records the poster role and advances in a single tap', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(POSTER));

    expect(mockUpdateData).toHaveBeenCalledWith({ intent: 'poster' });
    expect(mockTrackEvent).toHaveBeenCalledWith('role_selected', {
      role: 'poster',
      surface: 'onboarding',
    });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/founder-note');
  });

  it('routes hunters to payout setup', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(HUNTER));

    expect(mockUpdateData).toHaveBeenCalledWith({ intent: 'hunter' });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/payouts');
  });

  it('ignores a second tap until the screen regains focus', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(POSTER));
    fireEvent.press(getByLabelText(HUNTER));
    expect(mockPush).toHaveBeenCalledTimes(1);

    // Back to this screen to change the answer.
    mockFocusEffect?.();
    fireEvent.press(getByLabelText(HUNTER));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenLastCalledWith('/onboarding/payouts');
  });

  it('pre-selects nothing and has no Continue gate', () => {
    const { getByLabelText, queryByLabelText } = render(<RoleSelectScreen />);
    expect(getByLabelText(POSTER).props.accessibilityState).toEqual({ selected: false });
    expect(getByLabelText(HUNTER).props.accessibilityState).toEqual({ selected: false });
    expect(queryByLabelText('Continue')).toBeNull();
    expect(mockUpdateData).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
