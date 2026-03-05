/* eslint-env jest */
// Unit tests for lib/services/bounty-request-service.ts

describe('bounty-request-service branches', () => {
  const REAL_ENV = process.env
  const { createFromMockFactory, supabaseError } = require('../../lib/__tests__/supabase-mock')

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...REAL_ENV, API_BASE_URL: 'http://api.test' }
  })

  afterEach(() => {
    process.env = REAL_ENV
    jest.restoreAllMocks()
  })

  test('getById API fallback handles thrown plain-object errors and returns null', async () => {
    // Mock supabase module to indicate API fallback (not configured)
    jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }))
    // Spy logger
    const loggerMock = { error: jest.fn(), warning: jest.fn(), info: jest.fn() }
    jest.doMock('lib/utils/error-logger', () => ({ logger: loggerMock }))

    // Make fetch throw a plain object (mimic Supabase plain-object throws)
    // @ts-ignore
    global.fetch = jest.fn().mockImplementation(() => { throw { error: { message: 'plain supabase error' } } })

    const { bountyRequestService } = require('lib/services/bounty-request-service')
    const res = await bountyRequestService.getById('notfound')
    expect(res).toBeNull()
    expect(loggerMock.error).toHaveBeenCalled()
  })

  test('getAll Supabase error path returns empty array and logs', async () => {
    // Use shared mock factory to simulate Supabase select error
    const supabaseMock = { from: createFromMockFactory({
      bounty_requests: { select: { error: { message: 'db error' } } }
    }) }

    jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: true, supabase: supabaseMock }))
    const loggerMock = { error: jest.fn(), warning: jest.fn(), info: jest.fn() }
    jest.doMock('lib/utils/error-logger', () => ({ logger: loggerMock }))

    const { bountyRequestService } = require('lib/services/bounty-request-service')
    const res = await bountyRequestService.getAll()
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(0)
    expect(loggerMock.error).toHaveBeenCalled()
  })

  test('getAllWithDetails guards against null bounty_id / hunter_id and logs warnings', async () => {
    // Return a single request row with null ids
    const supabaseMock2 = { from: createFromMockFactory({
      bounty_requests: { select: [{ id: 'r1', bounty_id: null, hunter_id: null }] }
    }) }

    const loggerMock = { error: jest.fn(), warning: jest.fn(), info: jest.fn() }
    jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: true, supabase: supabaseMock2 }))
    jest.doMock('lib/utils/error-logger', () => ({ logger: loggerMock }))

    const { bountyRequestService } = require('lib/services/bounty-request-service')
    const res = await bountyRequestService.getAllWithDetails()
    expect(Array.isArray(res)).toBe(true)
    expect(res.length).toBe(1)
    expect((res[0] as any).bounty).toBeUndefined()
    expect((res[0] as any).profile).toBeUndefined()
    expect(loggerMock.warning).toHaveBeenCalledTimes(2)
  })

  test('create() Supabase duplicate/insertion returns existing record and logs', async () => {
    // Use factory to return poster_id for bounties, insert returns unique-violation,
    // and selecting the existing bounty_request returns the existing record.
    const supabaseMock3 = { from: createFromMockFactory({
      bounties: { select: [{ poster_id: 'poster-1' }] },
      bounty_requests: {
        insert: { error: supabaseError('23505', 'duplicate key') },
        select: [{ id: 'existing-1', bounty_id: 'b1', hunter_id: 'h1' }]
      }
    }) }

    const loggerMock3 = { error: jest.fn(), warning: jest.fn(), info: jest.fn() }
    jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: true, supabase: supabaseMock3 }))
    jest.doMock('lib/utils/error-logger', () => ({ logger: loggerMock3 }))

    // Re-require service after mocks
    const { bountyRequestService: brs } = require('lib/services/bounty-request-service')
    const payload = { bounty_id: 'b1', hunter_id: 'h1' }
    const res = await brs.create(payload)
    expect(res).toEqual(expect.objectContaining({ id: 'existing-1' }))
    // ensure logger was called for the insertion failure
    expect(loggerMock3.error).toHaveBeenCalled()
  })

})
