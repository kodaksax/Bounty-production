import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

// Mock both storage modules
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
}))

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}))

describe('Secure Storage utilities', () => {
  const secure = require('../../../lib/utils/secure-storage')

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    // Default implementations
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null)
    ;(SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined)
    ;(SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)
    ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)
    ;(AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined)
  })

  test('SecureStore available: get/set/delete use SecureStore and do not call AsyncStorage', async () => {
    const key = secure.SecureKeys.WALLET_BALANCE

    // SecureStore returns a value
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValue('42')

    const v = await secure.getSecureItem(key)
    expect(v).toBe('42')
    expect(SecureStore.getItemAsync).toHaveBeenCalled()
    expect(AsyncStorage.getItem).not.toHaveBeenCalled()

    // set should use SecureStore
    await secure.setSecureItem(key, '100')
    expect(SecureStore.setItemAsync).toHaveBeenCalled()
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()

    // delete should remove from SecureStore when present
    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValue('100')
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)
    await secure.deleteSecureItem(key)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled()
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
  })

  test('SecureStore unavailable for non-sensitive key: falls back to AsyncStorage', async () => {
    const key = '@bountyexpo:secure:non_sensitive_key'

    // SecureStore throws
    ;(SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))

    // AsyncStorage holds the fallback
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue('fallback')

    const v = await secure.getSecureItem(key)
    expect(v).toBe('fallback')
    expect(SecureStore.getItemAsync).toHaveBeenCalled()
    expect(AsyncStorage.getItem).toHaveBeenCalled()

    // set should write to AsyncStorage when SecureStore fails
    await secure.setSecureItem(key, 'abc')
    expect(AsyncStorage.setItem).toHaveBeenCalled()

    // delete should remove from AsyncStorage when fallback exists
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue('abc')
    ;(SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))
    await secure.deleteSecureItem(key)
    expect(AsyncStorage.removeItem).toHaveBeenCalled()
  })

  test('SecureStore unavailable for sensitive key: operations throw and do not touch AsyncStorage', async () => {
    const key = secure.SecureKeys.WALLET_TRANSACTIONS

    ;(SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))
    ;(SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))
    ;(SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('unavailable'))

    // get should throw
    await expect(secure.getSecureItem(key)).rejects.toThrow('SecureStoreUnavailable')
    // set should throw
    await expect(secure.setSecureItem(key, 'x')).rejects.toThrow('SecureStoreUnavailable')
    // delete should throw
    await expect(secure.deleteSecureItem(key)).rejects.toThrow('SecureStoreUnavailable')

    // Ensure AsyncStorage was not used for sensitive key
    expect(AsyncStorage.getItem).not.toHaveBeenCalled()
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
  })
})
