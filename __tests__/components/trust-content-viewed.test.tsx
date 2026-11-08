/**
 * trust_content_viewed from the explainer screens (the step 1 tooltip is
 * covered in composer-funnel-events.test.tsx).
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

const mockTrackEvent = jest.fn();
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../hooks/useSafeBack', () => ({
  PROFILE_FALLBACK: '/profile',
  useSafeBack: () => jest.fn(),
}));
jest.mock('../../components/ui/settings-screen-header', () => ({ SettingsScreenHeader: () => null }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));

import HowItWorksRoute from '../../app/legal/how-it-works';
import VerificationOnboardingExplainerScreen from '../../app/verification/onboarding-explainer';
import { EscrowExplainer } from '../../components/ui/escrow-explainer';
import { consumeTrustContentSurface, markTrustContentSurface } from '../../lib/analytics/trust-content';

const viewed = () =>
  mockTrackEvent.mock.calls.filter((c) => c[0] === 'trust_content_viewed').map((c) => c[1]);

const layoutOf = (y: number, height = 100) => ({ nativeEvent: { layout: { x: 0, y, width: 300, height } } });

beforeEach(() => {
  jest.clearAllMocks();
  consumeTrustContentSurface();
});

describe('/legal/how-it-works', () => {
  it('reports the open with the surface that sent the poster there', () => {
    markTrustContentSurface('composer_pay');
    render(<HowItWorksRoute />);
    expect(viewed()).toEqual([{ topic: 'how_it_works', surface: 'composer_pay' }]);
  });

  it("falls back to 'unknown' for an entry path that didn't say, and consumes the surface once", () => {
    markTrustContentSurface('welcome');
    const first = render(<HowItWorksRoute />);
    first.unmount();
    render(<HowItWorksRoute />);
    expect(viewed().map((e) => e.surface)).toEqual(['welcome', 'unknown']);
  });

  it('reports each section once, as it comes on screen', () => {
    markTrustContentSurface('help_support');
    const { getByTestId } = render(<HowItWorksRoute />);
    const scroll = getByTestId('how-it-works-scroll');

    fireEvent(scroll, 'layout', layoutOf(0, 600));
    fireEvent(getByTestId('how-it-works-section-escrow'), 'layout', layoutOf(200));
    fireEvent(getByTestId('how-it-works-section-dispute'), 'layout', layoutOf(1400));

    expect(viewed().map((e) => e.topic)).toEqual(['how_it_works', 'escrow']);

    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 1000 } } });
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 1100 } } });

    expect(viewed()).toEqual([
      { topic: 'how_it_works', surface: 'help_support' },
      { topic: 'escrow', surface: 'help_support' },
      { topic: 'dispute', surface: 'help_support' },
    ]);
  });

  it('has no review section, so never reports a review topic', () => {
    const { queryByTestId } = render(<HowItWorksRoute />);
    expect(queryByTestId('how-it-works-section-review')).toBeNull();
  });
});

describe('verification explainer', () => {
  it('reports the open once, with its surface', () => {
    markTrustContentSurface('profile_checklist');
    const { rerender } = render(<VerificationOnboardingExplainerScreen />);
    rerender(<VerificationOnboardingExplainerScreen />);
    expect(viewed()).toEqual([{ topic: 'verification', surface: 'profile_checklist' }]);
  });
});

describe('escrow explainer', () => {
  it('reports when "Learn how it works" opens the modal, not on render', () => {
    const { getByLabelText } = render(<EscrowExplainer analyticsSurface="poster_funding" />);
    expect(viewed()).toEqual([]);

    fireEvent.press(getByLabelText('Learn how escrow protection works'));

    expect(viewed()).toEqual([{ topic: 'escrow', surface: 'poster_funding' }]);
  });
});
