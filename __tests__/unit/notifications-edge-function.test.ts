import {
  createNotificationsHandler,
  deletePushToken,
  registerPushToken,
  type NotificationEdgeAdminClient,
} from '../../supabase/functions/notifications/handler'

type PushTokenRecord = {
  profile_id?: string
  user_id?: string
  token: string
  device_id?: string | null
  enabled?: boolean
}

function createAdminClient(options?: {
  userId?: string | null
  ownerColumn?: 'profile_id' | 'user_id'
  profiles?: Array<{ id: string }>
  tokens?: PushTokenRecord[]
}) {
  const state = {
    ownerColumn: options?.ownerColumn ?? 'profile_id',
    profiles: [...(options?.profiles ?? [{ id: 'user-1' }])],
    tokens: [...(options?.tokens ?? [])],
  }

  const admin: NotificationEdgeAdminClient = {
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: options?.userId === null ? null : { id: options?.userId ?? 'user-1' } },
        error: options?.userId === null ? { message: 'invalid' } : null,
      })),
    },
    from(table: string) {
      if (table === 'profiles') {
        return {
          select(_columns: string) {
            return {
              eq(column: string, value: unknown) {
                return {
                  maybeSingle: async () => ({
                    data: column === 'id'
                      ? state.profiles.find(profile => profile.id === value) ?? null
                      : null,
                    error: null,
                  }),
                }
              },
            }
          },
          upsert(row: Record<string, unknown>) {
            const id = String(row.id)
            if (!state.profiles.some(profile => profile.id === id)) {
              state.profiles.push({ id })
            }
            return Promise.resolve({ data: { id }, error: null })
          },
          update() {
            throw new Error('not implemented')
          },
          delete() {
            throw new Error('not implemented')
          },
        } as any
      }

      if (table === 'push_tokens') {
        return {
          select(columns: string) {
            return {
              limit: async (_count: number) => {
                if (!columns.includes(state.ownerColumn)) {
                  return { error: { code: '42703', message: `column \"${columns}\" does not exist` } }
                }
                return { data: [], error: null }
              },
              eq(column: string, value: unknown) {
                return {
                  maybeSingle: async () => ({
                    data: state.tokens.find(token => (token as any)[column] === value) ?? null,
                    error: null,
                  }),
                }
              },
            }
          },
          upsert(row: Record<string, unknown>) {
            const token = String(row.token)
            const existingIndex = state.tokens.findIndex(entry => entry.token === token)
            if (existingIndex >= 0) {
              state.tokens[existingIndex] = {
                ...state.tokens[existingIndex],
                ...row,
              }
            } else {
              state.tokens.push({ ...(row as PushTokenRecord) })
            }
            return Promise.resolve({ data: null, error: null })
          },
          update(values: Record<string, unknown>) {
            return {
              eq(ownerColumn: string, ownerValue: unknown) {
                return {
                  eq(deviceColumn: string, deviceValue: unknown) {
                    return {
                      neq(tokenColumn: string, tokenValue: unknown) {
                        state.tokens = state.tokens.map(entry => {
                          if (
                            (entry as any)[ownerColumn] === ownerValue &&
                            (entry as any)[deviceColumn] === deviceValue &&
                            (entry as any)[tokenColumn] !== tokenValue
                          ) {
                            return { ...entry, ...values }
                          }
                          return entry
                        })
                        return Promise.resolve({ data: null, error: null })
                      },
                    }
                  },
                }
              },
            }
          },
          delete() {
            return {
              eq(ownerColumn: string, ownerValue: unknown) {
                return {
                  eq(tokenColumn: string, tokenValue: unknown) {
                    state.tokens = state.tokens.filter(entry => {
                      return !(
                        (entry as any)[ownerColumn] === ownerValue &&
                        (entry as any)[tokenColumn] === tokenValue
                      )
                    })
                    return Promise.resolve({ data: null, error: null })
                  },
                }
              },
            }
          },
        } as any
      }

      throw new Error(`Unexpected table ${table}`)
    },
  }

  return { admin, state }
}

describe('notifications edge function', () => {
  it('registers a new token for the authenticated user', async () => {
    const { admin, state } = createAdminClient()

    const result = await registerPushToken(admin, 'user-1', 'ExpoPushToken[new-token]', 'device-a')

    expect(result).toEqual({ existed: false, reenabled: false })
    expect(state.tokens).toEqual([
      expect.objectContaining({
        profile_id: 'user-1',
        token: 'ExpoPushToken[new-token]',
        device_id: 'device-a',
        enabled: true,
      }),
    ])
  })

  it('updates an existing token and preserves device_id when omitted', async () => {
    const { admin, state } = createAdminClient({
      tokens: [{ profile_id: 'user-1', token: 'ExpoPushToken[same]', device_id: 'device-a', enabled: true }],
    })

    const result = await registerPushToken(admin, 'user-1', 'ExpoPushToken[same]')

    expect(result).toEqual({ existed: true, reenabled: false })
    expect(state.tokens[0]).toEqual(expect.objectContaining({ device_id: 'device-a', enabled: true }))
  })

  it('is idempotent for duplicate registration', async () => {
    const { admin, state } = createAdminClient({
      tokens: [{ profile_id: 'user-1', token: 'ExpoPushToken[same]', device_id: 'device-a', enabled: true }],
    })

    await registerPushToken(admin, 'user-1', 'ExpoPushToken[same]', 'device-a')
    await registerPushToken(admin, 'user-1', 'ExpoPushToken[same]', 'device-a')

    expect(state.tokens).toHaveLength(1)
  })

  it('re-enables a previously disabled token on re-registration', async () => {
    const { admin, state } = createAdminClient({
      tokens: [{ profile_id: 'user-1', token: 'ExpoPushToken[disabled]', device_id: 'device-a', enabled: false }],
    })

    const result = await registerPushToken(admin, 'user-1', 'ExpoPushToken[disabled]')

    expect(result).toEqual({ existed: true, reenabled: true })
    expect(state.tokens[0].enabled).toBe(true)
  })

  it('supports multiple devices per user and disables stale token on the same device', async () => {
    const { admin, state } = createAdminClient({
      tokens: [
        { profile_id: 'user-1', token: 'ExpoPushToken[old-device-a]', device_id: 'device-a', enabled: true },
        { profile_id: 'user-1', token: 'ExpoPushToken[device-b]', device_id: 'device-b', enabled: true },
      ],
    })

    await registerPushToken(admin, 'user-1', 'ExpoPushToken[new-device-a]', 'device-a')

    expect(state.tokens).toHaveLength(3)
    expect(state.tokens.find(token => token.token === 'ExpoPushToken[old-device-a]')?.enabled).toBe(false)
    expect(state.tokens.find(token => token.token === 'ExpoPushToken[device-b]')?.enabled).toBe(true)
    expect(state.tokens.find(token => token.token === 'ExpoPushToken[new-device-a]')).toEqual(
      expect.objectContaining({ profile_id: 'user-1', device_id: 'device-a', enabled: true })
    )
  })

  it('rejects unauthenticated requests', async () => {
    const { admin } = createAdminClient({ userId: null })
    const handler = createNotificationsHandler({ createAdminClient: () => admin })

    const response = await handler(new Request('https://example.supabase.co/functions/v1/notifications/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ExpoPushToken[abc]' }),
    }))

    expect(response.status).toBe(401)
  })

  it('rejects invalid token payloads', async () => {
    const { admin } = createAdminClient()
    const handler = createNotificationsHandler({ createAdminClient: () => admin })

    const response = await handler(new Request('https://example.supabase.co/functions/v1/notifications/register-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify({ token: 'not-a-token' }),
    }))

    expect(response.status).toBe(400)
  })

  it('deletes a token for the authenticated user', async () => {
    const { admin, state } = createAdminClient({
      tokens: [{ profile_id: 'user-1', token: 'ExpoPushToken[abc]', device_id: 'device-a', enabled: true }],
    })

    await deletePushToken(admin, 'user-1', 'ExpoPushToken[abc]')

    expect(state.tokens).toHaveLength(0)
  })
})