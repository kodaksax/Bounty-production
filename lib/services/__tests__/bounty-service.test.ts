/* eslint-env jest */
jest.setTimeout(20000);

// Helper to create a chainable, thenable Supabase-like builder
function createBuilder(result: any) {
  const builder: any = {};
  const chain = [
    'select',
    'eq',
    'or',
    'order',
    'range',
    'in',
    'update',
    'insert',
    'delete',
    'maybeSingle',
    'single',
    'ilike',
    'gte',
    'lte',
  ];
  chain.forEach(m => {
    builder[m] = (..._args: any[]) => builder;
  });
  // Promise-like behavior so `await builder` works
  builder.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return builder;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('getById falls back to API and returns JSON', async () => {
  jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));

  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: '1', title: 'From API' }),
  });

  const { bountyService } = await import('../bounty-service');

  const res = await bountyService.getById('1');
  expect(res).toEqual({ id: '1', title: 'From API' });
  expect((global as any).fetch).toHaveBeenCalled();
});

test('getById API 404 returns null', async () => {
  jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));

  (global as any).fetch = jest
    .fn()
    .mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });

  const { bountyService } = await import('../bounty-service');

  const res = await bountyService.getById('nope');
  expect(res).toBeNull();
});

test('addAttachmentToBounty uses API fallback when Supabase not configured', async () => {
  jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));

  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

  const { bountyService } = await import('../bounty-service');

  // Spy getById (called internally) to return an existing attachments array
  jest
    .spyOn(bountyService, 'getById')
    .mockResolvedValue({ attachments_json: JSON.stringify(['one']) } as any);

  const ok = await bountyService.addAttachmentToBounty('123', { name: 'new' });
  expect(ok).toBe(true);
  expect((global as any).fetch).toHaveBeenCalledWith(
    'http://api.test/api/bounties/123',
    expect.objectContaining({ method: 'PATCH' })
  );
});

test('addAttachmentToBounty persists via Supabase when configured', async () => {
  const builder = createBuilder({ data: [{ id: '123' }], error: null });
  jest.doMock('lib/supabase', () => ({
    isSupabaseConfigured: true,
    supabase: { from: () => builder },
  }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));

  const { bountyService } = await import('../bounty-service');

  jest.spyOn(bountyService, 'getById').mockResolvedValue({ attachments_json: [] } as any);

  const ok = await bountyService.addAttachmentToBounty('123', { name: 'supabase' });
  expect(ok).toBe(true);
});

test('search returns flattened bounties when Supabase is configured', async () => {
  const mockData = [
    { user_id: 'u1', profiles: { username: 'alice', avatar: 'img1' }, title: 't1' },
  ];
  const builder = createBuilder({ data: mockData, error: null });
  jest.doMock('lib/supabase', () => ({
    isSupabaseConfigured: true,
    supabase: { from: () => builder },
  }));
  jest.doMock('lib/utils/postgrest-utils', () => ({
    escapeIlike: (s: string) => s,
    quotePostgrestValue: (s: string) => `"${s}"`,
  }));

  const { bountyService } = await import('../bounty-service');

  const results = await bountyService.search('query');
  expect(Array.isArray(results)).toBe(true);
  expect(results[0].username).toBe('alice');
  expect(results[0].poster_avatar).toBe('img1');
});

test('create queues bounty when offline', async () => {
  jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));
  jest.doMock('lib/services/offline-queue-service', () => ({
    offlineQueueService: { enqueue: jest.fn(async () => ({ id: 'queued-1' })) },
  }));
  jest.doMock('lib/utils/bounty-validation', () => ({ validateTitle: () => undefined }));
  // Simulate offline
  jest.doMock('@react-native-community/netinfo', () => ({
    fetch: jest.fn(async () => ({ isConnected: false })),
  }));

  const { bountyService } = await import('../bounty-service');

  const tmp = await bountyService.create({ title: 'A valid title for test' } as any);
  expect(tmp).toBeTruthy();
  expect((tmp as any).id).toBeDefined();
});

test('updateStatus returns null when update fails and returns result otherwise', async () => {
  jest.doMock('lib/supabase', () => ({ isSupabaseConfigured: false, supabase: {} }));
  jest.doMock('lib/utils/network', () => ({ getReachableApiBaseUrl: () => 'http://api.test' }));

  const { bountyService } = await import('../bounty-service');

  // Case: update returns null
  jest.spyOn(bountyService, 'update').mockResolvedValueOnce(null as any);
  const r1 = await bountyService.updateStatus('x', 'open' as any);
  expect(r1).toBeNull();

  // Case: update returns object (websocket import may fail but should not throw)
  const mockResult = { id: 'x', status: 'completed' } as any;
  jest.spyOn(bountyService, 'update').mockResolvedValueOnce(mockResult);
  const r2 = await bountyService.updateStatus('x', 'completed' as any);
  expect(r2).toEqual(mockResult);
});
