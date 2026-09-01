// lib/admin/adminPreferences.ts - Persisted preferences for the admin console.
//
// Why this exists: app/(admin)/settings/general.tsx held its preferences in
// component state and its "Save Settings" button did nothing but show an
// "Your preferences have been updated successfully." alert. Nothing was
// persisted, nothing read the values back, and every switch reset the moment
// the screen unmounted — so the screen actively lied about having saved.
//
// Only preferences something actually consumes live here. A preference with no
// consumer is a fake switch, and a fake switch is worse than no switch.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PAGE_SIZE, type AdminBountyStatus } from '../types-admin';

const STORAGE_KEY = '@bounty/admin_preferences';

export const ADMIN_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type AdminPageSizeOption = (typeof ADMIN_PAGE_SIZE_OPTIONS)[number];

export const ADMIN_AUTO_REFRESH_OPTIONS = [0, 30, 60, 300] as const;
export type AdminAutoRefreshOption = (typeof ADMIN_AUTO_REFRESH_OPTIONS)[number];

export interface AdminPreferences {
  /** Rows per page on every admin list. Consumed by hooks/useAdminList.ts. */
  pageSize: AdminPageSizeOption;
  /** Status the Bounties screen opens on. Consumed by app/(admin)/bounties.tsx. */
  defaultBountyStatus: AdminBountyStatus | 'all';
  /**
   * Seconds between automatic dashboard refreshes; 0 disables it.
   * Consumed by app/(admin)/index.tsx.
   */
  autoRefreshSeconds: AdminAutoRefreshOption;
  /** Denser list rows. Consumed by the admin list screens. */
  compactRows: boolean;
}

export const DEFAULT_ADMIN_PREFERENCES: AdminPreferences = {
  pageSize: ADMIN_PAGE_SIZE as AdminPageSizeOption,
  defaultBountyStatus: 'all',
  autoRefreshSeconds: 0,
  compactRows: false,
};

/**
 * Coerce whatever is in storage into a valid preferences object. A value
 * written by an older build (or hand-edited) must not be able to put the
 * console into a broken state — e.g. a pageSize of 0 would make every list
 * permanently empty.
 */
function normalize(raw: unknown): AdminPreferences {
  const input = (raw ?? {}) as Partial<AdminPreferences>;
  return {
    pageSize: (ADMIN_PAGE_SIZE_OPTIONS as readonly number[]).includes(input.pageSize as number)
      ? (input.pageSize as AdminPageSizeOption)
      : DEFAULT_ADMIN_PREFERENCES.pageSize,
    defaultBountyStatus:
      typeof input.defaultBountyStatus === 'string'
        ? (input.defaultBountyStatus as AdminPreferences['defaultBountyStatus'])
        : DEFAULT_ADMIN_PREFERENCES.defaultBountyStatus,
    autoRefreshSeconds: (ADMIN_AUTO_REFRESH_OPTIONS as readonly number[]).includes(
      input.autoRefreshSeconds as number
    )
      ? (input.autoRefreshSeconds as AdminAutoRefreshOption)
      : DEFAULT_ADMIN_PREFERENCES.autoRefreshSeconds,
    compactRows: input.compactRows === true,
  };
}

export async function loadAdminPreferences(): Promise<AdminPreferences> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_ADMIN_PREFERENCES;
    return normalize(JSON.parse(stored));
  } catch {
    // A corrupt or unreadable store falls back to defaults rather than
    // breaking every admin screen that reads it.
    return DEFAULT_ADMIN_PREFERENCES;
  }
}

export async function saveAdminPreferences(prefs: AdminPreferences): Promise<void> {
  // Deliberately not swallowed: the settings screen surfaces a real failure
  // instead of claiming the save succeeded.
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(prefs)));
}

export interface UseAdminPreferencesResult {
  preferences: AdminPreferences;
  isLoading: boolean;
  /** Persist a patch. Rejects if the write fails, so callers can report it. */
  update: (patch: Partial<AdminPreferences>) => Promise<void>;
  reset: () => Promise<void>;
}

/**
 * Read/write the console preferences. Every consumer gets the persisted value
 * on mount; `update` writes through immediately so there is no separate "Save"
 * step that can silently do nothing.
 */
export function useAdminPreferences(): UseAdminPreferencesResult {
  const [preferences, setPreferences] = useState<AdminPreferences>(DEFAULT_ADMIN_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAdminPreferences().then((prefs) => {
      if (active) {
        setPreferences(prefs);
        setIsLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (patch: Partial<AdminPreferences>) => {
    // Optimistic, then persisted. If the write throws, roll the in-memory
    // value back so the switch on screen matches what is actually stored.
    let previous: AdminPreferences = DEFAULT_ADMIN_PREFERENCES;
    let next: AdminPreferences = DEFAULT_ADMIN_PREFERENCES;
    setPreferences((prev) => {
      previous = prev;
      next = normalize({ ...prev, ...patch });
      return next;
    });
    try {
      await saveAdminPreferences(next);
    } catch (err) {
      setPreferences(previous);
      throw err;
    }
  }, []);

  const reset = useCallback(async () => {
    setPreferences(DEFAULT_ADMIN_PREFERENCES);
    await saveAdminPreferences(DEFAULT_ADMIN_PREFERENCES);
  }, []);

  return { preferences, isLoading, update, reset };
}
