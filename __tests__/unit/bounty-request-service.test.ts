// Unit tests for bounty-request-service

// Keep imports inside tests so we can mock dependencies first
describe('bountyRequestService (unit)', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  // Note: create() duplicate-insert behaviour covered elsewhere; keep focused test on acceptRequest

  test('acceptRequest creates escrow and updates bounty payment intent when escrow succeeds', async () => {
    // Mock logger
    jest.doMock('../../lib/utils/error-logger', () => ({
      logger: { error: jest.fn(), warning: jest.fn(), info: jest.fn() },
    }))

    // Mock payment-service
    const createEscrow = jest.fn().mockResolvedValue({ success: true, escrowId: 'esc_123' })
    jest.doMock('../../lib/services/payment-service', () => ({ paymentService: { createEscrow } }))

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
})
