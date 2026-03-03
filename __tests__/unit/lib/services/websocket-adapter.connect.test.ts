describe('wsAdapter — Supabase Realtime', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('connects via supabase.channel and emits connect on SUBSCRIBED', async () => {
    const subscribeMock = jest.fn()
    const onMock = jest.fn().mockReturnThis()
    const channelMock = { on: onMock, subscribe: subscribeMock, send: jest.fn().mockResolvedValue('ok') }

    let subscribeCb: ((status: string) => void) | null = null
    subscribeMock.mockImplementation((cb: (status: string) => void) => {
      subscribeCb = cb
      return channelMock
    })

    const channelFactoryMock = jest.fn().mockReturnValue(channelMock)
    const getSessionMock = jest.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: { getSession: getSessionMock },
        channel: channelFactoryMock,
        removeChannel: jest.fn().mockResolvedValue(undefined),
      },
    }))

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')

    const connectPromise = wsAdapter.connect()

    // Simulate Supabase Realtime reporting SUBSCRIBED
    if (subscribeCb) (subscribeCb as any)('SUBSCRIBED')

    await connectPromise

    expect(channelFactoryMock).toHaveBeenCalledWith('realtime:app-events', expect.any(Object))
    expect(wsAdapter.isConnected()).toBe(true)
    expect(wsAdapter.getConnectionState()).toBe('OPEN')
  })

  it('does not create a second channel when called twice while connected', async () => {
    const subscribeMock = jest.fn()
    const onMock = jest.fn().mockReturnThis()
    const channelMock = { on: onMock, subscribe: subscribeMock, send: jest.fn().mockResolvedValue('ok') }

    subscribeMock.mockImplementation((cb: (status: string) => void) => {
      cb('SUBSCRIBED')
      return channelMock
    })

    const channelFactoryMock = jest.fn().mockReturnValue(channelMock)
    const getSessionMock = jest.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: { getSession: getSessionMock },
        channel: channelFactoryMock,
        removeChannel: jest.fn().mockResolvedValue(undefined),
      },
    }))

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')

    await wsAdapter.connect()
    await wsAdapter.connect() // second call should be no-op

    expect(channelFactoryMock).toHaveBeenCalledTimes(1)
  })

  it('emits disconnect and cleans up channels on disconnect()', async () => {
    const removeChannelMock = jest.fn().mockResolvedValue(undefined)
    const subscribeMock = jest.fn()
    const onMock = jest.fn().mockReturnThis()
    const channelMock = { on: onMock, subscribe: subscribeMock, send: jest.fn().mockResolvedValue('ok') }

    subscribeMock.mockImplementation((cb: (status: string) => void) => {
      cb('SUBSCRIBED')
      return channelMock
    })

    jest.doMock('../../../../lib/supabase', () => ({
      supabase: {
        auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
        channel: jest.fn().mockReturnValue(channelMock),
        removeChannel: removeChannelMock,
      },
    }))

    const { wsAdapter } = require('../../../../lib/services/websocket-adapter')

    const disconnectEvents: any[] = []
    wsAdapter.on('disconnect', (d: any) => disconnectEvents.push(d))

    await wsAdapter.connect()
    wsAdapter.disconnect()

    expect(wsAdapter.isConnected()).toBe(false)
    expect(removeChannelMock).toHaveBeenCalledWith(channelMock)
    expect(disconnectEvents.length).toBeGreaterThan(0)
  })
})

