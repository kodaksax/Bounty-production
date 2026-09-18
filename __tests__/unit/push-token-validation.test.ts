import { isValidExpoPushToken } from '../../supabase/functions/process-notification/push-token-validation'

describe('isValidExpoPushToken', () => {
  test('accepts ExponentPushToken and ExpoPushToken forms', () => {
    expect(isValidExpoPushToken('ExponentPushToken[abc123]')).toBe(true)
    expect(isValidExpoPushToken('ExpoPushToken[abc123]')).toBe(true)
  })

  test('accepts a legacy raw device token (bare UUID)', () => {
    expect(isValidExpoPushToken('0e0e14c4-e9f3-5fcd-882b-df18d6a10a49')).toBe(true)
  })

  test('trims surrounding whitespace before validating', () => {
    expect(isValidExpoPushToken('  ExponentPushToken[abc]  ')).toBe(true)
  })

  test('rejects malformed tokens that Expo would reject', () => {
    expect(isValidExpoPushToken('ExponentPushToken[abc')).toBe(false)
    expect(isValidExpoPushToken('ExponentPushToken[]')).toBe(false)
    expect(isValidExpoPushToken('ExponentPushToken[a b c]')).toBe(false)
    expect(isValidExpoPushToken('ExponentPushToken[abc]]')).toBe(false)
    expect(isValidExpoPushToken('not-a-token')).toBe(false)
    expect(isValidExpoPushToken('fcm:APA91bF...')).toBe(false)
    expect(isValidExpoPushToken('')).toBe(false)
  })

  test('rejects non-string values', () => {
    expect(isValidExpoPushToken(null)).toBe(false)
    expect(isValidExpoPushToken(undefined)).toBe(false)
    expect(isValidExpoPushToken(12345)).toBe(false)
  })
})
