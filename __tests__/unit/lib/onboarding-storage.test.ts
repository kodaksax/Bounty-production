/**
 * Tests for lib/storage/onboarding.ts role-intent helpers.
 *
 * The onboarding carousel stores the user's chosen role ("poster" | "hunter")
 * under ONBOARDING_ROLE_KEY; the Done screen reads it via getOnboardingRole()
 * to render a role-aware final CTA. These tests ensure the helper only returns
 * valid roles and degrades gracefully on storage errors.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getOnboardingRole,
  ONBOARDING_ROLE_KEY,
} from '../../../lib/storage/onboarding';

const mockedGetItem = AsyncStorage.getItem as jest.Mock;

describe('getOnboardingRole', () => {
  beforeEach(() => {
    mockedGetItem.mockReset();
  });

  it('reads from the shared ONBOARDING_ROLE_KEY', async () => {
    mockedGetItem.mockResolvedValue(null);
    await getOnboardingRole();
    expect(mockedGetItem).toHaveBeenCalledWith(ONBOARDING_ROLE_KEY);
  });

  it('returns "poster" when stored role is poster', async () => {
    mockedGetItem.mockResolvedValue('poster');
    await expect(getOnboardingRole()).resolves.toBe('poster');
  });

  it('returns "hunter" when stored role is hunter', async () => {
    mockedGetItem.mockResolvedValue('hunter');
    await expect(getOnboardingRole()).resolves.toBe('hunter');
  });

  it('returns null when nothing is stored', async () => {
    mockedGetItem.mockResolvedValue(null);
    await expect(getOnboardingRole()).resolves.toBeNull();
  });

  it('returns null for unexpected stored values', async () => {
    mockedGetItem.mockResolvedValue('admin');
    await expect(getOnboardingRole()).resolves.toBeNull();
  });

  it('returns null when AsyncStorage read fails', async () => {
    mockedGetItem.mockRejectedValue(new Error('storage unavailable'));
    await expect(getOnboardingRole()).resolves.toBeNull();
  });
});
