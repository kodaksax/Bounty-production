process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

const mockCreateClient = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: any[]) => mockCreateClient(...args),
}));

jest.mock('../consolidated-payment-service', () => ({
  stripe: {
    transfers: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../stripe-safeguards', () => ({
  withStripeIdempotency: jest.fn(async (_key: string, fn: (opts?: any) => Promise<any>) => fn()),
}));

jest.mock('../logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

function getCreateEscrow() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../consolidated-wallet-service').createEscrow as (
    bountyId: string,
    posterId: string,
    amount: number,
    idempotencyKey?: string
  ) => Promise<any>;
}

type BuildOptions = {
  withdrawRpcError?: { message: string; code?: string } | null;
  completeUpdateError?: { message: string } | null;
};

function buildSupabaseAdmin(options: BuildOptions = {}) {
  const updatePayloads: any[] = [];
  const rpcCalls: Array<{ fn: string; args: any }> = [];

  let updateCallCount = 0;
  const updateEq = jest.fn(async () => {
    updateCallCount += 1;
    if (updateCallCount === 1) {
      return { error: options.completeUpdateError || null };
    }
    return { error: null };
  });

  const admin = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: null, error: null })),
            })),
          })),
        })),
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(async () => ({
            data: {
              id: 'tx_escrow_1',
              user_id: 'poster-1',
              bounty_id: 'bounty-1',
              type: 'escrow',
              amount: -50,
              description: 'Escrow for bounty bounty-1',
              status: 'pending',
              metadata: { idempotency_key: 'escrow_bounty-1_poster-1' },
              created_at: new Date().toISOString(),
            },
            error: null,
          })),
        })),
      })),
      update: jest.fn((payload: any) => {
        updatePayloads.push(payload);
        return { eq: updateEq };
      }),
    })),
    rpc: jest.fn(async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (fn === 'withdraw_balance') {
        return { error: options.withdrawRpcError || null };
      }
      if (fn === 'update_balance') {
        return { error: null };
      }
      return { error: null };
    }),
  };

  return { admin, updatePayloads, rpcCalls };
}

describe('consolidated-wallet-service createEscrow', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('marks escrow transaction as failed when balance deduction fails', async () => {
    const { admin, updatePayloads, rpcCalls } = buildSupabaseAdmin({
      withdrawRpcError: { message: 'Insufficient available balance' },
    });
    mockCreateClient.mockReturnValue(admin as any);
    const createEscrow = getCreateEscrow();

    await expect(createEscrow('bounty-1', 'poster-1', 50)).rejects.toThrow(
      'Insufficient available balance'
    );

    expect(rpcCalls.map(c => c.fn)).toEqual(['withdraw_balance']);
    expect(updatePayloads).toHaveLength(1);
    expect(updatePayloads[0]).toMatchObject({ status: 'failed' });
  });

  it('refunds poster balance if escrow finalization fails after deduction', async () => {
    const { admin, updatePayloads, rpcCalls } = buildSupabaseAdmin({
      completeUpdateError: { message: 'failed to finalize' },
    });
    mockCreateClient.mockReturnValue(admin as any);
    const createEscrow = getCreateEscrow();

    await expect(createEscrow('bounty-1', 'poster-1', 50)).rejects.toThrow(
      'Failed to finalize escrow transaction'
    );

    expect(rpcCalls.map(c => c.fn)).toEqual(['withdraw_balance', 'update_balance']);
    expect(updatePayloads).toHaveLength(2);
    expect(updatePayloads[0]).toMatchObject({ status: 'completed' });
    expect(updatePayloads[1]).toMatchObject({ status: 'failed' });
  });
});
