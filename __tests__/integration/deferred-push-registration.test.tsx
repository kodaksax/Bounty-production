import { render, waitFor } from '@testing-library/react-native'

// Mock Supabase client
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      refreshSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
  isSupabaseConfigured: true,
}))

// Mock Auth profile service
jest.mock('../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    setSession: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
  },
}))

// Mock analytics service
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { identifyUser: jest.fn(), trackEvent: jest.fn(), reset: jest.fn() },
}))

// Mock AsyncStorage and notificationService
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}))

jest.mock('../../lib/services/notification-service', () => ({
  notificationService: {
    requestPermissionsAndRegisterToken: jest.fn(() => Promise.resolve(null)),
  },
}))

const { supabase } = require('../../lib/supabase')
const AsyncStorage = require('@react-native-async-storage/async-storage')
const { notificationService } = require('../../lib/services/notification-service')
const { DEFERRED_PUSH_REGISTRATION_KEY } = require('../../lib/constants')
const AuthProvider = require('../../providers/auth-provider').default

describe('Deferred push registration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('consumes deferred push registration flag on SIGNED_IN', async () => {
    const mockSession = {
      access_token: 'token',
      user: { id: 'user1', email: 'a@b.com' },
    }

    // Make getSession return null initially
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })

    // Make onAuthStateChange capture the callback
    let capturedCallback: any = null
    supabase.auth.onAuthStateChange.mockImplementation((cb: any) => {
      capturedCallback = cb
      return { data: { subscription: { unsubscribe: jest.fn() } } }
    })

    // AsyncStorage contains the deferred flag
    AsyncStorage.getItem.mockResolvedValue('true')

    render(
      <AuthProvider>
        <></>
      </AuthProvider>
    )

    // Simulate SIGNED_IN event after mount
    await waitFor(async () => {
      expect(capturedCallback).toBeDefined()
      await capturedCallback('SIGNED_IN', mockSession)
    })

    // Expect AsyncStorage.getItem was checked and removeItem called
    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      expect(notificationService.requestPermissionsAndRegisterToken).toHaveBeenCalled()
    })
  })

  it('does not call registration when flag is not set', async () => {
    const mockSession = { access_token: 't', user: { id: 'u' } }

    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    let captured: any = null
    supabase.auth.onAuthStateChange.mockImplementation((cb: any) => {
      captured = cb
      return { data: { subscription: { unsubscribe: jest.fn() } } }
    })

    // No flag present
    AsyncStorage.getItem.mockResolvedValue(null)

    render(<AuthProvider><></></AuthProvider>)

    await waitFor(async () => {
      expect(captured).toBeDefined()
      await captured('SIGNED_IN', mockSession)
    })

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
      expect(notificationService.requestPermissionsAndRegisterToken).not.toHaveBeenCalled()
    })
  })

  it('handles registration failure gracefully (logs and continues)', async () => {
    const mockSession = { access_token: 't2', user: { id: 'u2' } }

    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    let captured: any = null
    supabase.auth.onAuthStateChange.mockImplementation((cb: any) => {
      captured = cb
      return { data: { subscription: { unsubscribe: jest.fn() } } }
    })

    // Flag present
    AsyncStorage.getItem.mockResolvedValue('true')
    // Registration fails
    notificationService.requestPermissionsAndRegisterToken.mockImplementation(() => Promise.reject(new Error('boom')))

    render(<AuthProvider><></></AuthProvider>)

    // Should not throw despite rejection
    await waitFor(async () => {
      expect(captured).toBeDefined()
      await captured('SIGNED_IN', mockSession)
    })

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      expect(notificationService.requestPermissionsAndRegisterToken).toHaveBeenCalled()
    })
  })

  it('does not attempt registration when session is null even if flag exists', async () => {
    // Simulate SIGNED_IN event with null session
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    let captured: any = null
    supabase.auth.onAuthStateChange.mockImplementation((cb: any) => {
      captured = cb
      return { data: { subscription: { unsubscribe: jest.fn() } } }
    })

    // Flag present
    AsyncStorage.getItem.mockResolvedValue('true')

    render(<AuthProvider><></></AuthProvider>)

    await waitFor(async () => {
      expect(captured).toBeDefined()
      // Pass null for session argument
      await captured('SIGNED_IN', null)
    })

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(DEFERRED_PUSH_REGISTRATION_KEY)
      // Should not remove or call registration because session is null
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
      expect(notificationService.requestPermissionsAndRegisterToken).not.toHaveBeenCalled()
    })
  })
})
