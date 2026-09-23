/**
 * The founder note is the last screen of onboarding, so its Continue button is
 * the funnel's only completion point: it runs useCompleteOnboarding, which
 * writes onboarding_completed and navigates into the app.
 *
 * This is the regression that would be invisible until a real signup: if
 * Continue ever goes back to pushing a next screen, the flag is never written
 * and app/tabs/bounty-app.tsx bounces the user straight back into onboarding,
 * forever. So: Continue completes, and it can't be fired twice.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: 'hunter' }, updateData: jest.fn() }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

const mockComplete = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../hooks/useCompleteOnboarding', () => ({
  useCompleteOnboarding: jest.fn(() => ({
    complete: mockComplete,
    isLoading: false,
    hasNavigatedRef: { current: false },
  })),
}));

import FounderNoteScreen from '../../../app/onboarding/founder-note';
import { useCompleteOnboarding } from '../../../hooks/useCompleteOnboarding';
import { founderNoteStrings } from '../../../lib/strings/founderNote';

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockComplete.mockResolvedValue(undefined);
  // Reduce Motion, so the CTA is enabled on mount and the test isn't timing the
  // typewriter to get at it.
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
});

describe('founder note completion', () => {
  it('completes onboarding into the app rather than pushing another screen', async () => {
    const { getByLabelText } = render(<FounderNoteScreen />);
    await flush();

    fireEvent.press(getByLabelText(founderNoteStrings.primaryCta));
    await flush();

    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(useCompleteOnboarding).toHaveBeenCalledWith('/tabs/bounty-app');
  });

  it('disables Continue while completion is in flight', async () => {
    (useCompleteOnboarding as jest.Mock).mockReturnValue({
      complete: mockComplete,
      isLoading: true,
      hasNavigatedRef: { current: false },
    });

    const { getByLabelText } = render(<FounderNoteScreen />);
    await flush();

    // Asserted on accessibilityState rather than by pressing: TouchableOpacity
    // is a bare string in the shared RN mock, so fireEvent.press would call
    // onPress straight through regardless of `disabled` and prove nothing. The
    // real double-fire guard lives in useCompleteOnboarding (hasNavigatedRef).
    expect(getByLabelText(founderNoteStrings.primaryCta).props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
