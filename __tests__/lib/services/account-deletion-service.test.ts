/**
 * Regression coverage for the "deleted account, created a new one, got
 * routed into an old/legacy onboarding flow" bug.
 *
 * Root cause: clearLocalUserData() in account-deletion-service.ts hardcoded
 * a list of AsyncStorage key names (`@bounty_onboarding_complete`,
 * `@bounty_onboarding_completed` with no `:userId` suffix) that did not
 * match what the current onboarding code actually writes
 * (`@bounty_onboarding_completed:<userId>`, `@bounty_onboarding_state[:userId]`,
 * `@bounty_has_signed_in_before`). Account deletion was therefore a near
 * no-op for onboarding state: a new account created on the same device could
 * resume the deleted account's in-progress onboarding draft and/or its
 * cached welcome-screen experiment arm instead of starting fresh.
 *
 * These tests assert the real keys get removed, using an in-memory
 * AsyncStorage mock so getAllKeys()/multiRemove() behave like the real thing.
 */

// In-memory AsyncStorage so getAllKeys()/multiRemove() reflect what setItem() wrote.
const store = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(store.has(key) ? store.get(key)! : null)),
  setItem: jest.fn((key: string, value: string) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(k => store.delete(k));
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...store.keys()])),
}));

const mockGetSession = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue({ error: null });
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

jest.mock('../../../lib/config/api', () => ({
  getApiBaseUrl: jest.fn(() => 'http://localhost:3001'),
}));

import { deleteUserAccount } from '../../../lib/services/account-deletion-service';

const USER_ID = 'user-being-deleted';
const OTHER_USER_ID = 'other-user-on-shared-device';

describe('deleteUserAccount local-storage cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();

    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: USER_ID }, access_token: 'token-abc' } },
      error: null,
    });

    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
  });

  function seedRealisticLocalState() {
    // Keys the current onboarding code actually writes for the deleted user.
    store.set(`@bounty_onboarding_completed:${USER_ID}`, 'true');
    store.set(`@bounty_onboarding_state:${USER_ID}`, JSON.stringify({ intent: 'poster' }));
    store.set('@bounty_has_signed_in_before', 'true');
    // Anon pre-auth draft, in case it never migrated onto the user-scoped key.
    store.set('@bounty_onboarding_state', JSON.stringify({ intent: 'hunter' }));
    // Legacy caches this function has always cleared.
    store.set('BE:userProfile', JSON.stringify({ username: 'deleted_user' }));
    store.set('BE:acceptedLegal', 'true');
    // A second account's own state should not be touched by deleting this one.
    store.set(`@bounty_onboarding_completed:${OTHER_USER_ID}`, 'true');
  }

  it('clears the real per-user onboarding-completed flag', async () => {
    await seedRealisticLocalState();

    const result = await deleteUserAccount();

    expect(result.success).toBe(true);
    expect(store.has(`@bounty_onboarding_completed:${USER_ID}`)).toBe(false);
  });

  it('clears the in-progress onboarding draft, both user-scoped and anon pre-auth copies', async () => {
    await seedRealisticLocalState();

    await deleteUserAccount();

    expect(store.has(`@bounty_onboarding_state:${USER_ID}`)).toBe(false);
    expect(store.has('@bounty_onboarding_state')).toBe(false);
  });

  it('clears the device has-signed-in-before flag so the next launch is treated as first-time', async () => {
    await seedRealisticLocalState();

    await deleteUserAccount();

    expect(store.has('@bounty_has_signed_in_before')).toBe(false);
  });

  it('still clears the legacy profile-cache keys', async () => {
    await seedRealisticLocalState();

    await deleteUserAccount();

    expect(store.has('BE:userProfile')).toBe(false);
    expect(store.has('BE:acceptedLegal')).toBe(false);
  });

  it('surfaces a partial-deletion warning instead of reporting silent full success', async () => {
    await seedRealisticLocalState();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        warning: 'partial_deletion_auth_identity_retained',
      }),
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await deleteUserAccount();

    expect(result.success).toBe(true);
    expect(result.message).toContain('some account data could not be fully removed');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('PARTIAL DELETION'),
      USER_ID
    );

    consoleErrorSpy.mockRestore();
  });
});
