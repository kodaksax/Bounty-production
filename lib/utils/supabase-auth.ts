import { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase'

/**
 * Wait for an auth state change that provides a session, with a timeout.
 * Robust to implementations that invoke the callback synchronously before
 * returning the subscription object.
 */
export async function waitForAuthEvent(timeoutMs = 5000): Promise<Session | null> {
  return new Promise<Session | null>((resolve) => {
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    let subscription: { unsubscribe: () => void } | undefined
    let unsubPending = false

    const ret = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !resolved) {
        resolved = true
        if (timeoutId) {
          try { clearTimeout(timeoutId) } catch (e) {}
        }

        if (subscription) {
          try { subscription.unsubscribe() } catch (e) {}
        } else {
          unsubPending = true
        }

        resolve(newSession)
      }
    })

    try {
      subscription = (ret && (ret as any).data && (ret as any).data.subscription) || undefined
      if (unsubPending && subscription) {
        try { subscription.unsubscribe() } catch (e) {}
      }
    } catch (e) {
      // ignore
    }

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { if (subscription) subscription.unsubscribe() } catch (e) {}
        resolve(null)
      }
    }, timeoutMs)
  })
}

export default waitForAuthEvent
