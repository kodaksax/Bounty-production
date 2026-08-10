import { normalizeScreenName, screenNameForBountyAppTab } from '../../../lib/analytics/screen-name';

describe('normalizeScreenName', () => {
  test('maps overridden routes to friendly slugs', () => {
    expect(normalizeScreenName([])).toBe('home');
    expect(normalizeScreenName(['tabs', 'bounty-app'])).toBe('home_feed');
    expect(normalizeScreenName(['tabs', 'search'])).toBe('search');
    expect(normalizeScreenName(['bounty', '[id]'])).toBe('bounty_detail');
    expect(normalizeScreenName(['profile', '[userId]'])).toBe('profile_other');
    expect(normalizeScreenName(['(admin)'])).toBe('admin_dashboard');
    expect(normalizeScreenName(['(admin)', 'bounty', '[id]'])).toBe('admin_bounty_detail');
  });

  test('never includes a dynamic segment value — only the literal placeholder', () => {
    // useSegments() returns the literal filename ("[id]"), never a resolved
    // UUID/number — this asserts the normalizer doesn't need to (and can't)
    // leak one, since it never sees resolved values in the first place.
    const name = normalizeScreenName(['bounty', '[id]', 'public']);
    expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(name).not.toMatch(/\d{5,}/);
  });

  test('falls back to a stable, ID-free slug for routes with no explicit override', () => {
    const name = normalizeScreenName(['some', 'future-route', '[slug]']);
    expect(name).toBe('some_future_route_slug');
  });

  test('drops a trailing literal "index" segment if present', () => {
    expect(normalizeScreenName(['profile', 'index'])).toBe('profile');
  });

  test('produces distinct names for distinct routes', () => {
    const names = new Set([
      normalizeScreenName(['tabs', 'bounty-app']),
      normalizeScreenName(['tabs', 'search']),
      normalizeScreenName(['bounty', '[id]']),
      normalizeScreenName(['profile', '[userId]']),
      normalizeScreenName(['onboarding', 'welcome']),
    ]);
    expect(names.size).toBe(5);
  });
});

describe('screenNameForBountyAppTab', () => {
  test('maps known tabs', () => {
    expect(screenNameForBountyAppTab('bounty')).toBe('home_feed');
    expect(screenNameForBountyAppTab('wallet')).toBe('wallet');
    expect(screenNameForBountyAppTab('postings')).toBe('postings');
    expect(screenNameForBountyAppTab('profile')).toBe('profile');
    expect(screenNameForBountyAppTab('messages')).toBe('messages');
    expect(screenNameForBountyAppTab('admin')).toBe('admin_dashboard');
  });

  test('falls back gracefully for an unknown tab', () => {
    expect(screenNameForBountyAppTab('mystery')).toBe('tab_mystery');
  });
});
