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
import { resolveNotificationDeepLink, supportsActionSheet } from '../../lib/services/notification-deep-links';

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

describe('resolveNotificationDeepLink: bounty_nearby (regression guard)', () => {
  test('still routes to the public bounty view with the notification-source tag', () => {
    const action = resolveNotificationDeepLink({
      type: 'bounty_nearby',
      data: { bountyId: 'xyz-789' },
    });
    expect(action).toEqual({ kind: 'route', path: '/bounty/xyz-789?source=notification' });
  });
});
