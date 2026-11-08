/**
 * The `poster-home` onboarding order, screen by screen. Flag-off behaviour is
 * pinned by each screen's own test file, which runs with the flag off.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BountyFormatProvider } from '../../../lib/bounty-format-context';

const mockPush = jest.fn();
const mockRedirect = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => false }),
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let mockPosterHome: boolean | null = true;
jest.mock('../../../lib/onboarding/poster-home', () => ({
  ...jest.requireActual('../../../lib/onboarding/poster-home'),
  usePosterHomeDecision: () => mockPosterHome,
}));

let mockIntent: 'poster' | 'hunter' | null = null;
const mockUpdateData = jest.fn();
jest.mock('../../../lib/context/onboarding-context', () => ({
  useOnboarding: () => ({ data: { intent: mockIntent }, updateData: mockUpdateData }),
}));

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

const mockUpdateProfile = jest.fn(() => Promise.resolve({ id: 'user-1' }));
jest.mock('../../../lib/services/auth-profile-service', () => ({
  authProfileService: { updateProfile: (...args: unknown[]) => mockUpdateProfile(...(args as [])) },
}));

jest.mock('../../../lib/haptic-feedback', () => ({
  hapticFeedback: { light: jest.fn(), success: jest.fn(), error: jest.fn(), medium: jest.fn() },
}));

const mockDots = jest.fn();
jest.mock('../../../components/onboarding/OnboardingProgressDots', () => ({
  ONBOARDING_TOTAL_STEPS: 5,
  OnboardingProgressDots: (props: { activeIndex: number }) => {
    mockDots(props.activeIndex);
    return null;
  },
}));

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

jest.mock('../../../components/ui/keyboard-avoiding', () => {
  const { View } = require('react-native');
  return { KeyboardAwareScrollView: View, KeyboardAvoidingScreen: View };
});

jest.mock('../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: null }),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ insert: jest.fn() })) },
}));

import LocationScreen from '../../../app/onboarding/location';
import RoleSelectScreen from '../../../app/onboarding/role-select';
import StyleStep from '../../../app/onboarding/style';
import WaitlistScreen from '../../../app/onboarding/waitlist';

const POSTER_CARD = /^Get something done\./;
const HUNTER_CARD = /^Earn nearby\./;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderStyle() {
  return render(
    <BountyFormatProvider>
      <StyleStep />
    </BountyFormatProvider>
  );
}

const styleStepViewed = () =>
  mockTrackEvent.mock.calls.filter(([event]) => event === 'onboarding_style_step_viewed');

beforeEach(() => {
  jest.clearAllMocks();
  mockPosterHome = true;
  mockIntent = null;
  mockParams = {};
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  mockLocationService.requestPermission.mockResolvedValue({ granted: true });
  mockLocationService.getCurrentLocation.mockResolvedValue({ latitude: 40.7, longitude: -73.9 });
  mockLocationService.reverseGeocodeWithRegion.mockResolvedValue({
    address: '12 Main St, Brooklyn, NY, 11211',
    countryCode: 'US',
    region: 'NY',
  });
});

describe('role step, flag on', () => {
  it('shows the new copy with the hiring option first', () => {
    const { getAllByLabelText, getByLabelText, queryByLabelText } = render(<RoleSelectScreen />);
    const cards = getAllByLabelText(/ — /).map(b => b.props.accessibilityLabel);
    expect(cards[0]).toMatch(POSTER_CARD);
    expect(cards[1]).toMatch(HUNTER_CARD);
    expect(getByLabelText(POSTER_CARD)).toBeTruthy();
    expect(queryByLabelText(/^Make today pay\./)).toBeNull();
  });

  it('sends posters to location, past the feed-layout screen', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(POSTER_CARD));
    expect(mockPush).toHaveBeenCalledWith('/onboarding/location');
  });

  it('sends hunters to the feed-layout screen', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(HUNTER_CARD));
    expect(mockPush).toHaveBeenCalledWith('/onboarding/style?after_role=1');
  });

  it('still saves the role through the path that fires role_changed', () => {
    const { getByLabelText } = render(<RoleSelectScreen />);
    fireEvent.press(getByLabelText(HUNTER_CARD));
    expect(mockUpdateProfile).toHaveBeenCalledWith(
      { primary_role: 'hunter' },
      { roleChangeSource: 'onboarding' }
    );
  });

  it('is the first step after the account is made', () => {
    render(<RoleSelectScreen />);
    expect(mockDots).toHaveBeenLastCalledWith(1);
  });
});

describe('feed-layout step', () => {
  it('sends anyone arriving straight from sign-up to the role step', async () => {
    renderStyle();
    await flush();
    expect(mockRedirect).toHaveBeenCalledWith('/onboarding/role-select');
    expect(styleStepViewed()).toHaveLength(0);
  });

  it('shows to a hunter coming from the role step', async () => {
    mockParams = { after_role: '1' };
    const { getByText } = renderStyle();
    await flush();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(getByText('Make Bounty feel like yours')).toBeTruthy();
    expect(mockDots).toHaveBeenLastCalledWith(2);
  });

  it('waits rather than flashing either screen while the flag is unknown', async () => {
    mockPosterHome = null;
    const { queryByText } = renderStyle();
    await flush();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(queryByText('Make Bounty feel like yours')).toBeNull();
  });

  it('shows as the first step with the flag off', async () => {
    mockPosterHome = false;
    const { getByText } = renderStyle();
    await flush();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(getByText('Make Bounty feel like yours')).toBeTruthy();
    expect(mockDots).toHaveBeenLastCalledWith(1);
  });
});

describe('location step, flag on', () => {
  it('words the request for posters and moves on to the poster profile', async () => {
    mockIntent = 'poster';
    const { getByText, getByLabelText } = render(<LocationScreen />);
    expect(getByText('Allow location so nearby hunters can see your task')).toBeTruthy();
    expect(getByLabelText('Not now')).toBeTruthy();

    fireEvent.press(getByLabelText('Allow location'));
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/poster-profile');
  });

  it('words the request for hunters and moves on to payouts', async () => {
    mockIntent = 'hunter';
    const { getByText, getByLabelText, queryByText } = render(<LocationScreen />);
    expect(getByText('Allow location to see the closest bounties')).toBeTruthy();
    expect(queryByText(/put what you post/)).toBeNull();

    fireEvent.press(getByLabelText('Allow location'));
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/payouts');
  });

  it('keeps today\'s wording and goes to the role step with the flag off', async () => {
    mockPosterHome = false;
    mockIntent = 'poster';
    const { getByText, getByLabelText } = render(<LocationScreen />);
    expect(getByText(/put what you post in front of the people nearest to it/)).toBeTruthy();

    fireEvent.press(getByLabelText('Allow location'));
    await flush();
    expect(mockPush).toHaveBeenCalledWith('/onboarding/role-select');
  });

  it('skips the role step after the waitlist, since it has been answered', () => {
    mockIntent = 'poster';
    mockParams = { country_code: 'GB' };
    const { getByLabelText } = render(<WaitlistScreen />);
    fireEvent.press(getByLabelText('Continue anyway'));
    expect(mockPush).toHaveBeenCalledWith('/onboarding/poster-profile');
  });
});
