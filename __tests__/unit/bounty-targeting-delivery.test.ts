import { isTargetingOutbox, processTargetingOutbox } from '../../supabase/functions/process-notification/targeting-delivery'
import { extractInvalidTokens } from '../../supabase/functions/process-notification/push-receipts'

function fixture() {
  const row = { id: 'outbox', title: 'Nearby', body: 'New work', data: {
    type: 'bounty_nearby', targeting_version: 1, bountyId: 'bounty', stage: 1,
  } }
  const states = new Map<string, { state: string; claim?: string }>()
  for (const hunter of ['hunter-a', 'hunter-b']) {
    for (const channel of ['push', 'in_app', 'email']) states.set(`${hunter}:${channel}`, { state: 'pending' })
  }
  const tables: Record<string, any> = {
    bounties: { id: 'bounty', status: 'open', is_test: false, poster_id: 'poster' },
    profiles: ['hunter-a', 'hunter-b'].map(id => ({
      id, account_status: 'active', deleted_at: null, quiet_hours_start: null, quiet_hours_end: null,
    })),
    notification_channel_preferences: ['hunter-a', 'hunter-b'].map(user_id => ({ user_id, channel: 'email', enabled: false })),
    bounty_requests: [],
    push_tokens: [{ token: 'ExpoPushToken[one]' }],
  }
  const insert = jest.fn(async () => ({ error: null }))
  const prune = jest.fn()
  const events: { event: string; distinct_id: string; properties: Record<string, unknown> }[] = []
  const errors: Record<string, any> = {}
  let allowed = true
  let quiet = false
  const admin = {
    from(table: string) {
      const query: any = {
        select: () => query, eq: () => query, in: () => query,
        maybeSingle: async () => ({ data: tables[table], error: errors[table] ?? null }),
        then(resolve: any) { return Promise.resolve({ data: tables[table], error: errors[table] ?? null }).then(resolve) },
        insert,
        delete() {
          return { in: async (_column: string, tokens: string[]) => {
            prune(tokens)
            return { error: null }
          } }
        },
      }
      return query
    },
    rpc: jest.fn(async (name: string, args: any) => {
      if (name === 'fn_bounty_distribution_gate') return { data: { allowed }, error: null }
      const key = `${args.p_hunter_id}:${args.p_channel}`
      const entry = states.get(key)!
      if (name === 'fn_claim_bounty_targeting_delivery') {
        const claimed = ['pending', 'failed'].includes(entry.state)
        if (claimed) states.set(key, { state: 'processing', claim: args.p_claim_id })
        return { data: claimed, error: null }
      }
      if (name === 'fn_ack_bounty_targeting_delivery') {
        const owns = entry.state === 'processing' && entry.claim === args.p_claim_id
        if (owns) states.set(key, { ...entry, state: args.p_state })
        return { data: owns, error: null }
      }
      if (name === 'fn_finish_bounty_targeting_outbox') {
        return { data: [...states.values()].every(s => !['pending', 'failed', 'processing'].includes(s.state)), error: null }
      }
      throw new Error(`Unexpected RPC ${name}`)
    }),
  }
  const fetcher = jest.fn(async () => ({
    ok: true, json: async () => ({ data: [{ status: 'ok', id: 'ticket' }] }),
  } as Response))
  let claim = 0
  const run = () => processTargetingOutbox({
    admin, row, recipients: ['hunter-a', 'hunter-b', 'hunter-a'],
    supabaseUrl: 'https://example.invalid', serviceRoleKey: 'test-only',
    fetcher, newClaimId: () => String(++claim), isValidToken: token => typeof token === 'string',
    isQuiet: () => quiet,
    invalidTokens: extractInvalidTokens,
    emitEvent: event => events.push(event),
  })
  return { run, states, tables, errors, fetcher, insert, admin, prune, events,
    setAllowed: (value: boolean) => { allowed = value },
    setQuiet: (value: boolean) => { quiet = value },
  }
}

describe('new bounty-nearby durable delivery claims', () => {
  it('does not intercept legacy or unrelated notification types', () => {
    expect(isTargetingOutbox({ data: { type: 'payment', targeting_version: 1 } })).toBe(false)
    expect(isTargetingOutbox({ data: { type: 'bounty_nearby' } })).toBe(false)
    expect(isTargetingOutbox({ data: { type: 'bounty_nearby', targeting_version: 1 } })).toBe(true)
  })

  it('concurrent workers send once per recipient, then retries send nothing', async () => {
    const f = fixture()
    await Promise.all([f.run(), f.run()])
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(f.insert).toHaveBeenCalledTimes(2)
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(f.insert).toHaveBeenCalledTimes(2)
  })

  it('retries only explicitly rejected recipients, not accepted pushes or in-app entries', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ status: 'error' }] }) } as Response)
    expect((await f.run()).ok).toBe(false)
    expect(f.states.get('hunter-a:push')?.state).toBe('failed')
    expect(f.states.get('hunter-b:push')?.state).toBe('accepted')
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(3)
    expect(f.insert).toHaveBeenCalledTimes(2)
  })

  it('retries an HTTP 429 rejection without resending already accepted recipients', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValueOnce({
      ok: false, status: 429, json: async () => ({ errors: [{ code: 'TOO_MANY_REQUESTS' }] }),
    } as Response)
    expect((await f.run()).ok).toBe(false)
    expect(f.states.get('hunter-a:push')?.state).toBe('failed')
    expect(f.states.get('hunter-b:push')?.state).toBe('accepted')
    expect((await f.run()).ok).toBe(true)
    expect(f.fetcher).toHaveBeenCalledTimes(3)
    expect(f.insert).toHaveBeenCalledTimes(2)
    expect(f.states.get('hunter-a:push')?.state).toBe('accepted')
  })

  it('keeps HTTP 5xx outcomes terminal unknown rather than treating them as request rejections', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null } as Response)
    await f.run()
    expect(f.states.get('hunter-a:push')?.state).toBe('unknown')
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  it('never retries acknowledged recipients when another device ticket was rejected', async () => {
    const f = fixture()
    f.tables.push_tokens = [{ token: 'ExpoPushToken[one]' }, { token: 'ExpoPushToken[two]' }]
    f.fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok', id: 'accepted-device' }, { status: 'error' }] }),
    } as Response)
    await f.run()
    expect(f.states.get('hunter-a:push')?.state).toBe('accepted')
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not resend a push after a lost provider response', async () => {
    const f = fixture()
    f.fetcher.mockRejectedValueOnce(new Error('Connection lost'))
    await f.run()
    expect(f.states.get('hunter-a:push')?.state).toBe('unknown')
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not claim malformed/unknown provider success as acceptance', async () => {
    const f = fixture()
    f.fetcher.mockResolvedValue({ ok: true, json: async () => ({ data: [{}] }) } as Response)
    const result = await f.run()
    expect(result.acceptedPushRecipients).toBe(0)
    expect(f.states.get('hunter-a:push')?.state).toBe('unknown')
  })

  it.each(['is_test', 'closed', 'gate'])('suppresses %s bounties before any delivery', async reason => {
    const f = fixture()
    if (reason === 'is_test') f.tables.bounties.is_test = true
    if (reason === 'closed') f.tables.bounties.status = 'completed'
    if (reason === 'gate') f.setAllowed(false)
    await f.run()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.insert).not.toHaveBeenCalled()
  })

  it('excludes deleted/inactive users, posters and existing applicants', async () => {
    const f = fixture()
    f.tables.profiles[0].deleted_at = '2026-10-14'
    f.tables.profiles[1].account_status = 'suspended'
    await f.run()
    expect(f.fetcher).not.toHaveBeenCalled()
    const poster = fixture()
    poster.tables.bounties.poster_id = 'hunter-a'
    poster.tables.bounty_requests = [{ hunter_id: 'hunter-b' }]
    await poster.run()
    expect(poster.insert).not.toHaveBeenCalled()
  })

  it('honors channel opt-outs and fails closed when preferences cannot be fetched', async () => {
    const f = fixture()
    f.tables.notification_channel_preferences.push({ user_id: 'hunter-a', channel: 'push', enabled: false })
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    const broken = fixture()
    broken.errors.notification_channel_preferences = { message: 'Lookup failed' }
    await expect(broken.run()).rejects.toThrow('eligibility lookup failed')
    expect(broken.fetcher).not.toHaveBeenCalled()
    expect(broken.states.get('hunter-a:push')?.state).toBe('pending')
  })

  it('allows retries after token lookup failure before the provider was contacted', async () => {
    const f = fixture()
    f.errors.push_tokens = { message: 'Lookup failed' }
    await f.run()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.states.get('hunter-a:push')?.state).toBe('failed')
    delete f.errors.push_tokens
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    expect(f.insert).toHaveBeenCalledTimes(2)
  })

  it('honors quiet hours without blocking in-app notifications', async () => {
    const f = fixture()
    f.setQuiet(true)
    await f.run()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.insert).toHaveBeenCalledTimes(2)
    expect(f.states.get('hunter-a:push')?.state).toBe('suppressed')
  })

  it('acknowledges email per recipient and does not repeat it on retries', async () => {
    const f = fixture()
    f.tables.notification_channel_preferences = []
    f.fetcher.mockImplementation(async (url: any) => ({
      ok: true,
      json: async () => String(url).includes('send-notification-email')
        ? { sent: 1 } : { data: [{ status: 'ok', id: 'ticket' }] },
    } as Response))
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(4)
    await f.run()
    expect(f.fetcher).toHaveBeenCalledTimes(4)
    expect(f.states.get('hunter-a:email')?.state).toBe('accepted')
  })

  it('uses the existing distribution gate RPC contract', async () => {
    const f = fixture()
    await f.run()
    expect(f.admin.rpc).toHaveBeenCalledWith('fn_bounty_distribution_gate', {
      p_bounty_id: 'bounty', p_path: 'targeting', p_stage: 1, p_require_credibility: false,
    })
  })

  it('prunes only permanently invalid tokens using the existing ticket classifier', async () => {
    const f = fixture()
    f.tables.push_tokens = [{ token: 'ExpoPushToken[dead]' }, { token: 'ExpoPushToken[healthy]' }]
    f.fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', details: { error: 'InvalidCredentials' } },
      ] }),
    } as Response)
    await f.run()
    expect(f.prune).toHaveBeenCalledWith(['ExpoPushToken[dead]'])
    expect(f.prune).not.toHaveBeenCalledWith(expect.arrayContaining(['ExpoPushToken[healthy]']))
  })

  it('preserves coarse events without equating provider acceptance to device delivery', async () => {
    const f = fixture()
    await f.run()
    expect(f.events.filter(e => e.event === 'notification_generated')).toHaveLength(2)
    const sent = f.events.find(e => e.event === 'notification_sent' && e.properties.channel === 'push')
    expect(sent?.properties.delivery_basis).toBe('provider_accepted')
    expect(sent?.properties.device_delivery_confirmed).toBe(false)
    const count = f.events.length
    await f.run()
    expect(f.events).toHaveLength(count)
  })
})
