// hooks/useShowTestBounties.ts
//
// Persisted "show test bounties anyway" preference. Meaningless — and never
// exposed in the UI — for anyone whose profile isn't internal (see
// AuthProfile.is_internal in lib/services/auth-profile-service.ts); the
// server side of this (search_bounties_nearby's p_include_test) re-checks
// the caller is internal regardless, so this toggle can never be used to see
// internal QA content from a non-internal account.
//
// A hard filter with no escape hatch would remove the team's own ability to
// smoke-test the feed end to end, which is worse than the leakage problem
// this whole feature exists to fix — see bounty_test_flag_and_internal_profiles.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'BE:showTestBounties';

export function useShowTestBounties() {
  const [showTestBounties, setShowTestBountiesState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (!cancelled && value === 'true') setShowTestBountiesState(true);
      })
      .catch(() => {
        // Default (false) is already the safe/correct state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setShowTestBounties = useCallback((value: boolean) => {
    setShowTestBountiesState(value);
    AsyncStorage.setItem(STORAGE_KEY, String(value)).catch(() => {
      // Best-effort persistence; the in-memory state above already applied.
    });
  }, []);

  return { showTestBounties, setShowTestBounties };
}
