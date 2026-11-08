/**
 * role_changed fires from authProfileService.updateProfile: only after the
 * write succeeds, and only when profiles.primary_role actually changed.
 *
 * @jest-environment node
 */

const mockTrackEvent = jest.fn();
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: {
    trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
    updateUserProperties: jest.fn(),
  },
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getSession: jest.fn() },
  },
  isSupabaseConfigured: true,
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { info: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

import { authProfileService } from '../../../lib/services/auth-profile-service';
import { inferRoleFromFirstAction } from '../../../lib/services/role-inference-service';

const USER_ID = 'user-1';

const roleEvents = () =>
  mockTrackEvent.mock.calls.filter((c) => c[0] === 'role_changed').map((c) => c[1]);

describe('role_changed', () => {
  // What the row holds, so get_my_profile returns the last write like the real RPC.
  let storedRole: string | null;
  let writeSucceeds: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    storedRole = null;
    writeSucceeds = true;

    const { supabase } = require('../../../lib/supabase');
    supabase.from.mockImplementation(() => ({
      update: (updates: { primary_role?: string }) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              if (!writeSucceeds) return { data: null, error: new Error('denied') };
              if (updates.primary_role !== undefined) storedRole = updates.primary_role;
              return { data: { id: USER_ID }, error: null };
            },
          }),
        }),
      }),
    }));
    supabase.rpc.mockImplementation(async () => ({
      data: { id: USER_ID, username: 'u', primary_role: storedRole },
      error: null,
    }));

    const service = authProfileService as any;
    service.currentProfile = { id: USER_ID, username: 'u' };
    service.currentSession = { user: { id: USER_ID } };
    service.storedPrimaryRole = null;
  });

  it("reports from: 'none' when the role was empty", async () => {
    await authProfileService.updateProfile({ primary_role: 'poster' }, { roleChangeSource: 'onboarding' });
    expect(roleEvents()).toEqual([{ from: 'none', to: 'poster', source: 'onboarding' }]);
  });

  it('reports the change when the user goes back and picks the other role', async () => {
    await authProfileService.updateProfile({ primary_role: 'poster' }, { roleChangeSource: 'onboarding' });
    await authProfileService.updateProfile({ primary_role: 'hunter' }, { roleChangeSource: 'onboarding' });
    expect(roleEvents()).toEqual([
      { from: 'none', to: 'poster', source: 'onboarding' },
      { from: 'poster', to: 'hunter', source: 'onboarding' },
    ]);
  });

  it('sends nothing for a repeat write of the same value (onboarding completion)', async () => {
    await authProfileService.updateProfile({ primary_role: 'hunter' }, { roleChangeSource: 'onboarding' });
    await authProfileService.updateProfile({ primary_role: 'hunter' }, { roleChangeSource: 'onboarding' });
    expect(roleEvents()).toHaveLength(1);
  });

  it('still knows the previous role after an unrelated profile update', async () => {
    (authProfileService as any).currentProfile = { id: USER_ID, username: 'u', primary_role: 'poster' };
    storedRole = 'poster';

    await authProfileService.updateProfile({ about: 'hello' });
    expect((authProfileService as any).currentProfile.primary_role).toBeUndefined();
    expect(authProfileService.getPrimaryRoleForAnalytics()).toBe('poster');
    await authProfileService.updateProfile({ primary_role: 'hunter' }, { roleChangeSource: 'onboarding' });

    expect(roleEvents()).toEqual([{ from: 'poster', to: 'hunter', source: 'onboarding' }]);
  });

  it('serializes role writes through their authoritative read-back', async () => {
    const { supabase } = require('../../../lib/supabase');
    let releaseReadback!: () => void;
    let notifyReadbackStarted!: () => void;
    const readbackStarted = new Promise<void>((resolve) => {
      notifyReadbackStarted = resolve;
    });
    const heldReadback = new Promise<void>((resolve) => {
      releaseReadback = resolve;
    });
    let readbacks = 0;
    supabase.rpc.mockImplementation(async () => {
      const role = storedRole;
      readbacks += 1;
      if (readbacks === 1) {
        notifyReadbackStarted();
        await heldReadback;
      }
      return { data: { id: USER_ID, username: 'u', primary_role: role }, error: null };
    });

    const posterWrite = authProfileService.updateProfile(
      { primary_role: 'poster' },
      { roleChangeSource: 'onboarding' }
    );
    await readbackStarted;
    const hunterWrite = authProfileService.updateProfile(
      { primary_role: 'hunter' },
      { roleChangeSource: 'onboarding' }
    );
    await Promise.resolve();

    expect(storedRole).toBe('poster');
    expect(roleEvents()).toEqual([{ from: 'none', to: 'poster', source: 'onboarding' }]);

    releaseReadback();
    await Promise.all([posterWrite, hunterWrite]);

    expect(roleEvents()).toEqual([
      { from: 'none', to: 'poster', source: 'onboarding' },
      { from: 'poster', to: 'hunter', source: 'onboarding' },
    ]);
  });

  it('uses the role from an accepted self-profile refresh for analytics', async () => {
    const service = authProfileService as any;
    const loadFromCache = jest.spyOn(service, 'loadFromCache').mockResolvedValue(null);
    const cacheProfile = jest.spyOn(service, 'cacheProfile').mockResolvedValue(undefined);
    const { supabase } = require('../../../lib/supabase');
    supabase.rpc.mockResolvedValue({
      data: { id: USER_ID, username: 'u', primary_role: 'poster' },
      error: null,
    });
    service.storedPrimaryRole = { userId: USER_ID, role: 'hunter' };

    await authProfileService.fetchAndSyncProfile(USER_ID);

    expect(authProfileService.getPrimaryRoleForAnalytics()).toBe('poster');
    loadFromCache.mockRestore();
    cacheProfile.mockRestore();
  });

  it('clears the stored role when the session ends', async () => {
    const service = authProfileService as any;
    service.storedPrimaryRole = { userId: USER_ID, role: 'poster' };
    jest.spyOn(service, 'clearCache').mockResolvedValue(undefined);

    await authProfileService.setSession(null);

    expect(authProfileService.getPrimaryRoleForAnalytics()).toBeNull();
  });

  it('sends nothing when the update does not touch the role', async () => {
    await authProfileService.updateProfile({ about: 'hello' });
    expect(roleEvents()).toEqual([]);
  });

  it('sends nothing when the write fails', async () => {
    writeSucceeds = false;
    const { supabase } = require('../../../lib/supabase');
    const failing = supabase.from.getMockImplementation();
    supabase.from.mockImplementation(() => ({
      ...failing(),
      upsert: () => ({
        select: () => ({ single: async () => ({ data: null, error: new Error('denied') }) }),
      }),
    }));

    await authProfileService.updateProfile({ primary_role: 'poster' }, { roleChangeSource: 'onboarding' });

    expect(roleEvents()).toEqual([]);
  });

  it("reports first_action_inference when a first action fills an empty role", async () => {
    jest.spyOn(authProfileService, 'getProfileById').mockResolvedValue({ id: USER_ID, username: 'u' } as any);
    await inferRoleFromFirstAction(USER_ID, 'hunter');
    expect(roleEvents()).toEqual([{ from: 'none', to: 'hunter', source: 'first_action_inference' }]);
  });

  it('applying cannot flip a role that is already set', async () => {
    jest
      .spyOn(authProfileService, 'getProfileById')
      .mockResolvedValue({ id: USER_ID, username: 'u', primary_role: 'poster' } as any);
    await inferRoleFromFirstAction(USER_ID, 'hunter');
    expect(roleEvents()).toEqual([]);
  });
});
