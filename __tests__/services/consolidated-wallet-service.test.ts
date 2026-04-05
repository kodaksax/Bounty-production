/* eslint-disable @typescript-eslint/no-var-requires */
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

let supabaseModule: any;

function makeQuery(result: any) {
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    lte: () => q,
    order: () => q,
    range: () => q,
    insert: () => q,
    update: () => q,
    single: async () => result,
    maybeSingle: async () => result,
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return q;
}

function makeAdmin(fromResults: any[] = [], rpcResult: any = { data: null, error: null }) {
  let call = 0;
  return {
    from: (table: string) => {
      const res = fromResults[call++] ?? { data: null, error: null };
      return makeQuery(res);
    },
    rpc: jest.fn().mockResolvedValue(rpcResult),
  };
}

describe('consolidated-wallet-service', () => {
  beforeEach(() => {
    jest.resetModules();
    // Re-require the mocked module so its createClient mock is the one used by newly-required modules
    supabaseModule = require('@supabase/supabase-js');
    jest.clearAllMocks();
  });

  test('getTransactions returns formatted transactions and pagination', async () => {
    const txs = [
      {
        id: 't1', user_id: 'u1', type: 'deposit', amount: 10, description: null, status: 'completed', bounty_id: null,
        stripe_payment_intent_id: null, stripe_transfer_id: null, stripe_connect_account_id: null, metadata: null, created_at: '2021-01-01', updated_at: null,
      },
    ];

    const mockAdmin = makeAdmin([{ data: txs, error: null, count: txs.length }]);
    supabaseModule.createClient.mockReturnValue(mockAdmin);

    const service = require('../../services/api/src/services/consolidated-wallet-service');

    const res = await service.getTransactions('u1', { limit: 10, offset: 0 });

    expect(res.transactions).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.limit).toBe(10);
    expect(res.offset).toBe(0);
    expect(res.transactions[0].description).toBe('deposit transaction');
  });

  test('getTransactions throws ExternalServiceError on DB error', async () => {
    const mockAdmin = makeAdmin([{ data: null, error: { message: 'DB down' } }]);
    supabaseModule.createClient.mockReturnValue(mockAdmin);

    const service = require('../../services/api/src/services/consolidated-wallet-service');

    await expect(service.getTransactions('u1')).rejects.toThrow(/External service error/i);
  });

  test('getTransactionByPaymentIntent returns record and handles PGRST116', async () => {
    const tx = { id: 'tx_1', user_id: 'u1', amount: 5, type: 'deposit', description: 'd', status: 'completed', created_at: '2021' };
    // Success case
    let mockAdmin = makeAdmin([{ data: tx, error: null }]);
    supabaseModule.createClient.mockReturnValue(mockAdmin);
    let service = require('../../services/api/src/services/consolidated-wallet-service');
    const found = await service.getTransactionByPaymentIntent('pi_1');
    expect(found).toBeTruthy();
    expect(found.id).toBe('tx_1');

    // PGRST116 -> return null
    mockAdmin = makeAdmin([{ data: null, error: { code: 'PGRST116', message: 'not found' } }]);
    supabaseModule.createClient.mockReturnValue(mockAdmin);
    service = require('../../services/api/src/services/consolidated-wallet-service');
    const missing = await service.getTransactionByPaymentIntent('pi_notfound');
    expect(missing).toBeNull();
  });

  test('createDeposit returns minimal transaction when RPC applied', async () => {
    // Sequence: check existingTx -> rpc apply_deposit -> fetch by id (not found)
    const fromResults = [
      { data: null, error: null }, // existingTx check
      { data: null, error: null }, // fetch by id after rpc
    ];

    const rpcResult = { data: [{ applied: true, tx_id: 'tx_rpc_1' }], error: null };
    const mockAdmin = makeAdmin(fromResults, rpcResult as any);
    supabaseModule.createClient.mockReturnValue(mockAdmin);

    const service = require('../../services/api/src/services/consolidated-wallet-service');

    // Spy getTransactionByPaymentIntent to ensure it returns null (so falling back to rpc result)
    jest.spyOn(service, 'getTransactionByPaymentIntent').mockResolvedValue(null);

    const tx = await service.createDeposit('user_1', 12.34, 'pi_123');
    expect(tx).toBeTruthy();
    expect(tx.id).toBe('tx_rpc_1');
    expect(tx.amount).toBe(12.34);
    expect(tx.type).toBe('deposit');
  });
});
