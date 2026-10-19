import { useEffect, useState } from 'react';
import { supabase } from 'lib/supabase';
import {
  DEFAULT_REQUEST_EXPIRY_POLICY,
  parseExpiryHours,
  type RequestExpiryPolicy,
} from '../lib/utils/request-expiry';

/**
 * The live application-expiry window from `public.posting_policy_config`,
 * the row fn_expire_bounty_requests reads. Signed-in users can SELECT it.
 *
 * Starts at the server's own defaults (72h / 168h) and never blocks a render:
 * a failed or signed-out read keeps the defaults, which is what the server
 * falls back to as well. One read per app session is enough for a value that
 * only an admin changes, so lists of cards share a single request.
 */
let cached: RequestExpiryPolicy | null = null;
let inflight: Promise<RequestExpiryPolicy | null> | null = null;

async function loadPolicy(): Promise<RequestExpiryPolicy | null> {
  try {
    const { data, error } = await supabase
      .from('posting_policy_config')
      .select('request_expiry_hours, request_interacted_expiry_hours')
      .maybeSingle();
    if (error || !data) return null;
    return {
      expiryHours:
        parseExpiryHours(data.request_expiry_hours) ?? DEFAULT_REQUEST_EXPIRY_POLICY.expiryHours,
      interactedExpiryHours:
        parseExpiryHours(data.request_interacted_expiry_hours) ??
        DEFAULT_REQUEST_EXPIRY_POLICY.interactedExpiryHours,
    };
  } catch {
    return null;
  }
}

export function useRequestExpiryPolicy(): RequestExpiryPolicy {
  const [policy, setPolicy] = useState<RequestExpiryPolicy>(cached ?? DEFAULT_REQUEST_EXPIRY_POLICY);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    inflight = inflight ?? loadPolicy();
    inflight.then(result => {
      // A failed read is retried by the next mount rather than cached.
      if (result) cached = result;
      else inflight = null;
      if (!cancelled && result) setPolicy(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return policy;
}

/** Test-only: forget the cached policy. */
export function __resetRequestExpiryPolicyCache(): void {
  cached = null;
  inflight = null;
}

export default useRequestExpiryPolicy;
