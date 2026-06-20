import { decideChannels, mapTypeToPreferenceKey } from '../../supabase/functions/process-notification/preferences'

describe('mapTypeToPreferenceKey', () => {
  test('maps known types to granular preference keys', () => {
    expect(mapTypeToPreferenceKey('message')).toBe('messages')
    expect(mapTypeToPreferenceKey('application')).toBe('applications')
    expect(mapTypeToPreferenceKey('acceptance')).toBe('acceptances')
    expect(mapTypeToPreferenceKey('completion')).toBe('completions')
    expect(mapTypeToPreferenceKey('review_needed')).toBe('completions')
    expect(mapTypeToPreferenceKey('payment')).toBe('payments')
    expect(mapTypeToPreferenceKey('follow')).toBe('follows')
    expect(mapTypeToPreferenceKey('dispute')).toBe('disputes')
  })

  test('returns null for unknown / system types', () => {
    expect(mapTypeToPreferenceKey('update')).toBeNull()
    expect(mapTypeToPreferenceKey('system')).toBeNull()
    expect(mapTypeToPreferenceKey(undefined)).toBeNull()
    expect(mapTypeToPreferenceKey(null)).toBeNull()
  })
})

describe('decideChannels', () => {
  test('no preferences row => both channels allowed', () => {
    expect(decideChannels(null, 'message')).toEqual({ inApp: true, push: true })
    expect(decideChannels(undefined, 'application')).toEqual({ inApp: true, push: true })
  })

  test('granular toggle false (bare column) suppresses both channels', () => {
    expect(decideChannels({ messages: false }, 'message')).toEqual({ inApp: false, push: false })
  })

  test('granular toggle false (_enabled column) suppresses both channels', () => {
    expect(decideChannels({ applications_enabled: false }, 'application')).toEqual({ inApp: false, push: false })
  })

  test('granular toggle true/missing inherits allow', () => {
    expect(decideChannels({ messages: true }, 'message')).toEqual({ inApp: true, push: true })
    expect(decideChannels({ messages: null }, 'message')).toEqual({ inApp: true, push: true })
    expect(decideChannels({}, 'message')).toEqual({ inApp: true, push: true })
  })

  test('push_enabled false suppresses only push, keeps in-app bell', () => {
    expect(decideChannels({ push_enabled: false }, 'message')).toEqual({ inApp: true, push: false })
  })

  test('in_app_enabled false suppresses only the bell, keeps push', () => {
    expect(decideChannels({ in_app_enabled: false }, 'message')).toEqual({ inApp: false, push: true })
  })

  test('granular disable wins over channel toggles', () => {
    expect(
      decideChannels({ messages: false, push_enabled: true, in_app_enabled: true }, 'message')
    ).toEqual({ inApp: false, push: false })
  })

  test('unknown type ignores granular gate but honors channel toggles', () => {
    expect(decideChannels({ push_enabled: false }, 'update')).toEqual({ inApp: true, push: false })
  })
})
