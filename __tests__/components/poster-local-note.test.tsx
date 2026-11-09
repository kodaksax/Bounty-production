/**
 * The one line at the top of the Post tab, and how it sits with the payment
 * line on composer step 1. Flag off must leave today's screen alone.
 */
import { AccessibilityInfo, useWindowDimensions } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

// InfoTooltip calls this; the RN jest preset's mock omits it.
(AccessibilityInfo as unknown as { announceForAccessibility: jest.Mock }).announceForAccessibility =
  jest.fn();

let mockLocalProofOn = true;
let mockPaymentPromiseOn = false;
jest.mock('../../lib/experiments/poster-local-proof', () => ({
  usePosterLocalProof: () => mockLocalProofOn,
}));
jest.mock('../../lib/experiments/payment-promise-copy', () => ({
  usePaymentPromiseCopy: () => mockPaymentPromiseOn,
}));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('../../lib/analytics/trust-content', () => ({ trackTrustContentViewed: jest.fn() }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'user-1' }));
let mockCoords: { latitude: number; longitude: number } | null = { latitude: 34, longitude: -118 };
jest.mock('../../hooks/useFeedLocation', () => ({
  useFeedLocation: () => ({ coords: mockCoords, ready: true }),
}));
const mockLocationHook = jest.fn(() => ({ location: null, permission: { granted: true } }));
jest.mock('../../app/hooks/useLocation', () => ({ useLocation: () => mockLocationHook() }));

let mockServiceability: Record<string, unknown> = {
  serviceable_source: 'gps',
  country_code: 'US',
  is_serviceable_region: true,
};
jest.mock('../../hooks/useServiceability', () => ({
  useServiceability: () => mockServiceability,
}));

let mockRole: string | null = 'poster';
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: { getPrimaryRoleForAnalytics: () => mockRole },
}));

const mockGetProof = jest.fn();
jest.mock('../../lib/services/bounty-location-service', () => ({
  LOCAL_PROOF_MIN: 3,
  getPosterLocalProof: (...a: unknown[]) => mockGetProof(...a),
}));

import { StepTask } from '../../app/screens/CreateBounty/quick/StepTask';
import { PosterLocalNote } from '../../components/poster-local-note';
import { paymentPromiseStrings } from '../../lib/strings/payment-promise';

const PROOF_12 = '12 people nearby are looking for tasks on Bounty this week';
const PROOF_ANY = /people nearby are looking for tasks/;

const note = () => render(<PosterLocalNote lineStyle={{}} linkStyle={{}} />);
const draft = { title: '', description: '', amount: 40, isForHonor: false, category: 'other' } as any;
const step1 = () =>
  render(<StepTask draft={draft} onUpdate={jest.fn()} onNext={jest.fn()} step={1} totalSteps={3} />);

beforeEach(() => {
  jest.clearAllMocks();
  (useWindowDimensions as jest.Mock).mockReturnValue({ width: 375, height: 812, scale: 2, fontScale: 1 });
  mockLocalProofOn = true;
  mockPaymentPromiseOn = false;
  mockRole = 'poster';
  mockCoords = { latitude: 34, longitude: -118 };
  mockServiceability = { serviceable_source: 'gps', country_code: 'US', is_serviceable_region: true };
  mockGetProof.mockResolvedValue({ huntersActive7d: 12, bountiesCompleted30d: null });
});

describe('local proof line', () => {
  it('shows the count at the feed radius', async () => {
    const { findByText } = note();
    expect(await findByText(PROOF_12)).toBeTruthy();
    expect(mockGetProof).toHaveBeenCalledWith({ latitude: 34, longitude: -118, radiusMiles: 25 });
  });

  it('shows the minimum', async () => {
    mockGetProof.mockResolvedValue({ huntersActive7d: 3, bountiesCompleted30d: null });
    const { findByText } = note();
    expect(await findByText('3 people nearby are looking for tasks on Bounty this week')).toBeTruthy();
  });

  it('is one line with no button', async () => {
    const { findByText, UNSAFE_queryAllByProps } = note();
    expect((await findByText(PROOF_12)).props.numberOfLines).toBe(1);
    expect(UNSAFE_queryAllByProps({ accessibilityRole: 'button' })).toHaveLength(0);
  });

  it.each([
    ['suppressed by the server', { huntersActive7d: null, bountiesCompleted30d: null }],
    ['below the minimum', { huntersActive7d: 2, bountiesCompleted30d: null }],
    ['unknown (the RPC failed)', null],
  ])('shows nothing when %s', async (_name, result) => {
    mockGetProof.mockResolvedValue(result);
    const { queryByText, toJSON } = note();
    await waitFor(() => expect(mockGetProof).toHaveBeenCalled());
    await waitFor(() => expect(toJSON()).toBeNull());
    expect(queryByText(PROOF_ANY)).toBeNull();
  });

  it('shows nothing without a location', async () => {
    mockCoords = null;
    const { toJSON } = note();
    await waitFor(() => expect(toJSON()).toBeNull());
    expect(mockGetProof).not.toHaveBeenCalled();
  });

  it.each(['hunter', 'both', null])('does not ask for role %s', async role => {
    mockRole = role;
    const { toJSON } = note();
    await waitFor(() => expect(toJSON()).toBeNull());
    expect(mockGetProof).not.toHaveBeenCalled();
  });

  it('an unknown location still shows the proof, and no waitlist', async () => {
    mockServiceability = { serviceable_source: 'unknown' };
    const { findByText, queryByText } = note();
    expect(await findByText(PROOF_12)).toBeTruthy();
    expect(queryByText(/waitlist/)).toBeNull();
  });
});

describe('out-of-area line', () => {
  beforeEach(() => {
    mockServiceability = {
      serviceable_source: 'gps',
      country_code: 'MX',
      region: 'Qro.',
      is_serviceable_region: false,
    };
  });

  it('is one line, replaces the proof, and fetches no count', async () => {
    const { getByLabelText, queryByText } = note();
    expect(getByLabelText("Bounty isn't live here yet. Join the waitlist").props.numberOfLines).toBe(1);
    expect(queryByText(PROOF_ANY)).toBeNull();
    expect(mockGetProof).not.toHaveBeenCalled();
  });

  it('opens the waitlist outside the onboarding layout', () => {
    const { getByLabelText } = note();
    fireEvent.press(getByLabelText("Bounty isn't live here yet. Join the waitlist"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/waitlist',
      params: { country_code: 'MX', region: 'Qro.' },
    });
  });

  it('works from an IP country too', () => {
    mockServiceability = { serviceable_source: 'ip', country_code: 'NG', is_serviceable_region: false };
    const { getByLabelText } = note();
    expect(getByLabelText("Bounty isn't live here yet. Join the waitlist")).toBeTruthy();
  });
});

describe('composer step 1', () => {
  it('flag off: no note, no location lookup', () => {
    mockLocalProofOn = false;
    const { queryByText } = step1();
    expect(queryByText(PROOF_ANY)).toBeNull();
    expect(mockLocationHook).not.toHaveBeenCalled();
    expect(mockGetProof).not.toHaveBeenCalled();
  });

  describe.each([
    ['flag on, short phone, email banner', true, 667, false, 1],
    ['flag on, short phone, no banner', true, 667, true, undefined],
    ['flag on, tall phone, email banner', true, 812, false, undefined],
    ['flag off, short phone, email banner', false, 667, false, undefined],
  ])('%s', (_name, flag, height, tintStatusBar, titleLines) => {
    it('sizes the headline', () => {
      mockLocalProofOn = flag;
      (useWindowDimensions as jest.Mock).mockReturnValue({ width: 375, height, scale: 2, fontScale: 1 });
      const { getByText } = render(
        <StepTask
          draft={draft}
          onUpdate={jest.fn()}
          onNext={jest.fn()}
          step={1}
          totalSteps={3}
          tintStatusBar={tintStatusBar}
        />
      );
      expect(getByText('What do you need done?').props.numberOfLines).toBe(titleLines);
    });
  });

  it('flag off: the payment line is unchanged', () => {
    mockLocalProofOn = false;
    mockPaymentPromiseOn = true;
    const { getByText } = step1();
    expect(getByText(paymentPromiseStrings.stepTaskLine)).toBeTruthy();
  });

  it('flag on: the proof and payment line share one block', async () => {
    mockPaymentPromiseOn = true;
    const { findByText, getByText } = step1();
    const proof = await findByText(PROOF_12);
    const payment = getByText(paymentPromiseStrings.stepTaskLine);
    // Compared with === because a failing toBe would pretty-print the whole tree.
    const nearestView = (node: any) => {
      let current = node;
      while (current && current.type !== 'View') current = current.parent;
      return current;
    };
    expect(nearestView(proof) === nearestView(payment)).toBe(true);
  });

  it('flag on, count suppressed: only the payment line shows', async () => {
    mockPaymentPromiseOn = true;
    mockGetProof.mockResolvedValue({ huntersActive7d: null, bountiesCompleted30d: null });
    const { getByText, queryByText } = step1();
    await waitFor(() => expect(mockGetProof).toHaveBeenCalled());
    expect(getByText(paymentPromiseStrings.stepTaskLine)).toBeTruthy();
    expect(queryByText(PROOF_ANY)).toBeNull();
  });
});
