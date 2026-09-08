/**
 * Regression tests for the single authoritative bounty visibility filter.
 *
 * The bug this module exists to prevent: a bounty that was completed, hidden or
 * removed reappeared once the user navigated to another tab and back, because
 * every list re-derived "is this eligible?" for itself and only ever applied it
 * to the first load — the next fetch (page merge, screen remount, foreground
 * refresh) put the stale row straight back.
 */
import {
  clearBountyRemovedLocally,
  filterManagementBounties,
  filterOpenFeedBounties,
  isBountyRemovedLocally,
  isBountyVisibleInManagementList,
  isBountyVisibleInOpenFeed,
  markBountyRemovedLocally,
  REMOVED_BOUNTY_TTL_MS,
  resetRemovedBountiesRegistry,
} from '../../../lib/utils/bounty-visibility';

const bounty = (over: Record<string, unknown> = {}) => ({ id: 'b1', status: 'open', ...over }) as any;

beforeEach(() => {
  resetRemovedBountiesRegistry();
});

describe('open-feed eligibility', () => {
  it('only an open bounty may appear in the hunter feed', () => {
    expect(isBountyVisibleInOpenFeed(bounty({ status: 'open' }))).toBe(true);
    for (const status of [
      'in_progress',
      'completed',
      'archived',
      'deleted',
      'cancelled',
      'cancellation_requested',
    ]) {
      expect(isBountyVisibleInOpenFeed(bounty({ status }))).toBe(false);
    }
  });

  it('keeps a row whose status column was not projected (unknown, not terminal)', () => {
    expect(isBountyVisibleInOpenFeed(bounty({ status: undefined }))).toBe(true);
    expect(isBountyVisibleInOpenFeed(bounty({ status: null }))).toBe(true);
  });

  it('drops an unrecognised terminal-ish status such as expired', () => {
    expect(isBountyVisibleInOpenFeed(bounty({ status: 'expired' }))).toBe(false);
  });

  it('drops ineligible rows out of any fetched page', () => {
    const page = [
      bounty({ id: 'a', status: 'open' }),
      bounty({ id: 'b', status: 'completed' }),
      bounty({ id: 'c', status: 'deleted' }),
    ];
    expect(filterOpenFeedBounties(page).map(b => b.id)).toEqual(['a']);
  });

  it('tolerates a non-array payload', () => {
    expect(filterOpenFeedBounties(undefined as any)).toEqual([]);
  });
});

describe('management-list eligibility', () => {
  it('keeps completed/cancelled work (it belongs under the Completed chip)', () => {
    expect(isBountyVisibleInManagementList(bounty({ status: 'completed' }))).toBe(true);
    expect(isBountyVisibleInManagementList(bounty({ status: 'cancelled' }))).toBe(true);
    expect(isBountyVisibleInManagementList(bounty({ status: 'in_progress' }))).toBe(true);
  });

  it('removes the soft-removal statuses', () => {
    expect(isBountyVisibleInManagementList(bounty({ status: 'archived' }))).toBe(false);
    expect(isBountyVisibleInManagementList(bounty({ status: 'deleted' }))).toBe(false);
  });
});

describe('locally-removed registry', () => {
  it('suppresses a removed bounty even when a later fetch still returns it', () => {
    const stalePage = [bounty({ id: 'a', status: 'open' }), bounty({ id: 'b', status: 'open' })];
    markBountyRemovedLocally('b');
    expect(filterOpenFeedBounties(stalePage).map(x => x.id)).toEqual(['a']);
    expect(filterManagementBounties(stalePage).map(x => x.id)).toEqual(['a']);
  });

  it('scopes a feed-only removal so completed work still shows in management lists', () => {
    const completed = [bounty({ id: 'b', status: 'completed' })];
    markBountyRemovedLocally('b', ['feed']);
    expect(isBountyRemovedLocally('b', 'feed')).toBe(true);
    expect(isBountyRemovedLocally('b', 'management')).toBe(false);
    expect(filterManagementBounties(completed).map(x => x.id)).toEqual(['b']);
  });

  it('matches ids regardless of string/number form', () => {
    markBountyRemovedLocally(7);
    expect(isBountyRemovedLocally('7', 'feed')).toBe(true);
  });

  it('can be lifted when the backend says the bounty is eligible again', () => {
    markBountyRemovedLocally('b', ['feed']);
    clearBountyRemovedLocally('b', ['feed']);
    expect(filterOpenFeedBounties([bounty({ id: 'b' })]).map(x => x.id)).toEqual(['b']);
  });

  it('expires so a genuinely reopened bounty is never hidden for the session', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);
    markBountyRemovedLocally('b');
    nowSpy.mockReturnValue(1_000_000 + REMOVED_BOUNTY_TTL_MS + 1);
    expect(isBountyRemovedLocally('b', 'feed')).toBe(false);
    nowSpy.mockRestore();
  });

  it('ignores a null id instead of poisoning the registry', () => {
    markBountyRemovedLocally(null as any);
    expect(isBountyRemovedLocally(null as any, 'feed')).toBe(false);
    expect(filterOpenFeedBounties([bounty({ id: 'a' })]).map(x => x.id)).toEqual(['a']);
  });
});
