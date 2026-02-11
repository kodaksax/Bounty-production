jest.useFakeTimers()

describe('waitForAuthEvent', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves quickly on auth change and unsubscribes', async () => {
    const unsubscribeMock = jest.fn()

    const onAuthStateChangeMock = jest.fn((cb: any) => {
      // return subscription first, then call the callback asynchronously
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'u1' } }), 0)
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        auth: {
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    const { waitForAuthEvent } = require('../../../hooks/useWebSocket')

    const p = waitForAuthEvent(5000)
    // run timers to trigger setTimeout(0)
    jest.runOnlyPendingTimers()
    const res = await p

    expect(res).not.toBeNull()
    expect(res!.user.id).toBe('u1')
    expect(onAuthStateChangeMock).toHaveBeenCalled()
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('times out after 5s and returns null and unsubscribes', async () => {
    const unsubscribeMock = jest.fn()
    const onAuthStateChangeMock = jest.fn((_cb: any) => {
      // never call callback
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        auth: {
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    const { waitForAuthEvent } = require('../../../hooks/useWebSocket')

    const p = waitForAuthEvent(5000)
    jest.advanceTimersByTime(5000)
    // allow microtasks
    await Promise.resolve()
    const res = await p

    expect(res).toBeNull()
    expect(onAuthStateChangeMock).toHaveBeenCalled()
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('ignores unrelated auth events until a session is present', async () => {
    const unsubscribeMock = jest.fn()
    const onAuthStateChangeMock = jest.fn((cb: any) => {
      setTimeout(() => cb('TOKEN_REFRESHED', null), 10)
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'final' } }), 20)
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        auth: {
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    const { waitForAuthEvent } = require('../../../hooks/useWebSocket')

    const p = waitForAuthEvent(5000)
    jest.advanceTimersByTime(20)
    const res = await p

    expect(res).not.toBeNull()
    expect(res!.user.id).toBe('final')
    expect(unsubscribeMock).toHaveBeenCalled()
  })

  it('handles synchronous onAuthStateChange callback that returns subscription afterwards', async () => {
    const unsubscribeMock = jest.fn()

    const onAuthStateChangeMock = jest.fn((cb: any) => {
      // Call callback synchronously before returning the subscription
      cb('SIGNED_IN', { user: { id: 'sync' } })
      return { data: { subscription: { unsubscribe: unsubscribeMock } } }
    })

    jest.doMock('../../../lib/supabase', () => ({
      supabase: {
        auth: {
          onAuthStateChange: onAuthStateChangeMock,
        },
      },
    }))

    const { waitForAuthEvent } = require('../../../hooks/useWebSocket')

    const res = await waitForAuthEvent(5000)

    expect(res).not.toBeNull()
    expect(res!.user.id).toBe('sync')
    expect(onAuthStateChangeMock).toHaveBeenCalled()
    expect(unsubscribeMock).toHaveBeenCalled()
  })
})
