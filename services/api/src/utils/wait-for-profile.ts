/**
 * Utility: wait for a user profile row to be created by the database trigger.
 * The profile is inserted asynchronously by a Postgres trigger after Supabase
 * Auth creates the user, so callers that need the profile immediately after
 * sign-up (e.g., eager Stripe customer creation) should poll here first.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../services/logger';

// Supabase admin client singleton – created on the first call to waitForProfile
// rather than at module load time, so that test code can mock @supabase/supabase-js
// before any client instance is constructed.
let _admin: SupabaseClient<any> | null = null;

function getAdmin(): SupabaseClient<any> {
  if (!_admin) {
    _admin = createClient<any>(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

/**
 * Wait for profile to be created by database trigger.
 * @param userId - User ID
 * @param maxWaitMs - Maximum time to wait (default: 3000ms)
 * @returns Profile row or null if timeout reached
 */
export async function waitForProfile(
  userId: string,
  maxWaitMs: number = 3000
): Promise<Record<string, any> | null> {
  const admin = getAdmin();
  const deadline = Date.now() + maxWaitMs;
  const pollIntervalMs = 200;

  while (Date.now() < deadline) {
    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, email, stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      logger.warn(
        { userId, error },
        '[waitForProfile] Error polling for profile – will retry'
      );
    } else if (profile) {
      return profile;
    }

    // Sleep before next poll
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  logger.warn(
    { userId, maxWaitMs },
    '[waitForProfile] Timed out waiting for profile row – eager Stripe customer creation will be skipped'
  );
  return null;
}
