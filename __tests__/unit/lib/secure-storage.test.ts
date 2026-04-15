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

describe('migrateSecureStorageKeys', () => {
  // Re-require the module fresh for each test so the module-level state is clean
  let secure: typeof import('../../../lib/utils/secure-storage')

  // Mock Platform so we can test the iOS guard
  const mockPlatform = { OS: 'ios' }
  jest.mock('react-native', () => ({
    Platform: mockPlatform,
  }))

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    mockPlatform.OS = 'ios'

    ;(SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null)
    ;(SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined)
    ;(SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined)

    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)
    ;(AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined)

    secure = require('../../../lib/utils/secure-storage')
  })

  test('migrates old colon-containing keys to sanitized keys and deletes the old keys', async () => {
    // sanitizeSecureKey replaces '@' and ':' with '_', so the destination keys
    // have a leading underscore: _bountyexpo_secure_*
    const oldValues: Record<string, string> = {
      '@bountyexpo:secure:wallet_balance': '100',
      '@bountyexpo:secure:wallet_transactions': '[{"id":"tx1"}]',
      '@bountyexpo:secure:wallet_last_deposit_ts': '1700000000000',
      '@bountyexpo:secure:payment_token': 'tok_abc',
    }

    // AsyncStorage has no migration flag yet
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)

    // SecureStore returns values for old keys, null for anything else
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      return Promise.resolve(oldValues[key] ?? null)
    })

    await secure.migrateSecureStorageKeys()

    // Each sanitized (new) key should have been written with the correct value.
    // sanitizeSecureKey('@bountyexpo:secure:wallet_balance') -> '_bountyexpo_secure_wallet_balance'
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_wallet_balance',
      '100',
      expect.anything()
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_wallet_transactions',
      '[{"id":"tx1"}]',
      expect.anything()
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_wallet_last_deposit_ts',
      '1700000000000',
      expect.anything()
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_payment_token',
      'tok_abc',
      expect.anything()
    )

    // Each old key should have been deleted
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '@bountyexpo:secure:wallet_balance',
      expect.anything()
    )
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '@bountyexpo:secure:wallet_transactions',
      expect.anything()
    )
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '@bountyexpo:secure:wallet_last_deposit_ts',
      expect.anything()
    )
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '@bountyexpo:secure:payment_token',
      expect.anything()
    )

    // The migration flag should have been set
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@bountyexpo:keyMigrationV1Done', 'true')
  })

  test('does not migrate when the migration flag is already set', async () => {
    // Migration already completed
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue('true')

    await secure.migrateSecureStorageKeys()

    // SecureStore should not have been touched at all
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled()
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })

  test('skips keys that have no old value and still completes migration', async () => {
    // Only wallet_balance has an old value; the others are absent
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)
    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      Promise.resolve(key === '@bountyexpo:secure:wallet_balance' ? '42' : null)
    )

    await secure.migrateSecureStorageKeys()

    // Only the present key should have been written and deleted
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_wallet_balance',
      '42',
      expect.anything()
    )
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1)
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      '@bountyexpo:secure:wallet_balance',
      expect.anything()
    )

    // Flag should still be set (no errors)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@bountyexpo:keyMigrationV1Done', 'true')
  })

  test('continues migrating remaining keys when one key fails, but does NOT set the flag', async () => {
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)

    ;(SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      // Fail on the first legacy key, succeed on the others
      if (key === '@bountyexpo:secure:wallet_balance') {
        return Promise.reject(new Error('keychain error'))
      }
      return Promise.resolve(key === '@bountyexpo:secure:wallet_transactions' ? 'txdata' : null)
    })

    // Should not throw
    await expect(secure.migrateSecureStorageKeys()).resolves.toBeUndefined()

    // The second key (transactions) should still have been migrated
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      '_bountyexpo_secure_wallet_transactions',
      'txdata',
      expect.anything()
    )

    // Flag must NOT be set so the migration retries on the next launch
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })

  test('on non-iOS platforms: sets flag immediately without probing SecureStore', async () => {
    mockPlatform.OS = 'android'
    // Re-require after changing platform so the module picks up the mock
    secure = require('../../../lib/utils/secure-storage')
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(null)

    await secure.migrateSecureStorageKeys()

    // SecureStore must not be probed on Android
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled()
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()

    // Flag should be set so subsequent calls skip immediately
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@bountyexpo:keyMigrationV1Done', 'true')
  })
})
