import { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import {
    resolveSupabaseAuthSubscription,
    safeUnsubscribe,
    SupabaseAuthSubscription,
} from './supabase-subscription';

/**
 * Wait for an auth state change that provides a session, with a timeout.
 * Robust to implementations that invoke the callback synchronously before
 * returning the subscription object.
 */
export async function waitForAuthEvent(timeoutMs = 5000): Promise<Session | null> {
  return new Promise<Session | null>(resolve => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    let subscription: SupabaseAuthSubscription | undefined;
    let unsubPending = false;

    const logUnsubscribeFailure = (e: unknown) => {
      const isDebug =
        (typeof __DEV__ !== 'undefined' && __DEV__) ||
        (typeof process !== 'undefined' &&
          process.env != null &&
          (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production'));
      if (isDebug) console.error('supabase-auth: unsubscribe failed', e);
    };

    const ret = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !resolved) {
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (subscription) {
          safeUnsubscribe(subscription, logUnsubscribeFailure);
        } else {
          unsubPending = true;
        }

        resolve(newSession);
      }
    });

    resolveSupabaseAuthSubscription(
      ret,
      resolvedSubscription => {
        subscription = resolvedSubscription;
        if (unsubPending && subscription) {
          safeUnsubscribe(subscription, logUnsubscribeFailure);
        }
      },
      error => {
        const isDebug =
          (typeof __DEV__ !== 'undefined' && __DEV__) ||
          (typeof process !== 'undefined' &&
            process.env != null &&
            (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production'));
        if (isDebug) console.error('supabase-auth: listener registration failed', error);
      }
    );

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (subscription) {
          safeUnsubscribe(subscription, logUnsubscribeFailure);
        } else {
          unsubPending = true;
        }
        resolve(null);
      }
    }, timeoutMs);
  });
}

export default waitForAuthEvent;
