// Tests for the admin console preference store.
//
// Context: app/(admin)/settings/general.tsx held seven preferences in
// component state and its "Save Settings" button showed
// "Your preferences have been updated successfully." without writing anything
// anywhere. Nothing read the values back and they were lost on unmount.
// These tests cover the store that replaced it, with emphasis on the two
// properties that keep it honest: a failed write must not be reported as a
// success, and a corrupt stored value must not brick the console.

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

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_ADMIN_PREFERENCES,
  loadAdminPreferences,
  saveAdminPreferences,
} from '../../lib/admin/adminPreferences';

const KEY = '@bounty/admin_preferences';

describe('admin preferences', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  test('a saved preference survives a reload', async () => {
    // The property the old screen did not have at all.
    await saveAdminPreferences({
      ...DEFAULT_ADMIN_PREFERENCES,
      pageSize: 50,
      autoRefreshSeconds: 60,
    });

    const loaded = await loadAdminPreferences();
    expect(loaded.pageSize).toBe(50);
    expect(loaded.autoRefreshSeconds).toBe(60);
  });

  test('returns defaults when nothing has been stored', async () => {
    await expect(loadAdminPreferences()).resolves.toEqual(DEFAULT_ADMIN_PREFERENCES);
  });

  test('a corrupt stored value falls back to defaults instead of throwing', async () => {
    mockStorage.set(KEY, 'not json at all');
    await expect(loadAdminPreferences()).resolves.toEqual(DEFAULT_ADMIN_PREFERENCES);
  });

  test('an out-of-range page size is rejected rather than emptying every list', async () => {
    // A pageSize of 0 written by an older build (or by hand) would make every
    // admin list permanently empty.
    mockStorage.set(KEY, JSON.stringify({ pageSize: 0, autoRefreshSeconds: 7 }));
    const loaded = await loadAdminPreferences();
    expect(loaded.pageSize).toBe(DEFAULT_ADMIN_PREFERENCES.pageSize);
    expect(loaded.autoRefreshSeconds).toBe(DEFAULT_ADMIN_PREFERENCES.autoRefreshSeconds);
  });

  test('normalises before writing, so an invalid value never reaches storage', async () => {
    await saveAdminPreferences({
      ...DEFAULT_ADMIN_PREFERENCES,
      pageSize: 9999 as never,
    });
    const written = JSON.parse(mockStorage.get(KEY)!);
    expect(written.pageSize).toBe(DEFAULT_ADMIN_PREFERENCES.pageSize);
  });

  test('a failed write rejects instead of silently reporting success', async () => {
    // This is the whole point: the screen must be able to tell the operator
    // the save did not land.
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(
      saveAdminPreferences({ ...DEFAULT_ADMIN_PREFERENCES, compactRows: true })
    ).rejects.toThrow('quota exceeded');
  });

  test('an unreadable store degrades to defaults rather than failing the screen', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    await expect(loadAdminPreferences()).resolves.toEqual(DEFAULT_ADMIN_PREFERENCES);
  });

  test('every default is a value some screen actually consumes', () => {
    // Guards against the previous failure mode: preferences that exist only as
    // decoration. Each key here has a named consumer.
    expect(Object.keys(DEFAULT_ADMIN_PREFERENCES).sort()).toEqual([
      'autoRefreshSeconds', // app/(admin)/index.tsx
      'compactRows', // admin list screens
      'defaultBountyStatus', // app/(admin)/bounties.tsx
      'pageSize', // hooks/useAdminList.ts
    ]);
  });
});
