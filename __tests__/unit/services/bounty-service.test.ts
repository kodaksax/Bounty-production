/* eslint-env jest */
// Mock dependencies BEFORE importing the module under test
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn() }));
jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
  isSupabaseConfigured: true,
}));
jest.mock('../../../lib/utils/bounty-validation', () => ({
  validateTitle: jest.fn(),
  validateContactInfo: jest.fn(() => null),
}));
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
  it('does not select undeployed structured columns with the shared rollout flag off', () => {
    const { FEED_SAFE_BOUNTY_COLUMNS } = require('../../../lib/services/bounty-service');
    expect(FEED_SAFE_BOUNTY_COLUMNS).not.toContain('requirements_payload');
    expect(FEED_SAFE_BOUNTY_COLUMNS).not.toContain('requirements_taxonomy_version');
    expect(FEED_SAFE_BOUNTY_COLUMNS).not.toContain('requirements_revision');
    expect(FEED_SAFE_BOUNTY_COLUMNS).not.toContain('requirements_confirmed_at');
    expect(FEED_SAFE_BOUNTY_COLUMNS).not.toContain('requirements_provenance');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    if (supabase && supabase.from && typeof supabase.from.mockReset === 'function') {
      supabase.from.mockReset();
    }
  });

  it('getById enriches the bounty with poster info from public_profiles', async () => {
    const fromCalls: string[] = [];

    // 1st call: plain bounty fetch (no `profiles` embed -- the embed resolves
    // through the base table, whose SELECT RLS is self-only, so it returned a
    // null poster for every bounty the caller did not post).
    supabase.from
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: { id: 1, user_id: 'u1' }, error: null })
              ),
            })),
          })),
        };
      })
      // 2nd call: poster enrichment from the public_profiles view
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        return {
          select: jest.fn(() => ({
            in: jest.fn(() =>
              Promise.resolve({ data: [{ id: 'u1', username: 'bob', avatar: 'pic' }], error: null })
            ),
          })),
        };
      });

    const res = await bountyService.getById(1);
    expect(res).not.toBeNull();
    expect(res.username).toBe('bob');
    expect(res.poster_avatar).toBe('pic');
    expect(res.user_id).toBe('u1');

    // Regression guard: poster enrichment must read `public_profiles`, never the
    // base `profiles` table. Reading `profiles` here returns only the caller's
    // own row, which is what made every other poster render blank.
    expect(fromCalls).toEqual(['bounties', 'public_profiles']);
    expect(fromCalls).not.toContain('profiles');
  });

  it('getById reads another users poster info from public_profiles, not profiles', async () => {
    const fromCalls: string[] = [];

    supabase.from
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(() =>
                Promise.resolve({ data: { id: 2, poster_id: 'p1' }, error: null })
              ),
            })),
          })),
        };
      })
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        return {
          select: jest.fn(() => ({
            in: jest.fn(() =>
              Promise.resolve({
                data: [{ id: 'p1', username: 'alice', avatar: 'av' }],
                error: null,
              })
            ),
          })),
        };
      });

    const res = await bountyService.getById(2);
    expect(res).not.toBeNull();
    expect(res.username).toBe('alice');
    expect(fromCalls[1]).toBe('public_profiles');
  });

  it('getById returns null when maybeSingle resolves null data without error', async () => {
    supabase.from.mockImplementationOnce(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    }));

    const res = await bountyService.getById(999);
    expect(res).toBeNull();
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
  it('never strips requested requirements or uses relay on a missing column', async () => {
    (validateTitle as jest.Mock).mockReturnValue(null);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });
    const payload = { taxonomy_version: 1, task_id: 'organize_items', terms: [] };
    const insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST204', message: 'Could not find requirements_payload column in schema cache' } }),
      })),
    }));
    supabase.from.mockReturnValue({ insert });
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      await expect(bountyService.create({ title: 'Organize household items', requirements_payload: payload })).rejects.toThrow('Task capabilities are unavailable');
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert.mock.calls[0][0].requirements_payload).toEqual(payload);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it('surfaces frozen requirement edits instead of returning a false success', async () => {
    const query: any = {
      update: jest.fn(() => query), eq: jest.fn(() => query), select: jest.fn(() => query),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'requirements_frozen_after_application' } }),
    };
    supabase.from.mockReturnValue(query);
    await expect(bountyService.update('bounty-1', { requirements_payload: null })).rejects.toThrow('Requirements cannot change');
  });
  it('queues the full structured payload, not a stripped ordinary bounty', async () => {
    (validateTitle as jest.Mock).mockReturnValue(null);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });
    const payload = { taxonomy_version: 1, task_id: 'organize_items', terms: [] };
    await bountyService.create({ title: 'Organize household items', requirements_payload: payload });
    expect(offlineQueueService.enqueue).toHaveBeenCalledWith('bounty', {
      bounty: expect.objectContaining({ requirements_payload: payload }),
    });
  });

  it('create queues bounty when offline', async () => {
    (validateTitle as jest.Mock).mockReturnValue(null);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: false });

    const queued = await bountyService.create({ title: 'Offline bounty' });
    expect(offlineQueueService.enqueue).toHaveBeenCalledWith('bounty', expect.any(Object));
    expect(queued).toHaveProperty('status', 'open');
    expect(typeof queued.id).toBe('number');
  });

  it('update rejects an invalid id with a plain reason instead of returning null', async () => {
    await expect(bountyService.update(null, {})).rejects.toThrow("This bounty couldn't be identified");
  });

  // SBA-10 (5): the server's reason reaches the caller, in plain words.
  it.each([
    [{ code: 'P0001', message: 'bounty_amount_locked_by_escrow' }, 'Your payment for this bounty is already held'],
    [{ code: '23514', message: 'bounty amount 3 is below the 5 minimum' }, 'The reward must be at least $5.'],
    [{ code: '42501', message: 'bounty_status_transition_not_allowed: open -> completed' }, 'This bounty has moved on'],
    [{ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, "isn't yours to change"],
  ])('update throws the mapped reason for %o', async (serverError, expected) => {
    const query: any = {
      update: jest.fn(() => query), eq: jest.fn(() => query), select: jest.fn(() => query),
      single: jest.fn().mockResolvedValue({ data: null, error: serverError }),
    };
    supabase.from.mockReturnValue(query);
    const err = await bountyService.update('bounty-1', { amount: 80 }).catch((e: any) => e);
    expect(err.name).toBe('BountyUpdateError');
    expect(err.message).toContain(expected);
    expect(err.code).toBe(serverError.code);
    expect(err.serverMessage).toBe(serverError.message);
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
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 10 }], error: null })) })),
      })),
    }));
    const ok = await bountyService.delete(10);
    expect(ok).toBe(true);
  });

  // RLS filters a DELETE the caller may not make rather than erroring, so an
  // empty result must not be reported as a successful cancel.
  it('delete returns false when RLS matched no rows', async () => {
    supabase.from.mockImplementationOnce(() => ({
      delete: jest.fn(() => ({
        eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
      })),
    }));
    const ok = await bountyService.delete(14);
    expect(ok).toBe(false);
  });

  it('search returns empty for blank query', async () => {
    const res = await bountyService.search('   ');
    expect(res).toEqual([]);
  });

  it('search enriches results with poster info from public_profiles', async () => {
    const fromCalls: string[] = [];
    const eqCalls: unknown[][] = [];

    supabase.from
      // 1st call: plain bounty search (no `profiles` embed)
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        const chain: any = {
          eq: jest.fn((...args: unknown[]) => {
            eqCalls.push(args);
            return chain;
          }),
          or: jest.fn(() => ({
            order: jest.fn(() => ({
              range: jest.fn(() =>
                Promise.resolve({ data: [{ id: 7, poster_id: 'u7' }], error: null })
              ),
            })),
          })),
        };
        return { select: jest.fn(() => chain) };
      })
      // 2nd call: poster enrichment from the public_profiles view
      .mockImplementationOnce((table: string) => {
        fromCalls.push(table);
        return {
          select: jest.fn(() => ({
            in: jest.fn(() =>
              Promise.resolve({ data: [{ id: 'u7', username: 'sam', avatar: 'a' }], error: null })
            ),
          })),
        };
      });

    const results = await bountyService.search('term');
    expect(results).toHaveLength(1);
    expect(results[0].username).toBe('sam');
    expect(results[0].poster_avatar).toBe('a');

    // Regression guard: search must read `public_profiles`, never the base
    // `profiles` table, which is self-only under RLS.
    expect(fromCalls).toEqual(['bounties', 'public_profiles']);
    // Open, non-test bounties only: suggestions never surface a QA post.
    expect(eqCalls).toEqual([
      ['status', 'open'],
      ['is_test', false],
    ]);
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
      // 2: profile lookup (base service no longer performs a duplicate check)
      .mockImplementationOnce(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() =>
              Promise.resolve({ data: { username: 'puser' }, error: null })
            ),
          })),
        })),
      }))
      // 3: insert
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
        eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })) })),
      })),
    }));
    const ok = await bountyService.delete(11);
    expect(ok).toBe(false);
  });

  it('delete soft-deletes on FK violation and never touches bounty_payments', async () => {
    const softUpdateEq = jest.fn(() => ({
      select: jest.fn(() => Promise.resolve({ data: [{ id: 12 }], error: null })),
    }));
    const softUpdate = jest.fn(() => ({ eq: softUpdateEq }));
    supabase.from.mockImplementation((table: string) => {
      if (table === 'bounty_payments') {
        throw new Error('bounty_payments must not be deleted on FK violation');
      }
      if (table === 'bounties') {
        return {
          delete: jest.fn(() => ({
            eq: jest.fn(() => ({
              select: jest.fn(() =>
                Promise.resolve({ data: null, error: { code: '23503', message: 'fk violation' } })
              ),
            })),
          })),
          update: softUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const ok = await bountyService.delete(12);
    expect(ok).toBe(true);
    expect(softUpdate).toHaveBeenCalledWith({ status: 'deleted' });
  });

  it('delete returns false when the FK-violation soft-delete fails', async () => {
    supabase.from.mockImplementation((table: string) => {
      if (table === 'bounty_payments') {
        throw new Error('bounty_payments must not be deleted on FK violation');
      }
      if (table === 'bounties') {
        return {
          delete: jest.fn(() => ({
            eq: jest.fn(() => ({
              select: jest.fn(() =>
                Promise.resolve({ data: null, error: { code: '23503', message: 'fk violation' } })
              ),
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => ({
              select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'soft-delete failed' } })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const ok = await bountyService.delete(13);
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
