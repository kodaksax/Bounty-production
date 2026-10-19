/**
 * Deep-link resolution for the bounty_quality_nudge notification type, added
 * alongside the bounty-quality-score/poster-nudge migration. A poster nudge
 * ("add details", "get better applications") should never send the poster to
 * the generic public bounty view -- it needs to land them on their own
 * bounty-management screen with the edit modal already open.
 *
 * Also covers a plain bounty_nearby case as a regression guard: the
 * bounty_quality_nudge branch was added as a special case ahead of the
 * general marketplace bountyId routing, so it must not shadow it.
 */
import { FIND_BOUNTIES_PATH, resolveNotificationDeepLink, supportsActionSheet } from '../../lib/services/notification-deep-links';
import { categoryForNotificationType } from '../../lib/config/notification-taxonomy';

describe('resolveNotificationDeepLink: bounty_quality_nudge', () => {
  test('routes to the poster bounty-management screen with the edit modal pre-opened', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_quality_nudge',
      data: { bountyId: 'abc-123' },
    });
    expect(action).toEqual({ kind: 'route', path: '/postings/abc-123?openEdit=true' });
  });

  test('never falls through to the public bounty view, even though category is marketplace', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_quality_nudge',
      data: { bountyId: 'abc-123' },
    });
    expect(action.kind === 'route' && action.path).not.toMatch(/^\/bounty\//);
  });

  test('resolves to none when the payload is missing bountyId', () => {
    const action = resolveNotificationDeepLink({ type: 'bounty_quality_nudge', data: {} });
    expect(action).toEqual({ kind: 'none' });
  });

  test('supports the rich action sheet like other marketplace notifications', () => {
    expect(supportsActionSheet({ type: 'bounty_quality_nudge', data: { bountyId: 'abc-123' } })).toBe(true);
  });
});

describe('resolveNotificationDeepLink: application', () => {
  test('routes a new application to the poster Requests tab where Accept/Decline live', () => {
    const action = resolveNotificationDeepLink({
      type: 'application',
      data: { bountyId: 'abc-123' },
    });
    expect(action).toEqual({ kind: 'route', path: '/tabs/bounty-app?tab=messages&initialTab=requests' });
  });

  test('routes the pending-application reminder to the same screen', () => {
    const action = resolveNotificationDeepLink({
      type: 'application_pending_reminder',
      data: { bountyId: 'abc-123' },
    });
    expect(action).toEqual({ kind: 'route', path: '/postings/abc-123' });
  });

  test('never falls through to the public bounty view, even though category is marketplace', () => {
    const action = resolveNotificationDeepLink({
      type: 'application',
      data: { bountyId: 'abc-123' },
    });
    expect(action.kind === 'route' && action.path).not.toMatch(/^\/bounty\//);
  });

  test('still routes when the payload is missing bountyId', () => {
    const action = resolveNotificationDeepLink({ type: 'application', data: {} });
    expect(action).toEqual({ kind: 'route', path: '/tabs/bounty-app?tab=messages&initialTab=requests' });
  });
});

describe('application_pending_reminder: per-bounty digest payload (SBA-04)', () => {
  // What fn_remind_posters_of_pending_requests queues since 20261019120000:
  // the old keys (bountyId/requestId/hunterId/stage) plus scope,
  // applicantCount and bountyTitle; the outbox `count` becomes the in-app
  // row's count.
  const digestData = {
    type: 'application_pending_reminder',
    scope: 'bounty',
    bountyId: 'abc-123',
    bountyTitle: 'Walk my dog',
    applicantCount: 3,
    stage: 1,
    requestId: 'req-oldest',
    hunterId: 'hunter-oldest',
  };

  test('routes the digest to the poster bounty-management screen', () => {
    const action = resolveNotificationDeepLink({ type: 'application_pending_reminder', data: digestData });
    expect(action).toEqual({ kind: 'route', path: '/postings/abc-123' });
  });

  test('routes a snake_case bounty_id payload the same way', () => {
    const action = resolveNotificationDeepLink({ type: 'application_pending_reminder', data: { bounty_id: 'abc-123' } });
    expect(action).toEqual({ kind: 'route', path: '/postings/abc-123' });
  });

  test('a digest covering several applicants navigates instead of offering Accept/Decline for one of them', () => {
    expect(supportsActionSheet({ type: 'application_pending_reminder', data: digestData }, { count: 3 })).toBe(false);
  });

  test('a single-applicant digest keeps the one-tap action sheet, as old reminders did', () => {
    expect(
      supportsActionSheet({ type: 'application_pending_reminder', data: { ...digestData, applicantCount: 1 } }, { count: 1 })
    ).toBe(true);
  });

  test('legacy per-application reminders already in flight still route and keep the action sheet', () => {
    const legacy = { type: 'application_pending_reminder', bountyId: 'abc-123', requestId: 'req-1', hunterId: 'h-1', stage: 2 };
    expect(resolveNotificationDeepLink({ type: 'application_pending_reminder', data: legacy })).toEqual({
      kind: 'route',
      path: '/postings/abc-123',
    });
    expect(supportsActionSheet({ type: 'application_pending_reminder', data: legacy }, { count: 1 })).toBe(true);
  });
});

describe('resolveNotificationDeepLink: bounty_nearby (regression guard)', () => {
  test('still routes to the public bounty view with the notification-source tag', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_nearby',
      data: { bountyId: 'xyz-789' },
    });
    expect(action).toEqual({ kind: 'route', path: '/bounty/xyz-789?source=notification' });
  });

  // The two older nearby-bounty triggers write the id as snake_case
  // `bounty_id`. Before the resolver accepted both keys, these taps fell
  // through to { kind: 'none' } and opened nothing.
  test('routes when the trigger payload uses the snake_case bounty_id key', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_nearby',
      data: { bounty_id: 'xyz-789' },
    });
    expect(action).toEqual({ kind: 'route', path: '/bounty/xyz-789?source=notification' });
  });

  test('prefers camelCase bountyId when both keys are present', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_nearby',
      data: { bountyId: 'camel-1', bounty_id: 'snake-2' },
    });
    expect(action).toEqual({ kind: 'route', path: '/bounty/camel-1?source=notification' });
  });
});

describe('resolveNotificationDeepLink: application (GitHub #809)', () => {
  test('sends the poster to the Requests tab where applications are accepted or declined', () => {
    const action = resolveNotificationDeepLink({
      type: 'application',
      data: { bountyId: 'abc-123', hunterId: 'h-1' },
    });
    expect(action).toEqual({
      kind: 'route',
      path: '/tabs/bounty-app?tab=messages&initialTab=requests',
    });
  });

  test('still routes a bundled application notification that carries no bountyId', () => {
    const action = resolveNotificationDeepLink({ type: 'application', data: {} });
    expect(action.kind).toBe('route');
  });

  test('never resolves to a /bounty/:id URL (which the admin console used to shadow)', () => {
    const action = resolveNotificationDeepLink({ type: 'application', data: { bountyId: 'abc-123' } });
    expect(action.kind === 'route' && action.path).not.toMatch(/^\/bounty\//);
  });
});

describe('resolveNotificationDeepLink: bounty_location_nudge', () => {
  // BNTY-02: an in-person bounty with no location can never be matched, so the
  // liquidity sweep nudges the poster once. It must land on the poster's own
  // bounty-management screen with the edit modal open (where the Where field
  // lives), exactly like the quality nudge -- never the public bounty view.
  test('routes to the poster bounty-management screen with the edit modal pre-opened', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_location_nudge',
      data: { bountyId: 'abc-123', section: 'where' },
    });
    expect(action).toEqual({ kind: 'route', path: '/postings/abc-123?openEdit=true' });
  });

  test('resolves to none when the payload is missing bountyId', () => {
    const action = resolveNotificationDeepLink({ type: 'bounty_location_nudge', data: {} });
    expect(action).toEqual({ kind: 'none' });
  });

  test('supports the rich action sheet like other marketplace notifications', () => {
    expect(supportsActionSheet({ type: 'bounty_location_nudge', data: { bountyId: 'abc-123' } })).toBe(true);
  });
});

/**
 * Hunter -> poster rating (rating integrity 2026-10-02). The "Please rate the
 * poster" push (type completion, subtype rating_prompt) was sent 42 times on
 * prod and produced 0 ratings: it opened the public bounty view, which has no
 * rating UI. It must land on the hunter's payout screen, which does.
 */
describe('resolveNotificationDeepLink: completion / rating_prompt', () => {
  test('routes the hunter to their payout screen, where the rate-the-poster card lives', () => {
    const action = resolveNotificationDeepLink({
      type: 'completion',
      data: { subtype: 'rating_prompt', bounty_id: 'b-1', bountyId: 'b-1' },
    });
    expect(action).toEqual({ kind: 'route', path: '/in-progress/b-1/hunter/payout' });
  });

  test('other completion notifications keep the default bounty route', () => {
    const action = resolveNotificationDeepLink({
      type: 'completion',
      data: { subtype: 'approval', bountyId: 'b-1' },
    });
    expect(action).toEqual({ kind: 'route', path: '/bounty/b-1?source=notification' });
  });

  test('rating_prompt without a bounty id resolves to none', () => {
    expect(resolveNotificationDeepLink({ type: 'completion', data: { subtype: 'rating_prompt' } })).toEqual({ kind: 'none' });
  });
});

describe('payment notifications with direct destinations', () => {
  test('opens payout setup and release-waiting destinations without the action sheet', () => {
    expect(supportsActionSheet({ type: 'payout_setup_required', category: 'payments' })).toBe(false);
    expect(supportsActionSheet({ type: 'release_waiting_on_hunter', category: 'payments' })).toBe(false);
  });

  test('resolves both notifications to their intended destinations', () => {
    expect(resolveNotificationDeepLink({ type: 'payout_setup_required', category: 'payments' })).toEqual({
      kind: 'route',
      path: '/wallet/connect/embedded-onboarding',
    });
    expect(resolveNotificationDeepLink({
      type: 'release_waiting_on_hunter',
      category: 'payments',
      data: { bountyId: 'abc-123' },
    })).toEqual({ kind: 'route', path: '/postings/abc-123' });
  });
});

describe('application_closure_digest (SBA-09)', () => {
  test('opens the first live alternative it names', () => {
    expect(resolveNotificationDeepLink({
      type: 'application_closure_digest',
      data: { bountyId: 'alt-1', closedCount: 3, items: [], alternatives: [{ bountyId: 'alt-1' }] },
    })).toEqual({ kind: 'route', path: '/bounty/alt-1?source=notification' });
  });

  test('with no alternative, goes to the feed instead of nowhere', () => {
    expect(resolveNotificationDeepLink({
      type: 'application_closure_digest',
      data: { closedCount: 1, items: [], alternatives: [] },
    })).toEqual({ kind: 'route', path: FIND_BOUNTIES_PATH });
    expect(FIND_BOUNTIES_PATH).toContain('tab=bounty');
  });

  test('is a marketplace notification that opens the sheet (full text + one button)', () => {
    expect(categoryForNotificationType('application_closure_digest')).toBe('marketplace');
    expect(supportsActionSheet({ type: 'application_closure_digest' }, { count: 1 })).toBe(true);
  });

  test('held per-closure rows still open their bounty', () => {
    expect(resolveNotificationDeepLink({
      type: 'application_expired',
      data: { bountyId: 'b1', applicationId: 'r1', heldForDigest: true },
    })).toEqual({ kind: 'route', path: '/bounty/b1?source=notification' });
  });
});
