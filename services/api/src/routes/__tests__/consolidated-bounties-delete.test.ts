/* eslint-env jest */

jest.mock('../../config', () => ({
  config: {
    supabase: {
      url: 'http://localhost:54321',
      anonKey: 'anon-key',
      serviceRoleKey: 'service-role-key',
    },
  },
}));

jest.mock('../../services/redis-service', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null) },
  cacheInvalidation: {
    invalidateBounty: jest.fn().mockResolvedValue(undefined),
    invalidateBountyLists: jest.fn().mockResolvedValue(undefined),
  },
  CacheKeyPrefix: { BOUNTY_LIST: 'bounty_list', BOUNTY: 'bounty' },
}));

const fromMock = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: fromMock })),
}));

import { registerConsolidatedBountyRoutes } from '../consolidated-bounties';

describe('DELETE /api/bounties/:id', () => {
  let handler: (request: any, reply: any) => Promise<any>;
  const bounty = { id: 'bounty-1', user_id: 'owner-1' };

  const fastify: any = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: (_path: string, _opts: any, h: any) => {
      handler = h;
    },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };

  function makeRequest() {
    return {
      params: { id: bounty.id },
      userId: 'owner-1',
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    };
  }

  function fetchBountyOnce() {
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: bounty, error: null })),
        })),
      })),
    };
  }

  beforeEach(async () => {
    fromMock.mockReset();
    await registerConsolidatedBountyRoutes(fastify);
  });

  it('retries after FK violation by clearing bounty_payments then succeeds', async () => {
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce()) // fetch bounty for ownership check
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { code: '23503', message: 'fk violation' } })),
        })),
      })) // initial delete hits FK violation
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        })),
      })) // bounty_payments delete succeeds
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        })),
      })); // retry delete succeeds

    const result = await handler(makeRequest(), {} as any);
    expect(result).toEqual({ success: true, message: 'Bounty deleted successfully' });
  });

  it('throws when clearing bounty_payments fails after FK violation', async () => {
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce())
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { code: '23503', message: 'fk violation' } })),
        })),
      }))
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'payments delete failed' } })),
        })),
      }));

    await expect(handler(makeRequest(), {} as any)).rejects.toThrow('payments delete failed');
  });

  it('throws when retry delete fails after clearing bounty_payments', async () => {
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce())
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { code: '23503', message: 'fk violation' } })),
        })),
      }))
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        })),
      }))
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'retry failed' } })),
        })),
      }));

    await expect(handler(makeRequest(), {} as any)).rejects.toThrow('retry failed');
  });

  it('throws directly for non-FK delete errors', async () => {
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce())
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() =>
            Promise.resolve({ error: { code: '42501', message: 'permission denied' } })
          ),
        })),
      }));

    await expect(handler(makeRequest(), {} as any)).rejects.toThrow('permission denied');
  });
});
