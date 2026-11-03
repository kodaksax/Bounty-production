/**
 * Own-profile hunter checklist: routes each step to the screen that completes
 * it, and never offers a tap that leads nowhere.
 */
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

const mockPush = jest.fn();
const mockTrackEvent = jest.fn(() => Promise.resolve());

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...(args as [])) },
}));

import { HunterProfileChecklist } from '../../components/ui/hunter-profile-checklist';

beforeEach(() => {
  mockPush.mockClear();
  mockTrackEvent.mockClear();
});

describe('HunterProfileChecklist', () => {
  test('renders nothing once every step is done', () => {
    const { toJSON } = render(
      <HunterProfileChecklist
        input={{
          stripe_identity_status: 'verified',
          bio: 'Hi',
          skills: ['Moving'],
          avatar_url: 'https://example.com/a.jpg',
          payouts_enabled: true,
        }}
      />
    );
    expect(toJSON()).toBeNull();
  });

  test('an unfinished ID session reads as "finish", not "rejected"', () => {
    const { getByText, queryByText } = render(
      <HunterProfileChecklist input={{ stripe_identity_status: 'requires_input' }} />
    );
    expect(getByText('Finish verifying your ID')).toBeTruthy();
    expect(queryByText(/rejected|resubmit/i)).toBeNull();
    expect(getByText('4 steps left')).toBeTruthy();
  });

  test.each([
    ['id_verification', '/verification/onboarding-explainer'],
    ['bio_and_skills', '/profile/edit'],
    ['photo', '/profile/edit'],
    ['payouts', '/wallet/connect/embedded-onboarding'],
  ])('tapping %s routes to %s and is tracked', (id, route) => {
    const { getByTestId } = render(<HunterProfileChecklist input={{}} />);
    fireEvent.press(getByTestId(`hunter-checklist-${id}`));
    expect(mockPush).toHaveBeenCalledWith(route);
    expect(mockTrackEvent).toHaveBeenCalledWith('profile_checklist_item_tapped', { item: id, state: 'todo' });
  });

  test('done and in-review steps are not tappable', () => {
    const { getByTestId } = render(
      <HunterProfileChecklist input={{ stripe_identity_status: 'processing', avatar_url: 'https://example.com/a.jpg' }} />
    );
    // jest.setup.js mocks TouchableOpacity as a host string, so `disabled`
    // isn't honoured by fireEvent -- assert the a11y state and press anyway.
    for (const id of ['id_verification', 'photo']) {
      const row = getByTestId(`hunter-checklist-${id}`);
      expect(row.props.accessibilityState.disabled).toBe(true);
      fireEvent.press(row);
    }
    expect(mockPush).not.toHaveBeenCalled();
  });

  test('never shows a phone step, since no phone-verification screen exists', () => {
    const { queryByTestId } = render(<HunterProfileChecklist input={{}} />);
    expect(queryByTestId('hunter-checklist-phone')).toBeNull();
  });
});
