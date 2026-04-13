/* eslint-env jest */
// Mock dependencies BEFORE importing the module under test
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
  isSupabaseConfigured: true,
}));
jest.mock('../../../lib/utils/bounty-validation', () => ({ validateTitle: jest.fn() }));
jest.mock('../../../lib/utils/error-logger', () => ({
  logger: { error: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../../lib/utils/network', () => ({
  getReachableApiBaseUrl: jest.fn(() => 'http://localhost:3001'),
}));
jest.mock('../../../lib/utils/postgrest-utils', () => ({
  escapeIlike: jest.fn(s => s),
  quotePostgrestValue: jest.fn(s => `"${s}"`),
}));
jest.mock('../../../lib/services/offline-queue-service', () => ({
  offlineQueueService: { enqueue: jest.fn() },
}));
jest.mock('../../../lib/services/websocket-adapter', () => ({
  wsAdapter: { isConnected: jest.fn(), send: jest.fn() },
}));

// After mocks are in place, import the service under test
const { bountyService } = require('../../../lib/services/bounty-service');
const { supabase } = require('../../../lib/supabase');
const NetInfo = require('@react-native-community/netinfo');
const { validateTitle } = require('../../../lib/utils/bounty-validation');
const { offlineQueueService } = require('../../../lib/services/offline-queue-service');
const { wsAdapter } = require('../../../lib/services/websocket-adapter');
const { logger } = require('../../../lib/utils/error-logger');

describe('bountyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    if (supabase && supabase.from && typeof supabase.from.mockReset === 'function') {
      supabase.from.mockReset();
    }
  });

  it('getById returns flattened bounty when Supabase returns join', async () => {
    // supabase.from('bounties').select(...).eq(...).single() -> data
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() =>
            Promise.resolve({
              data: { id: 1, user_id: 'u1', profiles: { username: 'bob', avatar: 'pic' } },
              error: null,
            })
          ),
        })),
      })),
    }));

    const res = await bountyService.getById(1);
    expect(res).not.toBeNull();
    expect(res.username).toBe('bob');
    expect(res.poster_avatar).toBe('pic');
    expect(res.user_id).toBe('u1');
  });

  it('getById falls back when profiles relationship missing and attaches profile', async () => {
    // 1st call: initial select with join -> returns relationship error
    supabase.from
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({
                data: null,
                error: {
                  message: "Could not find a relationship between 'bounties' and 'profiles'",
                },
              })
            ),
          })),
        })),
      }))
      // 2nd call: raw bounty fetch (no join)
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({ data: { id: 2, poster_id: 'p1' }, error: null })
            ),
          })),
        })),
      }))
      // 3rd call: profiles fetch
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          in: jest.fn(() =>
            Promise.resolve({ data: [{ id: 'p1', username: 'alice', avatar: 'av' }], error: null })
          ),
        })),
      }));

    const res = await bountyService.getById(2);
    expect(res).not.toBeNull();
    expect(res.username).toBe('alice');
    expect(res.poster_avatar).toBe('av');
  });

  it('addAttachmentToBounty merges attachments and updates via Supabase', async () => {
    // Spy on internal getById to return an existing bounty with attachments_json string
    jest
      .spyOn(bountyService, 'getById')
      .mockResolvedValue({ id: 3, attachments_json: JSON.stringify(['old']) } as any);

    // Mock supabase update chain to succeed
    supabase.from.mockImplementationOnce(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => Promise.resolve({ data: [], error: null })),
        })),
      })),
    }));

    const ok = await bountyService.addAttachmentToBounty(3, { file: 'new' });
    expect(ok).toBe(true);
  });

  it('create throws when title validation fails', async () => {
    (validateTitle as jest.Mock).mockReturnValue('Title too short');
    await expect(bountyService.create({ title: 'sh' })).rejects.toThrow('Title too short');
  });

  it('create queues bounty when offline', async () => {
    (validateTitle as jest.Mock).mockReturnValue(null);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });

    const queued = await bountyService.create({ title: 'Offline bounty' });
    expect(offlineQueueService.enqueue).toHaveBeenCalledWith('bounty', expect.any(Object));
    expect(queued).toHaveProperty('status', 'open');
    expect(typeof queued.id).toBe('number');
  });

  it('update returns null for invalid id', async () => {
    const res = await bountyService.update(null, {});
    expect(res).toBeNull();
  });

  it('updateStatus notifies websocket when connected', async () => {
    jest.spyOn(bountyService, 'update').mockResolvedValue({ id: 5, status: 'completed' } as any);
    (wsAdapter.isConnected as jest.Mock).mockReturnValue(true);

    const res = await bountyService.updateStatus(5, 'completed');
    expect(res).not.toBeNull();
    expect(wsAdapter.send).toHaveBeenCalledWith(
      'bounty.status',
      expect.objectContaining({ id: 5, status: 'completed' })
    );
  });

  it('delete returns true when Supabase delete succeeds', async () => {
    supabase.from.mockImplementationOnce(() => ({
      delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
    }));
    const ok = await bountyService.delete(10);
    expect(ok).toBe(true);
  });
});
