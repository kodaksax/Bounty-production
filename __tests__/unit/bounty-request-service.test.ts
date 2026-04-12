// Unit tests for bounty-request-service

// Keep imports inside tests so we can mock dependencies first
describe('bountyRequestService (unit)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  // Helper: build chainable Supabase mock builder
  function makeChainBuilder(resolvedValue: { data: any; error: any }) {
    const chain: any = {}
    const methods = ['from', 'update', 'select', 'eq', 'neq', 'is', 'single', 'in', 'order']
    for (const m of methods) {
      chain[m] = jest.fn().mockReturnValue(chain)
    }
    // Terminal: resolves the query
    chain.then = (resolve: any) => resolve(resolvedValue)
    // Allow await
    ;(chain as any)[Symbol.toStringTag] = 'Promise'
    return chain
  }

  // Shared rpc mock that simulates the fn_accept_bounty_request RPC function
  // not being available (PGRST202), which triggers the sequential fallback path.
  // Tests that specifically want to test the RPC path can override this.
  function makeRpcNotFoundMock() {
    return jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function fn_accept_bounty_request' },
    })
  }

  test('acceptRequest creates escrow and updates bounty payment intent when escrow succeeds', async () => {
    // Mock logger
    jest.doMock('../../lib/utils/error-logger', () => ({
      logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
    }))

    // Mock payment-service
    const createEscrow = jest.fn().mockResolvedValue({ success: true, escrowId: 'esc_123' })
    jest.doMock('../../lib/services/payment-service', () => ({ paymentService: { createEscrow } }))

    // Mock supabase so the bounty transition succeeds (bountyTransitioned = true)
    const bountyUpdateChain = makeChainBuilder({ data: [{ id: 'b1', status: 'in_progress' }], error: null })
    const rejectChain = makeChainBuilder({ data: null, error: null })
    jest.doMock('../../lib/supabase', () => ({
      isSupabaseConfigured: true,
      supabase: {
        rpc: makeRpcNotFoundMock(),
        from: jest.fn((table: string) => {
          if (table === 'bounties') return bountyUpdateChain
          if (table === 'bounty_requests') return rejectChain
          return makeChainBuilder({ data: null, error: null })
        }),
      },
    }))

    // Import the service module fresh
    const svcModule = require('../../lib/services/bounty-request-service')
    const svc = svcModule.bountyRequestService

    // Spy on internal helpers to control flow
    jest.spyOn(svc, 'updateStatus').mockResolvedValue({ id: 'r1', bounty_id: 'b1', hunter_id: 'h1' })
    jest.spyOn(svc, 'getBountyForRequest').mockResolvedValue({ id: 'b1', is_for_honor: false, amount: 25, user_id: 'poster1' })

    const updateSpy = jest.spyOn(svc, 'updateBountyPaymentIntent').mockResolvedValue(undefined)

    const result = await svc.acceptRequest('r1')

    expect(result).toEqual({ id: 'r1', bounty_id: 'b1', hunter_id: 'h1' })
    expect(createEscrow).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith('b1', 'esc_123')
  })

  test('acceptRequest transitions bounty to in_progress and rejects competing requests', async () => {
    const loggerError = jest.fn()
    jest.doMock('../../lib/utils/error-logger', () => ({
      logger: { error: loggerError, warning: jest.fn(), info: jest.fn() },
    }))
    jest.doMock('../../lib/services/payment-service', () => ({
      paymentService: { createEscrow: jest.fn().mockResolvedValue({ success: false }) },
    }))

    // Track supabase calls to verify bounty update and competing request rejection
    const bountyUpdateChain = makeChainBuilder({ data: [{ id: 'b1', status: 'in_progress' }], error: null })
    const rejectChain = makeChainBuilder({ data: null, error: null })

    // Note: updateStatus is mocked via jest.spyOn so it does not call supabase.from('bounty_requests').
    // The only supabase.from('bounty_requests') call is the reject-others query.
    jest.doMock('../../lib/supabase', () => ({
      isSupabaseConfigured: true,
      supabase: {
        rpc: makeRpcNotFoundMock(),
        from: jest.fn((table: string) => {
          if (table === 'bounties') return bountyUpdateChain
          if (table === 'bounty_requests') return rejectChain
          return makeChainBuilder({ data: null, error: null })
        }),
      },
    }))

    const svcModule = require('../../lib/services/bounty-request-service')
    const svc = svcModule.bountyRequestService

    jest.spyOn(svc, 'updateStatus').mockResolvedValue({ id: 'r1', bounty_id: 'b1', hunter_id: 'h1' })
    jest.spyOn(svc, 'getBountyForRequest').mockResolvedValue({ id: 'b1', status: 'open', is_for_honor: true, amount: 0 })
    jest.spyOn(svc, 'updateBountyPaymentIntent').mockResolvedValue(undefined)

    const result = await svc.acceptRequest('r1')

    expect(result).toEqual({ id: 'r1', bounty_id: 'b1', hunter_id: 'h1' })
    // Verify bounty was updated with in_progress status
    expect(bountyUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', accepted_by: 'h1' })
    )
    // Verify competing requests were rejected
    expect(rejectChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected' })
    )
  })

  test('acceptRequest returns null and rolls back when bounty already accepted', async () => {
    const loggerError = jest.fn()
    jest.doMock('../../lib/utils/error-logger', () => ({
      logger: { error: loggerError, warning: jest.fn(), info: jest.fn() },
    }))
    jest.doMock('../../lib/services/payment-service', () => ({
      paymentService: { createEscrow: jest.fn() },
    }))

    // Bounty update returns empty (already accepted by another request)
    const bountyUpdateChain = makeChainBuilder({ data: [], error: null })
    const rollbackChain = makeChainBuilder({ data: null, error: null })

    jest.doMock('../../lib/supabase', () => ({
      isSupabaseConfigured: true,
      supabase: {
        rpc: makeRpcNotFoundMock(),
        from: jest.fn((table: string) => {
          if (table === 'bounties') return bountyUpdateChain
          if (table === 'bounty_requests') return rollbackChain
          return makeChainBuilder({ data: null, error: null })
        }),
      },
    }))

    const svcModule = require('../../lib/services/bounty-request-service')
    const svc = svcModule.bountyRequestService

    jest.spyOn(svc, 'updateStatus').mockResolvedValue({ id: 'r1', bounty_id: 'b1', hunter_id: 'h1' })

    const result = await svc.acceptRequest('r1')

    // Should return null when bounty was already claimed
    expect(result).toBeNull()
    // Should have logged an error about the race condition
    expect(loggerError).toHaveBeenCalledWith(
      'Fallback: bounty already accepted or no longer open',
      expect.objectContaining({ requestId: 'r1', bountyId: 'b1' })
    )
    // Should have attempted to roll back the request status to pending
    expect(rollbackChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    )
  })
})
