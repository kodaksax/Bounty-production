/**
 * supabase.channel(topic) returns the channel still registered under that
 * topic, and removeChannel() only unregisters it once the server acks the
 * leave. The adapter used to re-create its broadcast channels without waiting
 * for that, so:
 *  - a reconnect after CHANNEL_ERROR re-bound every handler onto the same
 *    channel, and each network drop delivered every message.new once more;
 *  - leaving and quickly re-opening a chat bound typing handlers onto the
 *    closing channel, and typing indicators went dead for that chat.
 */

type Binding = { event: string; cb: (msg: { payload: any }) => void }

function setup() {
  jest.resetModules()

  // Mirrors the real client: a topic stays registered (and is handed back by
  // channel()) until its removal resolves, which each test controls.
  const registry = new Map<string, any>()
  const created: any[] = []
  const removals: { channel: any; resolve: () => void }[] = []

  const makeChannel = (topic: string) => {
    const bindings: Binding[] = []
    const channel: any = {
      topic,
      state: 'closed',
      statusCb: undefined as undefined | ((s: string) => void),
      on: jest.fn((_type: string, { event }: { event: string }, cb: Binding['cb']) => {
        bindings.push({ event, cb })
        return channel
      }),
      subscribe: jest.fn((cb?: (s: string) => void) => {
        // Real subscribe() is a no-op unless the channel is closed.
        if (channel.state === 'closed') {
          channel.state = 'joining'
          channel.statusCb = cb
        }
        return channel
      }),
      send: jest.fn().mockResolvedValue('ok'),
      fire: (event: string, payload: any) =>
        bindings.filter(b => b.event === event).forEach(b => b.cb({ payload })),
      report: (status: string) => {
        channel.state = status === 'SUBSCRIBED' ? 'joined' : status === 'CLOSED' ? 'closed' : 'errored'
        channel.statusCb?.(status)
      },
    }
    created.push(channel)
    return channel
  }

  const supabase = {
    auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    channel: jest.fn((topic: string) => {
      if (!registry.has(topic)) registry.set(topic, makeChannel(topic))
      return registry.get(topic)
    }),
    removeChannel: jest.fn(
      (channel: any) =>
        new Promise<string>(resolve => {
          channel.state = 'leaving'
          removals.push({
            channel,
            resolve: () => {
              registry.delete(channel.topic)
              channel.report('CLOSED')
              resolve('ok')
            },
          })
        })
    ),
  }

  jest.doMock('../../../../lib/supabase', () => ({ supabase }))
  const { wsAdapter } = require('../../../../lib/services/websocket-adapter')
  return { wsAdapter, supabase, created, removals }
}

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('wsAdapter channel rebinding', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('delivers each message.new once after reconnecting from CHANNEL_ERROR', async () => {
    const { wsAdapter, created, removals } = setup()
    const received = jest.fn()
    wsAdapter.on('message.new', received)

    await wsAdapter.connect()
    const first = created[0]
    first.report('SUBSCRIBED')

    first.report('CHANNEL_ERROR')
    jest.advanceTimersByTime(3000)
    await flushPromises()

    // Nothing is re-created on the topic until the old channel is gone.
    expect(created).toHaveLength(1)
    expect(first.on).toHaveBeenCalledTimes(5)
    removals[0].resolve()
    await flushPromises()

    expect(created).toHaveLength(2)
    const second = created[1]
    expect(second).not.toBe(first)
    second.report('SUBSCRIBED')
    expect(wsAdapter.isConnected()).toBe(true)

    second.fire('message.new', { id: 'm1' })
    expect(received).toHaveBeenCalledTimes(1)
    // The old channel's CLOSED must not tear down the new one.
    expect(wsAdapter.getConnectionState()).toBe('OPEN')
  })

  it('keeps a channel that Realtime already rejoined on its own', async () => {
    const { wsAdapter, supabase, created } = setup()
    await wsAdapter.connect()
    created[0].report('SUBSCRIBED')

    created[0].report('CHANNEL_ERROR')
    created[0].report('SUBSCRIBED') // socket came back, phoenix rejoined
    jest.advanceTimersByTime(3000)
    await flushPromises()

    expect(supabase.removeChannel).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(created[0].on).toHaveBeenCalledTimes(5) // not re-bound
    expect(wsAdapter.isConnected()).toBe(true)
  })

  it('schedules one reconnect for repeated errors', async () => {
    const { wsAdapter, supabase, created } = setup()
    await wsAdapter.connect()
    created[0].report('SUBSCRIBED')

    created[0].report('CHANNEL_ERROR')
    created[0].report('CHANNEL_ERROR')
    jest.advanceTimersByTime(3000)

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('does not reconnect after disconnect() during a pending reconnect', async () => {
    const { wsAdapter, created, removals } = setup()
    await wsAdapter.connect()
    created[0].report('SUBSCRIBED')
    created[0].report('CHANNEL_ERROR')

    wsAdapter.disconnect()
    jest.advanceTimersByTime(3000)
    removals.forEach(r => r.resolve())
    await flushPromises()

    expect(created).toHaveLength(1)
    expect(wsAdapter.getConnectionState()).toBe('CLOSED')
  })

  it('re-opening a chat while its typing channel is closing binds a fresh channel', async () => {
    const { wsAdapter, created, removals } = setup()
    const typing = jest.fn()
    wsAdapter.on('typing.start', typing)

    wsAdapter.joinConversation('c1')
    wsAdapter.leaveConversation('c1')
    wsAdapter.joinConversation('c1')

    // Still closing: no new channel yet, and typing sends are dropped quietly.
    expect(created).toHaveLength(1)
    wsAdapter.sendTyping('c1', true)
    expect(created[0].send).not.toHaveBeenCalled()

    removals[0].resolve()
    await flushPromises()

    expect(created).toHaveLength(2)
    const fresh = created[1]
    expect(fresh).not.toBe(created[0])
    expect(fresh.subscribe).toHaveBeenCalledTimes(1)
    fresh.fire('typing.start', { senderId: 'u2' })
    expect(typing).toHaveBeenCalledTimes(1)
    expect(typing).toHaveBeenCalledWith({ senderId: 'u2', conversationId: 'c1' })
  })

  it('does not create a typing channel for a chat left again before the old one closed', async () => {
    const { wsAdapter, created, removals } = setup()

    wsAdapter.joinConversation('c1')
    wsAdapter.leaveConversation('c1')
    wsAdapter.joinConversation('c1')
    wsAdapter.leaveConversation('c1')

    removals[0].resolve()
    await flushPromises()

    expect(created).toHaveLength(1)
  })
})
