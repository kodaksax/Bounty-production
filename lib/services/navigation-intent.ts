// Small navigation intent helper to pass transient intents between screens
// Uses in-memory store and falls back to AsyncStorage so intents survive reloads briefly
import AsyncStorage from '@react-native-async-storage/async-storage'

const PENDING_CONV_KEY = '@bountyexpo:pending_open_conversation'
const PENDING_NAV_KEY = '@bountyexpo:pending_navigation'

let _pendingConversationId: string | null = null
let _pendingNavigation: string | null = null

export const navigationIntent = {
  setPendingConversationId: async (id: string | null) => {
    try {
      _pendingConversationId = id
      if (id === null) {
        // Clear stored value when intent cleared
        try {
          await AsyncStorage.removeItem(PENDING_CONV_KEY)
        } catch (e) {
          // Non-critical: removal failed (e.g., storage not available).
          // Log at warn level to aid debugging while treating this as best-effort.
          console.warn('navigationIntent: failed to remove pending conversation key (non-critical)', e)
        }
      } else {
        await AsyncStorage.setItem(PENDING_CONV_KEY, id)
      }
    } catch (e) {
      // best-effort
      console.error('navigationIntent: failed to persist pending conversation id', e)
    }
  },

  getAndClearPendingConversationId: async (): Promise<string | null> => {
    try {
      if (_pendingConversationId) {
        const v = _pendingConversationId
        _pendingConversationId = null
        try {
          await AsyncStorage.removeItem(PENDING_CONV_KEY)
        } catch (e) {
          // Non-critical: log removal errors for visibility/debugging
          console.warn('navigationIntent: failed to remove pending conversation key during getAndClear (non-critical)', e)
        }
        return v
      }

      const stored = await AsyncStorage.getItem(PENDING_CONV_KEY)
      if (stored) {
        try {
          await AsyncStorage.removeItem(PENDING_CONV_KEY)
        } catch (e) {
          // Non-critical: log removal errors for visibility/debugging
          console.warn('navigationIntent: failed to remove pending conversation key after read (non-critical)', e)
        }
        return stored
      }
      return null
    } catch (e) {
      console.error('navigationIntent: failed to read/clear pending conversation id', e)
      return null
    }
  },

  // Pending navigation path (string). Use when one screen needs to request
  // that the root layout or tab container navigate to a specific route after
  // a redirect/pop. Stored in-memory and persisted to AsyncStorage as a
  // best-effort fallback for reloads.
  setPendingNavigation: async (path: string | null) => {
    try {
      if (path === null) {
        try { await AsyncStorage.removeItem(PENDING_NAV_KEY) } catch {}
        _pendingNavigation = null
      } else {
        _pendingNavigation = path
        await AsyncStorage.setItem(PENDING_NAV_KEY, path)
      }
    } catch (e) {
      console.error('navigationIntent: failed to persist pending navigation', e)
    }
  },

  getAndClearPendingNavigation: async (): Promise<string | null> => {
    try {
      if (_pendingNavigation) {
        const v = _pendingNavigation
        _pendingNavigation = null
        try { await AsyncStorage.removeItem(PENDING_NAV_KEY) } catch {}
        return v
      }
      const stored = await AsyncStorage.getItem(PENDING_NAV_KEY)
      if (stored) {
        try { await AsyncStorage.removeItem(PENDING_NAV_KEY) } catch {}
        return stored
      }
      return null
    } catch (e) {
      console.error('navigationIntent: failed to read/clear pending navigation', e)
      return null
    }
  },
}

export default navigationIntent
