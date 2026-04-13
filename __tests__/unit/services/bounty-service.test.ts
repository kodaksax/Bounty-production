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
    const spyGet = jest
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
    spyGet.mockRestore();
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
    const spyUpdate = jest
      .spyOn(bountyService, 'update')
      .mockResolvedValue({ id: 5, status: 'completed' } as any);
    (wsAdapter.isConnected as jest.Mock).mockReturnValue(true);

    const res = await bountyService.updateStatus(5, 'completed');
    expect(res).not.toBeNull();
    expect(wsAdapter.send).toHaveBeenCalledWith(
      'bounty.status',
      expect.objectContaining({ id: 5, status: 'completed' })
    );
    spyUpdate.mockRestore();
  });

  it('delete returns true when Supabase delete succeeds', async () => {
    supabase.from.mockImplementationOnce(() => ({
      delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
    }));
    const ok = await bountyService.delete(10);
    expect(ok).toBe(true);
  });

  it('search returns empty for blank query', async () => {
    const res = await bountyService.search('   ');
    expect(res).toEqual([]);
  });

  it('search returns flattened bounties when Supabase returns data with profiles', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn(() =>
                Promise.resolve({
                  data: [{ id: 7, user_id: 'u7', profiles: { username: 'sam', avatar: 'a' } }],
                  error: null,
                })
              ),
            })),
          })),
        })),
      })),
    }));

    const results = await bountyService.search('term');
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe('sam');
    expect(results[0].poster_avatar).toBe('a');
  });

  it('search falls back and attaches profiles when join missing', async () => {
    // 1st call: initial select with join -> relationship error
    supabase.from
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            or: jest.fn(() => ({
              order: jest.fn(() => ({
                range: jest.fn(() =>
                  Promise.resolve({
                    data: null,
                    error: {
                      message: "Could not find a relationship between 'bounties' and 'profiles'",
                    },
                  })
                ),
              })),
            })),
          })),
        })),
      }))
      // 2nd call: raw bounty fetch (no join)
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            or: jest.fn(() => ({
              order: jest.fn(() => ({
                range: jest.fn(() =>
                  Promise.resolve({ data: [{ id: 8, poster_id: 'p2' }], error: null })
                ),
              })),
            })),
          })),
        })),
      }))
      // 3rd call: profiles fetch
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          in: jest.fn(() =>
            Promise.resolve({ data: [{ id: 'p2', username: 'z', avatar: 'zz' }], error: null })
          ),
        })),
      }));

    const res = await bountyService.search('x');
    expect(res).toHaveLength(1);
    expect(res[0].username).toBe('z');
    expect(res[0].poster_avatar).toBe('zz');
  });

  it('addAttachmentToBounty falls back to API when Supabase update fails', async () => {
    const spyGet2 = jest
      .spyOn(bountyService, 'getById')
      .mockResolvedValue({ id: 9, attachments_json: JSON.stringify([]) } as any);

    supabase.from.mockImplementationOnce(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() =>
            Promise.resolve({ data: null, error: { message: 'update failed' } })
          ),
        })),
      })),
    }));

    const realFetch = global.fetch;
    // Mock API fallback to succeed
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true });

    const ok = await bountyService.addAttachmentToBounty(9, { file: 'new2' });
    expect((global as any).fetch).toHaveBeenCalled();
    expect(ok).toBe(true);

    // restore
    (global as any).fetch = realFetch;
    spyGet2.mockRestore();
  });

  it('create inserts via Supabase when possible', async () => {
    (validateTitle as jest.Mock).mockReturnValue(null);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });

    // 1: rate limit count check
    supabase.from
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ gte: jest.fn(() => Promise.resolve({ count: 0, error: null })) })),
        })),
      }))
      // 2: duplicate check
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ gte: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
        })),
      }))
      // 3: profile lookup
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() =>
              Promise.resolve({ data: { username: 'puser' }, error: null })
            ),
          })),
        })),
      }))
      // 4: insert
      .mockImplementationOnce(() => ({
        insert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({ data: { id: 100, title: 'created' }, error: null })
            ),
          })),
        })),
      }));

    const created = await bountyService.create({
      title: 'test create',
      poster_id: 'poster-1',
    } as any);
    expect(created).not.toBeNull();
    expect((created as any).id).toBe(100);
  });

  it('update returns bounty when Supabase update succeeds', async () => {
    supabase.from.mockImplementationOnce(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() =>
              Promise.resolve({ data: { id: 42, title: 'updated' }, error: null })
            ),
          })),
        })),
      })),
    }));

    const res = await bountyService.update(42, { title: 'updated' });
    expect(res).not.toBeNull();
    expect((res as any).id).toBe(42);
  });

  it('delete returns false when Supabase delete errors', async () => {
    supabase.from.mockImplementationOnce(() => ({
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: { message: 'boom' } })),
      })),
    }));
    const ok = await bountyService.delete(11);
    expect(ok).toBe(false);
  });

  it('updateStatus does not send when websocket is disconnected', async () => {
    const spyUpdate2 = jest
      .spyOn(bountyService, 'update')
      .mockResolvedValue({ id: 15, status: 'in_progress' } as any);
    (wsAdapter.isConnected as jest.Mock).mockReturnValue(false);

    const res = await bountyService.updateStatus(15, 'in_progress');
    expect(res).not.toBeNull();
    expect(wsAdapter.send).not.toHaveBeenCalled();
    spyUpdate2.mockRestore();
  });
});
