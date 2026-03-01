/**
 * useAgeGate
 *
 * Future-proof hook that determines whether the current user passes the age gate
 * for age-restricted bounties (18+).
 *
 * Returns:
 *  - isAgeVerified  : true when the user has a confirmed age_verified flag
 *  - isLoading      : true while the profile is still being fetched
 *
 * Usage:
 *   const { isAgeVerified, isLoading } = useAgeGate();
 *   if (!isAgeVerified) { // show age-restricted warning or redirect }
 */

import { useAuthProfile } from './useAuthProfile';

interface UseAgeGateResult {
  /** Whether the current user has passed age verification (18+). */
  isAgeVerified: boolean;
  /** True while the underlying profile is still loading. */
  isLoading: boolean;
}

export function useAgeGate(): UseAgeGateResult {
  const { profile, loading } = useAuthProfile();

  return {
    isAgeVerified: profile?.age_verified === true,
    isLoading: loading,
  };
}
