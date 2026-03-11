// Tests for lib/services/navigation-intent.ts
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}))

describe('navigationIntent service', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.restoreAllMocks()
  })

  test('set + getAndClear uses in-memory value and clears it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage')
    AsyncStorage.setItem.mockResolvedValue(undefined)
    AsyncStorage.removeItem.mockResolvedValue(undefined)

    // Load the module fresh so it picks up the current mock
    const navigationIntent = require('../../../lib/services/navigation-intent').default

    await navigationIntent.setPendingConversationId('abc')

    const v = await navigationIntent.getAndClearPendingConversationId()
    expect(v).toBe('abc')

    // subsequent call returns null
    const v2 = await navigationIntent.getAndClearPendingConversationId()
    expect(v2).toBeNull()
  })

  test('getAndClear reads from storage when no in-memory value', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage')
    AsyncStorage.getItem.mockResolvedValue('stored-id')
    AsyncStorage.removeItem.mockResolvedValue(undefined)

    const navigationIntent = require('../../../lib/services/navigation-intent').default

    const v = await navigationIntent.getAndClearPendingConversationId()
    expect(v).toBe('stored-id')
    expect(AsyncStorage.removeItem).toHaveBeenCalled()
  })

  test('handles AsyncStorage failures without throwing', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage')

    const err = new Error('storage fail')
    AsyncStorage.setItem.mockRejectedValueOnce(err)
    AsyncStorage.removeItem.mockRejectedValueOnce(err)
    AsyncStorage.getItem.mockRejectedValueOnce(err)

    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const navigationIntent = require('../../../lib/services/navigation-intent').default

    // setPendingConversationId should catch and log errors
    await navigationIntent.setPendingConversationId('x')
    expect(spyError).toHaveBeenCalled()

    // clearing should attempt removeItem and log warn on failure
    await navigationIntent.setPendingConversationId(null)
    expect(spyWarn).toHaveBeenCalled()

    // getAndClear should return null and log error when getItem fails
    const v = await navigationIntent.getAndClearPendingConversationId()
    expect(v).toBeNull()
    expect(spyError).toHaveBeenCalled()
  })
})
