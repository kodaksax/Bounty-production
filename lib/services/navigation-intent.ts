// Small navigation intent helper to pass transient intents between screens
// Uses in-memory store and falls back to AsyncStorage so intents survive reloads briefly
import AsyncStorage from '@react-native-async-storage/async-storage'

const PENDING_CONV_KEY = '@bountyexpo:pending_open_conversation'

let _pendingConversationId: string | null = null

export const navigationIntent = {
  setPendingConversationId: async (id: string) => {
    try {
      _pendingConversationId = id
      await AsyncStorage.setItem(PENDING_CONV_KEY, id)
    } catch (e) {
      // best-effort
      console.warn('navigationIntent: failed to persist pending conversation id', e)
    }
  },

  getAndClearPendingConversationId: async (): Promise<string | null> => {
    try {
      if (_pendingConversationId) {
        const v = _pendingConversationId
        _pendingConversationId = null
        try { await AsyncStorage.removeItem(PENDING_CONV_KEY) } catch {}
        return v
      }

      const stored = await AsyncStorage.getItem(PENDING_CONV_KEY)
      if (stored) {
        await AsyncStorage.removeItem(PENDING_CONV_KEY)
        return stored
      }
      return null
    } catch (e) {
      console.warn('navigationIntent: failed to read/clear pending conversation id', e)
      return null
    }
  },
}

export default navigationIntent
