/**
 * Regression coverage for the onboarding style-selection screen
 * (app/onboarding/style.tsx). Written after a reported bug where the
 * Compact-layout preview didn't render on the first selection — the user
 * had to tap Compact a second time before the correct infographic showed.
 *
 * Root cause: the preview lived inside a swipeable pager and was only made
 * visible by an imperative scrollTo() call; the chip's "selected" highlight
 * was (correctly) driven declaratively by state, so the two could disagree
 * — especially right after mount, since ScrollView's `contentOffset` prop
 * only applies once, before AsyncStorage hydration has necessarily
 * resolved. The fix renders a single preview bound directly to
 * `bountyFormat`, so it can never lag behind the selected/highlighted
 * state, regardless of scroll timing.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BountyFormatProvider } from '../../../lib/bounty-format-context';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: null } }),
}));

jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

jest.mock('../../../components/onboarding/OnboardingProgressDots', () => ({
  OnboardingProgressDots: () => null,
}));

import StyleScreen from '../../../app/onboarding/style';

function renderStyleScreen() {
  return render(
    <BountyFormatProvider>
      <StyleScreen />
    </BountyFormatProvider>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('StyleScreen preview/selection sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('shows the card preview by default before hydration resolves', async () => {
    const { getByLabelText } = renderStyleScreen();
    await flush();
    expect(getByLabelText('Preview of the card bounty layout')).toBeTruthy();
  });

  it('updates the preview to Compact on the very first tap — no second tap required', async () => {
    const { getByLabelText, getByText } = renderStyleScreen();
    await flush();

    fireEvent.press(getByLabelText('Compact layout'));
    await flush();

    // The preview must already reflect Compact after exactly one press.
    expect(getByLabelText('Preview of the compact bounty layout')).toBeTruthy();
    // Sanity: compact-specific content is present (from SAMPLE_BOUNTIES rows).
    expect(getByText('Yard Cleanup')).toBeTruthy();
  });

  it('keeps the preview in sync with the chip highlight across every option, single tap each', async () => {
    const { getByLabelText } = renderStyleScreen();
    await flush();

    for (const [chipLabel, previewLabel] of [
      ['Grid layout', 'Preview of the grid bounty layout'],
      ['Compact layout', 'Preview of the compact bounty layout'],
      ['Card layout', 'Preview of the card bounty layout'],
      ['Grid layout', 'Preview of the grid bounty layout'],
    ] as const) {
      fireEvent.press(getByLabelText(chipLabel));
      // eslint-disable-next-line no-await-in-loop
      await flush();
      expect(getByLabelText(previewLabel)).toBeTruthy();
      expect(getByLabelText(chipLabel).props.accessibilityState.checked).toBe(true);
    }
  });

  it('restores the correct preview immediately when a saved preference hydrates after mount (no tap at all)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('compact');

    const { getByLabelText } = renderStyleScreen();
    // Hydration resolves asynchronously, same as in the app.
    await flush();

    expect(getByLabelText('Preview of the compact bounty layout')).toBeTruthy();
    expect(getByLabelText('Compact layout').props.accessibilityState.checked).toBe(true);
  });
});
