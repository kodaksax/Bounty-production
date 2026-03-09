jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}))

// Stub the bounty schema import so Jest doesn't try to evaluate UI/React imports
jest.mock('components/bounty/bounty-form', () => ({
  bountySchema: {
    parse: (v: any) => v,
    partial: () => ({ parse: (v: any) => v }),
  },
}))

import AsyncStorage from '@react-native-async-storage/async-storage'
import { enhancedBountyService } from '../../../lib/services/enhanced-bounty-service'

describe('enhancedBountyService', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
    jest.resetAllMocks()
  })

  test('getAll falls back to cached data on network error', async () => {
    const key = `bounties_cache_${JSON.stringify(undefined)}`
    const cached = { data: [{ id: 1, poster_id: 'u', title: 't' }], timestamp: Date.now() }
    ;(AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(cached))

    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => 'Failed to fetch network' })

    const res = await enhancedBountyService.getAll()
    expect(res.error).toBeNull()
    expect(res.bounties).toEqual(cached.data)
  })

  test('updateLocalCache updates both user and all caches when present', async () => {
    const bounty = { id: 2, poster_id: 'user-123', title: 'Hello' } as any

    const userKey = `bounties_cache_${JSON.stringify({ userId: bounty.poster_id })}`
    const userCached = { data: [{ id: 1, poster_id: bounty.poster_id, title: 'old' }], timestamp: Date.now() }
    const allKey = `bounties_cache_${JSON.stringify({})}`
    const allCached = { data: [{ id: 1, poster_id: 'x', title: 'old' }], timestamp: Date.now() }

    ;(AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      if (key === userKey) return JSON.stringify(userCached)
      if (key === allKey) return JSON.stringify(allCached)
      return null
    })

    await enhancedBountyService.updateLocalCache(bounty)

    // Expect setItem called for both keys
    expect(AsyncStorage.setItem).toHaveBeenCalled()
    const setCalls = (AsyncStorage.setItem as jest.Mock).mock.calls.map((c) => c[0])
    expect(setCalls).toEqual(expect.arrayContaining([userKey, allKey]))
  })
})
