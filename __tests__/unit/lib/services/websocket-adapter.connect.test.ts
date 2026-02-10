jest.useFakeTimers()

describe('wsAdapter.connect() token fallback', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    // restore global WebSocket
    // @ts-ignore
    delete global.WebSocket
  })

  it('proceeds to create WebSocket when token arrives via onAuthStateChange', async () => {
    const unsubscribeMock = jest.fn()

    const onAuthStateChangeMock = jest.fn((cb: any) => {
      // Provide session synchronously for deterministic test behavior
      cb('SIGNED_IN', { access_token: 'tok-abc' })
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    const getSessionMock = jest.fn().mockResolvedValue({ data: { session: null } })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: getSessionMock,
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    // Mock NetInfo to report connected
    jest.doMock('@react-native-community/netinfo', () => ({
      fetch: jest.fn().mockResolvedValue({ isConnected: true }),
    }))

    // Provide a fake probeHost by mocking the module function on the adapter after import

    // Mock global WebSocket constructor to capture URL
    let createdUrl: string | undefined
    // @ts-ignore
    global.WebSocket = jest.fn().mockImplementation((url: string) => {
      createdUrl = url
      return {
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      }
    })

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')

    // stub probeHost to avoid network calls
    jest.spyOn(wsAdapter as any, 'probeHost').mockResolvedValue(true)

    const p = wsAdapter.connect()
    // trigger the async auth callback
    jest.runOnlyPendingTimers()
    await p

    expect(getSessionMock).toHaveBeenCalled()
    expect(onAuthStateChangeMock).toHaveBeenCalled()
    expect(unsubscribeMock).toHaveBeenCalled()
    expect(createdUrl).toBeDefined()
    expect(createdUrl).toContain('token=tok-abc')
  })

  it('times out and does not create a WebSocket when no token appears', async () => {
    const unsubscribeMock = jest.fn()
    const onAuthStateChangeMock = jest.fn((_cb: any) => {
      // never call the callback
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    const getSessionMock = jest.fn().mockResolvedValue({ data: { session: null } })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: getSessionMock,
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    jest.doMock('@react-native-community/netinfo', () => ({
      fetch: jest.fn().mockResolvedValue({ isConnected: true }),
    }))

    // @ts-ignore
    global.WebSocket = jest.fn()

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')
    jest.spyOn(wsAdapter as any, 'probeHost').mockResolvedValue(true)

    // Start connect but don't await the returned promise; instead drive timers
    // and assert side-effects. This prevents the test from hanging if the
    // internal promise is still pending while timers run under fake timers.
    wsAdapter.connect()
    // allow microtasks to let connect() advance to the timer scheduling
    await Promise.resolve()
    // Force any pending timers (including the 5s fallback) to run
    jest.runOnlyPendingTimers()
    // allow microtasks
    await Promise.resolve()

    // No WebSocket should have been constructed
    // @ts-ignore
    expect(global.WebSocket).not.toHaveBeenCalled()
    expect(onAuthStateChangeMock).toHaveBeenCalled()
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('clears timeout and only unsubscribes once when token arrives early', async () => {
    const unsubscribeMock = jest.fn()

    const onAuthStateChangeMock = jest.fn((cb: any) => {
      // Provide session synchronously to ensure timeout is cleared
      cb('SIGNED_IN', { access_token: 'tok-xyz' })
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    const getSessionMock = jest.fn().mockResolvedValue({ data: { session: null } })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: {
          getSession: getSessionMock,
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    jest.doMock('@react-native-community/netinfo', () => ({
      fetch: jest.fn().mockResolvedValue({ isConnected: true }),
    }))

    // @ts-ignore
    global.WebSocket = jest.fn().mockImplementation(() => ({ send: jest.fn(), close: jest.fn(), readyState: 1 }))

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')
    jest.spyOn(wsAdapter as any, 'probeHost').mockResolvedValue(true)

    const p = wsAdapter.connect()
    // trigger the auth callback after 10ms
    jest.advanceTimersByTime(10)
    await p

    // advance far past the timeout window to see if the timeout handler would try to unsubscribe again
    jest.advanceTimersByTime(6000)

    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })
})
