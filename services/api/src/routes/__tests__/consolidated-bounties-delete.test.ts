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

  it('soft-deletes on FK violation and never deletes bounty_payments', async () => {
    const softUpdateEq = jest.fn(() => Promise.resolve({ error: null }));
    const softUpdate = jest.fn(() => ({ eq: softUpdateEq }));
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce()) // fetch bounty for ownership check
      .mockImplementationOnce((table: string) => {
        // initial hard delete hits FK violation
        expect(table).toBe('bounties');
        return {
          delete: jest.fn(() => ({
            eq: jest.fn(() => Promise.resolve({ error: { code: '23503', message: 'fk violation' } })),
          })),
        };
      })
      .mockImplementationOnce((table: string) => {
        // soft-delete falls back to updating status, preserving bounty_payments
        expect(table).toBe('bounties');
        return { update: softUpdate };
      });

    const result = await handler(makeRequest(), {} as any);
    expect(result).toEqual({ success: true, message: 'Bounty deleted successfully' });
    expect(softUpdate).toHaveBeenCalledWith({ status: 'deleted' });
  });

  it('throws when the FK-violation soft-delete fails', async () => {
    fromMock
      .mockImplementationOnce(() => fetchBountyOnce())
      .mockImplementationOnce(() => ({
        delete: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { code: '23503', message: 'fk violation' } })),
        })),
      }))
      .mockImplementationOnce(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'soft-delete failed' } })),
        })),
      }));

    await expect(handler(makeRequest(), {} as any)).rejects.toThrow('soft-delete failed');
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
