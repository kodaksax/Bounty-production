// lib/storage.ts - Unified storage wrapper with graceful fallback
import * as SecureStore from 'expo-secure-store'

// Attempt to require AsyncStorage at runtime. In Expo Go without dev client,
// this native module may not be available, so we guard access.
let AsyncStorage: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@react-native-async-storage/async-storage')
  AsyncStorage = mod?.default || mod
} catch (_) {
  AsyncStorage = null
}

const hasAsync = !!AsyncStorage && typeof AsyncStorage.getItem === 'function'

export const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (hasAsync) return await AsyncStorage.getItem(key)
      // SecureStore only supports strings; use same API shape
      return await SecureStore.getItemAsync(key)
    } catch (e) {
      return null
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (hasAsync) return await AsyncStorage.setItem(key, value)
      await SecureStore.setItemAsync(key, value)
    } catch (e) {
      // noop
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      if (hasAsync) return await AsyncStorage.removeItem(key)
      await SecureStore.deleteItemAsync(key)
    } catch (e) {
      // noop
    }
  },
}

export default storage
