// Acceptance root-cause instrumentation (2026-11-05): application_viewed and
// application_dismissed.
//
// The point of these events is to tell "posters aren't coming back to look"
// apart from "posters look and walk away". The invariants under test:
//
//   * a list row only counts as viewed while the poster can actually see the
//     list (not while the Inbox sits preloaded off-screen), once per
//     application per surface per session;
//   * in the bounty thread every foreground visit is one view, and leaving
//     without accepting, passing or messaging is one dismissal;
//   * engaging (accept / pass / message) means no dismissal, including after
//     an Accept that backgrounds the app for Apple Pay;
//   * the application stopping being pending while open is never a dismissal.

import { act, renderHook } from '@testing-library/react-native';

const mockTrackEvent = jest.fn(() => Promise.resolve());
let mockIsScreenFocused = true;

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => (mockTrackEvent as any)(...args) },
}));
jest.mock('hooks/useRouteFocus', () => ({
  useIsScreenFocused: () => mockIsScreenFocused,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native');
const mockAppStateListen = RN.AppState.addEventListener as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useApplicationListViews } = require('hooks/useApplicationListViews');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useApplicationDecisionVisit } = require('hooks/useApplicationDecisionVisit');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __resetApplicationViewFlagsForTests } = require('lib/analytics/sessionFlags');

const HOUR = 3_600_000;

function makeRequest(id: string, bountyId = 'b1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    bounty_id: bountyId,
    hunter_id: `h-${id}`,
    status: 'pending',
    message: 'I can do this tomorrow',
    distance_mi: 3,
    created_at: new Date(Date.now() - 5 * HOUR).toISOString(),
    bounty: { id: bountyId, amount: 40, is_for_honor: false, trust_tier: 'standard' },
    profile: { username: 'ada', hunterCompleted: 2 },
    ...overrides,
  } as any;
}

const events = (name: string) =>
  (mockTrackEvent.mock.calls as any[]).filter(c => c[0] === name).map(c => c[1]);

const appStateListener = () => mockAppStateListen.mock.calls.find(c => c[0] === 'change')?.[1];

beforeEach(() => {
  mockTrackEvent.mockClear();
  mockAppStateListen.mockClear();
  mockIsScreenFocused = true;
  __resetApplicationViewFlagsForTests();
  RN.AppState.currentState = 'active';
});

describe('useApplicationListViews (inbox_list / requests_list)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const r1 = makeRequest('r1');
  const r2 = makeRequest('r2');
  const r3 = makeRequest('r3', 'b2');
  const rows = [{ app: r1 }, { app: null }, { app: r2 }, { app: r3 }];

  function render(enabled: boolean) {
    return renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useApplicationListViews({
          surface: 'inbox_list',
          enabled,
          bountyRequests: [r1, r2, r3],
          getApplication: (row: { app: any }) => row.app,
        }),
      { initialProps: { enabled } }
    );
  }

  const show = (result: any, items: unknown[]) =>
    act(() =>
      result.current.onViewableItemsChanged({
        viewableItems: items.map((item, index) => ({ item, index, isViewable: true, key: String(index) })),
        changed: [],
      })
    );
  const waitForExposure = () => act(() => jest.advanceTimersByTime(250));

  test('reports each visible application once, with its bounty’s applicant count', () => {
    const { result } = render(true);
    show(result, rows);
    waitForExposure();

    const viewed = events('application_viewed');
    expect(viewed.map(p => p.application_id)).toEqual(['r1', 'r2', 'r3']);
    expect(viewed[0]).toMatchObject({
      surface: 'inbox_list',
      role: 'poster',
      bounty_id: 'b1',
      hunter_id: 'h-r1',
      applicant_count: 2,
      has_message: true,
      applicant_distance_mi: 3,
      first_view_this_session: true,
    });
    expect(viewed[0].application_age_hours).toBeCloseTo(5, 0);
    expect(viewed[2]).toMatchObject({ bounty_id: 'b2', applicant_count: 1 });
    // The message is a yes/no, never its text.
    expect(JSON.stringify(viewed)).not.toContain('tomorrow');

    // Scrolling the same rows out and back in does not refire.
    show(result, []);
    show(result, rows);
    waitForExposure();
    expect(events('application_viewed')).toHaveLength(3);
  });

  test('rows on screen while the list is hidden are reported when it becomes visible, not before', () => {
    const { result, rerender } = render(false);
    show(result, [rows[0]]);
    expect(events('application_viewed')).toHaveLength(0);

    rerender({ enabled: true });
    waitForExposure();
    expect(events('application_viewed').map(p => p.application_id)).toEqual(['r1']);
  });

  test('rows that scrolled off while hidden are not reported later', () => {
    const { result, rerender } = render(false);
    show(result, [rows[0]]);
    show(result, [rows[2]]);
    rerender({ enabled: true });
    waitForExposure();
    expect(events('application_viewed').map(p => p.application_id)).toEqual(['r2']);
  });

  test('ignores applications that are no longer pending', () => {
    const { result } = render(true);
    show(result, [{ app: makeRequest('r9', 'b1', { status: 'accepted' }) }]);
    expect(events('application_viewed')).toHaveLength(0);
  });

  test('handler and config keep their identity across renders (FlatList requirement)', () => {
    const { result, rerender } = render(true);
    const first = result.current;
    rerender({ enabled: false });
    expect(result.current.onViewableItemsChanged).toBe(first.onViewableItemsChanged);
    expect(result.current.viewabilityConfig).toBe(first.viewabilityConfig);
  });

  test('hidden time does not satisfy the visible exposure interval', () => {
    const { result } = render(true);
    show(result, [rows[0]]);
    act(() => jest.advanceTimersByTime(100));
    act(() => appStateListener()('background'));
    act(() => jest.advanceTimersByTime(500));
    expect(events('application_viewed')).toHaveLength(0);

    act(() => appStateListener()('active'));
    act(() => jest.advanceTimersByTime(249));
    expect(events('application_viewed')).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(events('application_viewed').map(p => p.application_id)).toEqual(['r1']);
  });

  test('route blur cancels exposure and focus restarts it from zero', () => {
    const { result, rerender } = render(true);
    show(result, [rows[0]]);
    act(() => jest.advanceTimersByTime(100));

    mockIsScreenFocused = false;
    rerender({ enabled: true });
    act(() => jest.advanceTimersByTime(500));
    expect(events('application_viewed')).toHaveLength(0);

    mockIsScreenFocused = true;
    rerender({ enabled: true });
    act(() => jest.advanceTimersByTime(249));
    expect(events('application_viewed')).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(events('application_viewed').map(p => p.application_id)).toEqual(['r1']);
  });
});

describe('useApplicationDecisionVisit (bounty_thread)', () => {
  function render(request: any, enabled = true) {
    return renderHook(
      ({ request, enabled }: { request: any; enabled: boolean }) =>
        useApplicationDecisionVisit({ request, enabled }),
      { initialProps: { request, enabled } }
    );
  }

  test('opening then leaving without acting is one view and one dismissal', () => {
    const { unmount } = render(makeRequest('r1'));
    expect(events('application_viewed')).toEqual([
      expect.objectContaining({ application_id: 'r1', surface: 'bounty_thread', first_view_this_session: true }),
    ]);

    unmount();
    const dismissed = events('application_dismissed');
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]).toMatchObject({
      application_id: 'r1',
      bounty_id: 'b1',
      hunter_id: 'h-r1',
      surface: 'bounty_thread',
      trigger: 'leave',
    });
    expect(dismissed[0].dwell_ms).toEqual(expect.any(Number));
  });

  test.each(['accept', 'decline', 'message'] as const)('after %s, leaving is not a dismissal', action => {
    const { result, unmount } = render(makeRequest('r1'));
    act(() => result.current.markEngaged(action));
    unmount();
    expect(events('application_dismissed')).toHaveLength(0);
  });

  test('backgrounding ends the visit as a dismissal; returning starts a new view', () => {
    const { unmount } = render(makeRequest('r1'));
    act(() => appStateListener()('background'));
    expect(events('application_dismissed')).toEqual([expect.objectContaining({ trigger: 'background' })]);

    act(() => appStateListener()('active'));
    expect(events('application_viewed')).toHaveLength(2);
    expect(events('application_viewed')[1].first_view_this_session).toBe(false);

    unmount();
    expect(events('application_dismissed').map(p => p.trigger)).toEqual(['background', 'leave']);
  });

  test('route blur ends the visit and foregrounding while covered does not start another', () => {
    const request = makeRequest('r1');
    const { rerender, unmount } = render(request);
    mockIsScreenFocused = false;
    rerender({ request, enabled: true });
    expect(events('application_dismissed').map(p => p.trigger)).toEqual(['leave']);

    act(() => appStateListener()('background'));
    act(() => appStateListener()('active'));
    expect(events('application_viewed')).toHaveLength(1);

    mockIsScreenFocused = true;
    rerender({ request, enabled: true });
    expect(events('application_viewed')).toHaveLength(2);
    unmount();
    expect(events('application_dismissed').map(p => p.trigger)).toEqual(['leave', 'leave']);
  });

  test('an Accept that backgrounds the app (Apple Pay) is never counted as a dismissal or a re-view', () => {
    const { result, unmount } = render(makeRequest('r1'));
    act(() => result.current.markEngaged('accept'));
    act(() => appStateListener()('background'));
    act(() => appStateListener()('active'));
    unmount();
    expect(events('application_viewed')).toHaveLength(1);
    expect(events('application_dismissed')).toHaveLength(0);
  });

  test('the application stopping being pending while open is not a dismissal', () => {
    const request = makeRequest('r1');
    const { rerender, unmount } = render(request);
    rerender({ request: { ...request, status: 'withdrawn' }, enabled: false });
    unmount();
    expect(events('application_dismissed')).toHaveLength(0);
  });

  test('a reload of the same application does not restart the visit', () => {
    const request = makeRequest('r1');
    const { rerender } = render(request);
    rerender({ request: { ...request }, enabled: true });
    expect(events('application_viewed')).toHaveLength(1);
    expect(events('application_dismissed')).toHaveLength(0);
  });

  test('a hunter (disabled) fires nothing', () => {
    const { unmount } = render(makeRequest('r1'), false);
    act(() => appStateListener()('background'));
    unmount();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});
