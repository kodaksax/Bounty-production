import { transactionService } from '../../../lib/services/transaction-service'

describe('transactionService', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
    jest.resetAllMocks()
  })

  test('getTransactions parses dates and returns transactions', async () => {
    const mockResponse = {
      transactions: [
        { id: '1', amount: 10, date: '2023-01-01T00:00:00.000Z', type: 'escrow' },
      ],
      count: 1,
    }

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockResponse })

    const res = await transactionService.getTransactions('user-1')
    expect(res.error).toBeNull()
    expect(res.count).toBe(1)
    expect(res.transactions[0].date instanceof Date).toBe(true)
    expect(res.transactions[0].date.toISOString()).toBe('2023-01-01T00:00:00.000Z')
  })

  test('getTransactionById 404 returns null transaction', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'Not found' })

    const res = await transactionService.getTransactionById('missing')
    expect(res.transaction).toBeNull()
    // API treats 404 as null/no error in this method
    expect(res.error).toBeNull()
  })

  test('recordTransaction converts date string to Date', async () => {
    const newTx = { id: 'abc', amount: 5, date: '2024-02-02T12:00:00.000Z', type: 'release' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ...newTx }) })

    const res = await transactionService.recordTransaction(
      { amount: 5, type: 'release' } as Parameters<typeof transactionService.recordTransaction>[0]
    )
    expect(res.transaction).not.toBeNull()
    expect(res.transaction!.date instanceof Date).toBe(true)
    expect(res.transaction!.date.toISOString()).toBe('2024-02-02T12:00:00.000Z')
  })
})
