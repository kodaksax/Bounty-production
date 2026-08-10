import { authProfileService } from './auth-profile-service';
import { analyticsService } from './analytics-service';

/**
 * Infers `profiles.primary_role` from a user's first real bounty create/apply
 * action, for onboarding's 'onboarding-skip-role-selection' experiment: a
 * test-arm poster who tapped "Skip for now" on CombinedActivationPrompt
 * completes onboarding with `primary_role` still unset (see
 * hooks/useCompleteOnboarding.ts). This is the fallback that fills it in once
 * they actually act, rather than leaving it unset indefinitely.
 *
 * Deliberately not wired through lib/moments/backfill.ts — that file only
 * decides enqueue-vs-complete for an *existing* moments row once
 * `primary_role` is already known, so it can't be the thing that derives
 * `primary_role` in the first place.
 *
 * Safe to call on every create/apply, not just the first: no-ops once
 * `primary_role` is already set. `userId` must be the current session user —
 * authProfileService.updateProfile always writes to the authenticated caller,
 * which holds at both call sites (a poster/hunter acting on their own behalf).
 */
export async function inferRoleFromFirstAction(
  userId: string,
  role: 'poster' | 'hunter'
): Promise<void> {
  try {
    const profile = await authProfileService.getProfileById(userId);
    if (profile?.primary_role) return;

    await authProfileService.updateProfile({ primary_role: role });
    await analyticsService.updateUserProperties({ role });
  } catch (error) {
    console.error('[role-inference] Failed to infer role from first action:', error);
  }
}
