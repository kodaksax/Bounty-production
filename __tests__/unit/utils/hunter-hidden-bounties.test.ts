/**
 * Regression tests for the persisted hunter "Hide"/"Remove from List" store.
 *
 * The bug this module exists to prevent (issue #779): the "Hide"/"Remove from
 * List" actions on a completed bounty card (components/my-posting-expandable.tsx,
 * variant="hunter") used to call nothing but `setHiddenByUser(true)` —
 * component-local React state. InboxScreen/PostingsScreen unmount entirely
 * when the user switches bottom-nav tabs (see app/tabs/bounty-app.tsx's
 * conditional rendering), so that state — and the hide — vanished the moment
 * the user navigated away and back, or the app restarted.
 */
const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
}));

import {
  filterHunterHiddenBounties,
  hideBountyForHunter,
  loadHunterHiddenBountyIds,
  unhideBountyForHunter,
} from '../../../lib/utils/hunter-hidden-bounties';

describe('hunter hidden bounties store', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test('a hidden bounty survives a fresh load — the "remount"/"app restart" case', async () => {
    await hideBountyForHunter('user-1', 'b1');
    const ids = await loadHunterHiddenBountyIds('user-1');
    expect(ids.has('b1')).toBe(true);
  });

  test('hiding is scoped per user — hiding under one user does not hide it for another', async () => {
    await hideBountyForHunter('user-1', 'b1');
    const idsForOtherUser = await loadHunterHiddenBountyIds('user-2');
    expect(idsForOtherUser.has('b1')).toBe(false);
  });

  test('numeric and string bounty ids hide the same way', async () => {
    await hideBountyForHunter('user-1', 42);
    const ids = await loadHunterHiddenBountyIds('user-1');
    expect(ids.has('42')).toBe(true);
  });

  test('hiding twice is idempotent', async () => {
    await hideBountyForHunter('user-1', 'b1');
    await hideBountyForHunter('user-1', 'b1');
    const ids = await loadHunterHiddenBountyIds('user-1');
    expect(Array.from(ids)).toEqual(['b1']);
  });

  test('no userId is a no-op, never throws', async () => {
    await expect(hideBountyForHunter(undefined, 'b1')).resolves.toBeUndefined();
    expect(await loadHunterHiddenBountyIds(undefined)).toEqual(new Set());
  });

  test('unhiding removes it from the persisted set', async () => {
    await hideBountyForHunter('user-1', 'b1');
    await unhideBountyForHunter('user-1', 'b1');
    const ids = await loadHunterHiddenBountyIds('user-1');
    expect(ids.has('b1')).toBe(false);
  });

  test('a corrupt stored value falls back to "nothing hidden" instead of throwing', async () => {
    mockStorage.set('@bounty/hunter_hidden_bounties/user-1', '{not valid json');
    const ids = await loadHunterHiddenBountyIds('user-1');
    expect(ids).toEqual(new Set());
  });

  test('filterHunterHiddenBounties drops exactly the hidden ids, by id coercion', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 42 }];
    const hidden = new Set(['b', '42']);
    expect(filterHunterHiddenBounties(list, hidden).map((b) => b.id)).toEqual(['a']);
  });

  test('filterHunterHiddenBounties is a no-op when nothing is hidden', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    expect(filterHunterHiddenBounties(list, new Set())).toBe(list);
  });
});
