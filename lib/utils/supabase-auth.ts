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
          clearTimeout(timeoutId)
        }

        if (subscription) {
          try {
            subscription.unsubscribe()
          } catch (e) {
              const isDebug = (typeof __DEV__ !== 'undefined' && __DEV__) ||
                (typeof process !== 'undefined' && process.env != null &&
                  (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production'))
              if (isDebug) console.error('supabase-auth: unsubscribe failed', e)
          }
        } else {
          unsubPending = true
        }

        resolve(newSession)
      }
    })

    interface SupabaseAuthReturn {
      data?: { subscription?: { unsubscribe: () => void } }
    }

    const maybeRet = ret as SupabaseAuthReturn | undefined
    subscription = maybeRet?.data?.subscription
    if (unsubPending && subscription) {
      try {
        subscription.unsubscribe()
      } catch (e) {
        const isDebug = (typeof __DEV__ !== 'undefined' && __DEV__) ||
          (typeof process !== 'undefined' && process.env != null &&
            (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production'))
        if (isDebug) console.error('supabase-auth: unsubscribe failed', e)
      }
    }

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true
        if (subscription) {
          try {
            subscription.unsubscribe()
          } catch (e) {
            const isDebug = (typeof __DEV__ !== 'undefined' && __DEV__) ||
              (typeof process !== 'undefined' && process.env != null &&
                (process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production'))
            if (isDebug) console.error('supabase-auth: unsubscribe failed', e)
          }
        }
        resolve(null)
      }
    }, timeoutMs)
  })
}

export default waitForAuthEvent
