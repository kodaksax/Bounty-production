/**
 * Coverage for the standalone onboarding location step
 * (app/onboarding/location.tsx), which sits between the style step and role
 * select.
 *
 * The invariants worth pinning down are the ones that would silently strand a
 * user or over-collect their data: every answer (grant, coarse grant, denial,
 * skip) must record its precision and advance to role select, and the
 * "Only use approximate" path must never resolve a street-level address.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUpdateData = jest.fn();
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: 'hunter' }, updateData: mockUpdateData }),
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

// react-native-svg's touchable mixin doesn't load under the RN jest preset;
// the compass mark is pure artwork, so stub the primitives it draws with.
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Circle: 'Circle',
  G: 'G',
  Line: 'Line',
  Path: 'Path',
}));

const mockLocationService = {
  requestPermission: jest.fn(),
  getCurrentLocation: jest.fn(),
  reverseGeocodeWithRegion: jest.fn(),
  reverseGeocodeRegion: jest.fn(),
};
jest.mock('../../../lib/services/location-service', () => ({
  locationService: mockLocationService,
}));

import LocationScreen from '../../../app/onboarding/location';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationService.requestPermission.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: 'granted',
  });
  mockLocationService.getCurrentLocation.mockResolvedValue({ latitude: 40.7, longitude: -73.9 });
  mockLocationService.reverseGeocodeWithRegion.mockResolvedValue({
    address: '12 Main St, Brooklyn, NY, 11211',
    countryCode: 'US',
    region: 'NY',
    city: 'Brooklyn',
  });
  mockLocationService.reverseGeocodeRegion.mockResolvedValue({
    countryCode: 'US',
    region: 'NY',
    city: 'Brooklyn',
  });
});

describe('onboarding location step', () => {
  it('stores the precise address and advances on Allow location', async () => {
    const { getByLabelText } = render(<LocationScreen />);
    fireEvent.press(getByLabelText('Allow location'));
    await flush();

    expect(mockUpdateData).toHaveBeenCalledWith({
      locationPrecision: 'precise',
      location: '12 Main St, Brooklyn, NY, 11211',
    });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  it('keeps only a city/region label on the approximate path', async () => {
    const { getByLabelText } = render(<LocationScreen />);
    fireEvent.press(getByLabelText('Only use approximate location'));
    await flush();

    expect(mockLocationService.reverseGeocodeWithRegion).not.toHaveBeenCalled();
    expect(mockUpdateData).toHaveBeenCalledWith({
      locationPrecision: 'approximate',
      location: 'Brooklyn, NY',
    });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  it('advances anyway when the OS prompt is denied', async () => {
    mockLocationService.requestPermission.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      status: 'denied',
    });

    const { getByLabelText } = render(<LocationScreen />);
    fireEvent.press(getByLabelText('Allow location'));
    await flush();

    expect(mockLocationService.getCurrentLocation).not.toHaveBeenCalled();
    expect(mockUpdateData).toHaveBeenCalledWith({ locationPrecision: 'denied', location: '' });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  it('records a skip without touching the location services', async () => {
    const { getByLabelText } = render(<LocationScreen />);
    fireEvent.press(getByLabelText('Not now - you will see online bounties only'));
    await flush();

    expect(mockLocationService.requestPermission).not.toHaveBeenCalled();
    expect(mockUpdateData).toHaveBeenCalledWith({ locationPrecision: 'skipped', location: '' });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  it('advances on a granted permission whose position fix fails', async () => {
    mockLocationService.getCurrentLocation.mockResolvedValue(null);

    const { getByLabelText } = render(<LocationScreen />);
    fireEvent.press(getByLabelText('Allow location'));
    await flush();

    expect(mockUpdateData).toHaveBeenCalledWith({ locationPrecision: 'precise', location: '' });
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  describe('unserviceable region', () => {
    it('sends a precise fix outside the US to the waitlist, still storing the address', async () => {
      mockLocationService.reverseGeocodeWithRegion.mockResolvedValue({
        address: '10 Downing St, London, England, SW1A 2AA',
        countryCode: 'GB',
        region: 'England',
        city: 'London',
      });

      const { getByLabelText } = render(<LocationScreen />);
      fireEvent.press(getByLabelText('Allow location'));
      await flush();

      expect(mockUpdateData).toHaveBeenCalledWith({
        locationPrecision: 'precise',
        location: '10 Downing St, London, England, SW1A 2AA',
      });
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/onboarding/waitlist',
        params: { country_code: 'GB', region: 'England' },
      });
      expect(mockPush).not.toHaveBeenCalledWith('/onboarding/role-select');
    });

    it('sends an approximate fix outside the US to the waitlist', async () => {
      mockLocationService.reverseGeocodeRegion.mockResolvedValue({
        countryCode: 'ca',
        region: 'Ontario',
        city: 'Toronto',
      });

      const { getByLabelText } = render(<LocationScreen />);
      fireEvent.press(getByLabelText('Only use approximate location'));
      await flush();

      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/onboarding/waitlist',
        params: { country_code: 'ca', region: 'Ontario' },
      });
    });

    it('never shows the waitlist when the country is unknown', async () => {
      mockLocationService.reverseGeocodeWithRegion.mockResolvedValue({
        address: 'Somewhere',
        countryCode: undefined,
      });

      const { getByLabelText } = render(<LocationScreen />);
      fireEvent.press(getByLabelText('Allow location'));
      await flush();

      expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
    });
  });
});
