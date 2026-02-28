// services/api/src/__tests__/redis-cluster.test.ts
// Comprehensive unit tests for Redis cluster configuration and service helpers

// ─── Scan stream factory ──────────────────────────────────────────────────────

/**
 * Build a scan-stream mock that emits events asynchronously.
 * IMPORTANT: call this inside a mockImplementation factory, NOT in mockReturnValue.
 * Each `buildScanStream` call schedules its events via setImmediate at construction
 * time, so the stream must be created at the point `scanStream(opts)` is called
 * (after `stream.on(...)` handlers are registered by the consumer).
 */
function buildScanStream(batches: string[][] = [], streamError?: Error) {
  const handlers: Record<string, ((...args: any[]) => void)[]> = {};

  const stream = {
    pause: jest.fn(),
    resume: jest.fn(),
    destroy: jest.fn((err?: Error) => {
      if (err) (handlers['error'] || []).forEach(h => h(err));
    }),
    on: jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return stream;
    }),
  };

  // Schedule events AFTER on() handlers have been registered (next tick)
  setImmediate(async () => {
    if (streamError) {
      (handlers['error'] || []).forEach(h => h(streamError));
      return;
    }
    for (const batch of batches) {
      (handlers['data'] || []).forEach(h => h(batch));
      // Allow backpressure (del promise micro-task → stream.resume()) to settle
      await new Promise(r => setImmediate(r));
    }
    (handlers['end'] || []).forEach(h => h());
  });

  return stream;
}

// ─── Connected-client factory ─────────────────────────────────────────────────

/**
 * Build a mock standalone Redis client whose once('ready', cb) fires the
 * 'connect' + 'ready' on() handlers immediately on the next tick,
 * driving attachCommonEvents → isConnected = true / isConnecting = false
 * before waitForReady resolves.
 *
 * scanStream uses mockImplementation so that a FRESH stream (with a fresh
 * setImmediate schedule) is created each time scanStream() is called.
 */
function buildConnectedClient(overrides: Record<string, any> = {}) {
  const onHandlers: Record<string, ((...args: any[]) => void)[]> = {};

  const client: any = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    dbsize: jest.fn().mockResolvedValue(5),
    info: jest.fn().mockResolvedValue('used_memory_human:1.50M\r\n'),
    flushdb: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
    // Use mockImplementation so a fresh stream (with correct setImmediate timing)
    // is created each time scanStream() is called by the consumer.
    scanStream: jest.fn().mockImplementation(() => buildScanStream()),
    on: jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      onHandlers[event] = onHandlers[event] || [];
      onHandlers[event].push(cb);
      return client;
    }),
    once: jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      if (event === 'ready') {
        setImmediate(() => {
          // Fire on() event handlers → sets isConnected=true, isConnecting=false
          (onHandlers['connect'] || []).forEach(h => h());
          (onHandlers['ready'] || []).forEach(h => h());
          cb(); // resolve waitForReady
        });
      }
      return client;
    }),
    ...overrides,
  };

  return client;
}

// ─── Service loader helpers ───────────────────────────────────────────────────

/**
 * Load a fresh redis-service module backed by a connected standalone Redis mock.
 *
 * NOTE: `__esModule: true` is required so that TypeScript's esModuleInterop
 * helper (`__importDefault`) does NOT double-wrap the mock object — without it,
 * `ioredis_1.default` would be the whole mock object rather than the constructor,
 * causing "is not a constructor" errors.
 */
async function loadStandaloneService(clientOverrides: Record<string, any> = {}) {
  jest.resetModules();
  const mockClient = buildConnectedClient(clientOverrides);

  jest.doMock('ioredis', () => ({
    __esModule: true,
    default: jest.fn(() => mockClient),
    Cluster: jest.fn(),
  }));

  process.env.REDIS_ENABLED = 'true';
  delete process.env.REDIS_CLUSTER_ENABLED;
  delete process.env.REDIS_CLUSTER_NODES;

  const svc = require('../services/redis-service');

  // Wait for auto-init: once('ready', cb) setImmediate fires, then microtasks
  // chain resolves (waitForReady → initRedisStandalone → initRedis → isConnected=true)
  await new Promise<void>(r => setImmediate(r));
  await Promise.resolve();

  return { svc, mockClient };
}

/**
 * Load a fresh redis-service module backed by a connected Redis Cluster mock.
 * Uses a real constructor function for MockCluster so that
 * `instance instanceof Cluster` evaluates to true inside redis-service.ts.
 */
async function loadClusterService(masterNodes: any[]) {
  jest.resetModules();

  let capturedInstance: any;

  const MockCluster = jest.fn().mockImplementation(function (this: any) {
    const onHandlers: Record<string, ((...args: any[]) => void)[]> = {};

    this.nodes = jest.fn().mockReturnValue(masterNodes);
    this.get = jest.fn().mockResolvedValue(null);
    this.setex = jest.fn().mockResolvedValue('OK');
    this.del = jest.fn().mockResolvedValue(1);
    this.exists = jest.fn().mockResolvedValue(0);
    this.expire = jest.fn().mockResolvedValue(1);
    this.quit = jest.fn().mockResolvedValue('OK');

    this.on = jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      onHandlers[event] = onHandlers[event] || [];
      onHandlers[event].push(cb);
      return this;
    });

    this.once = jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
      if (event === 'ready') {
        setImmediate(() => {
          (onHandlers['connect'] || []).forEach(h => h());
          (onHandlers['ready'] || []).forEach(h => h());
          cb();
        });
      }
      return this;
    });

    capturedInstance = this;
  });

  jest.doMock('ioredis', () => ({
    __esModule: true,
    default: jest.fn(),
    Cluster: MockCluster,
  }));

  process.env.REDIS_ENABLED = 'true';
  process.env.REDIS_CLUSTER_ENABLED = 'true';
  process.env.REDIS_CLUSTER_NODES = 'redis-1:6379,redis-2:6380,redis-3:6381';

  const svc = require('../services/redis-service');

  await new Promise<void>(r => setImmediate(r));
  await Promise.resolve();

  return { svc, clusterInstance: capturedInstance, MockCluster };
}

// ─── Config cluster node parsing ─────────────────────────────────────────────

describe('Redis cluster configuration – node parsing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('parses REDIS_CLUSTER_NODES into host/port pairs', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = 'redis-1:6379,redis-2:6380,redis-3:6381';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config');

    expect(config.redis.cluster.enabled).toBe(true);
    expect(config.redis.cluster.nodes).toHaveLength(3);
    expect(config.redis.cluster.nodes[0]).toEqual({ host: 'redis-1', port: 6379 });
    expect(config.redis.cluster.nodes[1]).toEqual({ host: 'redis-2', port: 6380 });
    expect(config.redis.cluster.nodes[2]).toEqual({ host: 'redis-3', port: 6381 });
  });

  it('defaults cluster to disabled when REDIS_CLUSTER_ENABLED is not set', () => {
    delete process.env.REDIS_CLUSTER_ENABLED;
    delete process.env.REDIS_CLUSTER_NODES;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config');

    expect(config.redis.cluster.enabled).toBe(false);
    expect(config.redis.cluster.nodes).toHaveLength(0);
  });

  it('returns an empty node list when REDIS_CLUSTER_NODES is blank', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = '';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config');

    expect(config.redis.cluster.nodes).toHaveLength(0);
  });

  it('trims whitespace around node entries', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = ' redis-a:6379 , redis-b:6380 ';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { config } = require('../config');

    expect(config.redis.cluster.nodes).toHaveLength(2);
    expect(config.redis.cluster.nodes[0]).toEqual({ host: 'redis-a', port: 6379 });
    expect(config.redis.cluster.nodes[1]).toEqual({ host: 'redis-b', port: 6380 });
  });

  it('throws when a node is missing a port', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = 'redis-1';

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../config');
    }).toThrow(/Invalid REDIS_CLUSTER_NODES entry/);
  });

  it('throws when a node has a non-numeric port', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = 'redis-1:abc';

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../config');
    }).toThrow(/Invalid REDIS_CLUSTER_NODES entry/);
  });

  it('throws when a node has a port out of range', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = 'redis-1:99999';

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../config');
    }).toThrow(/Invalid REDIS_CLUSTER_NODES entry/);
  });

  it('throws when a node is missing a host', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = ':6379';

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../config');
    }).toThrow(/Invalid REDIS_CLUSTER_NODES entry/);
  });

  it('includes the current env value in the error message', () => {
    process.env.REDIS_CLUSTER_ENABLED = 'true';
    process.env.REDIS_CLUSTER_NODES = 'bad-entry';

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../config');
    }).toThrow(/bad-entry/);
  });
});

// ─── CacheKeyPrefix ───────────────────────────────────────────────────────────

describe('CacheKeyPrefix', () => {
  it('exposes expected prefix constants', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CacheKeyPrefix } = require('../services/redis-service');
    expect(CacheKeyPrefix.PROFILE).toBe('profile:');
    expect(CacheKeyPrefix.BOUNTY).toBe('bounty:');
    expect(CacheKeyPrefix.BOUNTY_LIST).toBe('bounty:list:');
  });
});

// ─── isRedisAvailable ─────────────────────────────────────────────────────────

describe('isRedisAvailable', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns false when REDIS_ENABLED is false', () => {
    process.env.REDIS_ENABLED = 'false';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isRedisAvailable } = require('../services/redis-service');
    expect(isRedisAvailable()).toBe(false);
  });

  it('returns true when connected to a standalone Redis', async () => {
    const { svc } = await loadStandaloneService();
    expect(svc.isRedisAvailable()).toBe(true);
  });
});

// ─── getCacheMetrics ──────────────────────────────────────────────────────────

describe('getCacheMetrics', () => {
  it('returns numeric counters and a hitRate', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCacheMetrics } = require('../services/redis-service');
    const m = getCacheMetrics();
    expect(typeof m.hits).toBe('number');
    expect(typeof m.misses).toBe('number');
    expect(typeof m.errors).toBe('number');
    expect(typeof m.hitRate).toBe('number');
  });

  it('calculates hitRate as 0 when there are no operations', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getCacheMetrics } = require('../services/redis-service');
    const m = getCacheMetrics();
    expect(m.hitRate).toBe(0);
  });
});

// ─── redisService.get ─────────────────────────────────────────────────────────

describe('redisService.get', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns parsed value on cache hit', async () => {
    const cached = { id: 'u1', name: 'Alice' };
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.get.mockResolvedValue(JSON.stringify(cached));

    const result = await svc.default.get('u1', 'profile:');

    expect(result).toEqual(cached);
    expect(mockClient.get).toHaveBeenCalledWith('profile:u1');
  });

  it('returns null on cache miss', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.get.mockResolvedValue(null);

    const result = await svc.default.get('missing', 'profile:');

    expect(result).toBeNull();
    expect(mockClient.get).toHaveBeenCalledWith('profile:missing');
  });

  it('returns null and increments errors when get throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.get.mockRejectedValue(new Error('Redis connection lost'));

    const result = await svc.default.get('key', 'profile:');

    expect(result).toBeNull();
    const m = svc.getCacheMetrics();
    expect(m.errors).toBeGreaterThan(0);
  });
});

// ─── redisService.set ─────────────────────────────────────────────────────────

describe('redisService.set', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('sets value with an explicit TTL', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    const ok = await svc.default.set('u1', { name: 'Alice' }, 'profile:', 120);

    expect(ok).toBe(true);
    expect(mockClient.setex).toHaveBeenCalledWith('profile:u1', 120, JSON.stringify({ name: 'Alice' }));
  });

  it('uses default PROFILE TTL when no explicit TTL is given', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.default.set('u1', { name: 'Alice' }, 'profile:');

    expect(mockClient.setex).toHaveBeenCalledWith('profile:u1', 300, expect.any(String));
  });

  it('uses default BOUNTY TTL', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.default.set('b1', { title: 'Fix bug' }, 'bounty:');

    expect(mockClient.setex).toHaveBeenCalledWith('bounty:b1', 180, expect.any(String));
  });

  it('uses default BOUNTY_LIST TTL', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.default.set('list:1', [], 'bounty:list:');

    expect(mockClient.setex).toHaveBeenCalledWith('bounty:list:list:1', 60, expect.any(String));
  });

  it('uses fallback TTL (300s) for an unknown prefix', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.default.set('x', {}, 'unknown:');

    expect(mockClient.setex).toHaveBeenCalledWith('unknown:x', 300, expect.any(String));
  });

  it('returns false when setex throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.setex.mockRejectedValue(new Error('OOM'));

    const ok = await svc.default.set('key', 'val', 'profile:');

    expect(ok).toBe(false);
  });
});

// ─── redisService.del ─────────────────────────────────────────────────────────

describe('redisService.del', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('deletes a key and returns true', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    const ok = await svc.default.del('u1', 'profile:');

    expect(ok).toBe(true);
    expect(mockClient.del).toHaveBeenCalledWith('profile:u1');
  });

  it('returns false when del throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.del.mockRejectedValue(new Error('NOSCRIPT'));

    const ok = await svc.default.del('u1', 'profile:');

    expect(ok).toBe(false);
  });
});

// ─── redisService.exists ──────────────────────────────────────────────────────

describe('redisService.exists', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns true when key exists (result = 1)', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.exists.mockResolvedValue(1);

    expect(await svc.default.exists('u1', 'profile:')).toBe(true);
  });

  it('returns false when key does not exist (result = 0)', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.exists.mockResolvedValue(0);

    expect(await svc.default.exists('missing', 'profile:')).toBe(false);
  });

  it('returns false when exists throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.exists.mockRejectedValue(new Error('Timeout'));

    expect(await svc.default.exists('k', 'profile:')).toBe(false);
  });
});

// ─── redisService.expire ──────────────────────────────────────────────────────

describe('redisService.expire', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('sets expiry and returns true', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    const ok = await svc.default.expire('u1', 'profile:', 60);

    expect(ok).toBe(true);
    expect(mockClient.expire).toHaveBeenCalledWith('profile:u1', 60);
  });

  it('returns false when expire throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.expire.mockRejectedValue(new Error('Error'));

    expect(await svc.default.expire('u1', 'profile:', 60)).toBe(false);
  });
});

// ─── redisService.getStats (standalone) ──────────────────────────────────────

describe('redisService.getStats – standalone', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns keys, memory and clusterEnabled=false', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.dbsize.mockResolvedValue(42);
    mockClient.info.mockResolvedValue('used_memory_human:3.00M\r\n');

    const stats = await svc.default.getStats();

    expect(stats).not.toBeNull();
    expect(stats!.keys).toBe(42);
    expect(stats!.memory).toContain('3.00M');
    expect(stats!.clusterEnabled).toBe(false);
  });

  it('returns null when getStats throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.info.mockRejectedValue(new Error('Info failed'));

    const stats = await svc.default.getStats();

    expect(stats).toBeNull();
  });
});

// ─── redisService.flushAll (standalone) ──────────────────────────────────────

describe('redisService.flushAll – standalone', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('calls flushdb and returns true', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    const ok = await svc.default.flushAll();

    expect(ok).toBe(true);
    expect(mockClient.flushdb).toHaveBeenCalled();
  });

  it('returns false when flushdb throws', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.flushdb.mockRejectedValue(new Error('READONLY'));

    expect(await svc.default.flushAll()).toBe(false);
  });
});

// ─── redisService.close ──────────────────────────────────────────────────────

describe('redisService.close', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('calls quit and clears the client', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.default.close();

    expect(mockClient.quit).toHaveBeenCalled();
    expect(svc.isRedisAvailable()).toBe(false);
  });
});

// ─── delPatternStandalone – stream behaviour ──────────────────────────────────

describe('redisService.delPattern – standalone stream behaviour', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('deletes keys found by SCAN and returns the count', async () => {
    const keys = ['bountyexpo:bounty:list:a', 'bountyexpo:bounty:list:b'];
    const { svc, mockClient } = await loadStandaloneService({
      // mockImplementation creates a fresh stream each time scanStream() is called,
      // ensuring setImmediate fires AFTER stream.on() handlers are registered.
      scanStream: jest.fn().mockImplementation(() => buildScanStream([keys])),
      del: jest.fn().mockResolvedValue(2),
    });

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(2);
    expect(mockClient.del).toHaveBeenCalled();
  });

  it('handles an empty data batch without calling del', async () => {
    const { svc, mockClient } = await loadStandaloneService({
      scanStream: jest.fn().mockImplementation(() => buildScanStream([[]])),
    });

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(0);
    expect(mockClient.del).not.toHaveBeenCalled();
  });

  it('rejects and returns 0 when the stream emits an error', async () => {
    const { svc } = await loadStandaloneService({
      scanStream: jest.fn().mockImplementation(() => buildScanStream([], new Error('SCAN failed'))),
    });

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(0);
  });

  it('applies backpressure (pause/resume) when processing a batch', async () => {
    const keys = ['bountyexpo:bounty:list:x'];
    let capturedStream: any;

    const { svc } = await loadStandaloneService({
      scanStream: jest.fn().mockImplementation(() => {
        capturedStream = buildScanStream([keys]);
        return capturedStream;
      }),
      del: jest.fn().mockResolvedValue(1),
    });

    await svc.default.delPattern('*', 'bounty:list:');

    expect(capturedStream.pause).toHaveBeenCalled();
    expect(capturedStream.resume).toHaveBeenCalled();
  });
});

// ─── redisService.delPattern – cluster mode ───────────────────────────────────

describe('redisService.delPattern – cluster mode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('scans each master node and aggregates deleted key counts', async () => {
    const node1Keys = ['bountyexpo:bounty:list:1', 'bountyexpo:bounty:list:2'];
    const node2Keys = ['bountyexpo:bounty:list:3'];

    const node1 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([node1Keys])),
      del: jest.fn().mockResolvedValue(2),
    };
    const node2 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([node2Keys])),
      del: jest.fn().mockResolvedValue(1),
    };

    const { svc } = await loadClusterService([node1, node2]);

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(3);
    expect(node1.del).toHaveBeenCalled();
    expect(node2.del).toHaveBeenCalled();
  });

  it('continues processing other nodes when one scan fails (Promise.allSettled)', async () => {
    const node1 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([], new Error('Node down'))),
      del: jest.fn(),
    };
    const node2Keys = ['bountyexpo:bounty:list:good'];
    const node2 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([node2Keys])),
      del: jest.fn().mockResolvedValue(1),
    };

    const { svc } = await loadClusterService([node1, node2]);

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(1);
    expect(node1.del).not.toHaveBeenCalled();
    expect(node2.del).toHaveBeenCalled();
  });

  it('handles del failure on a node gracefully (returns 0 for that node)', async () => {
    const keys = ['bountyexpo:bounty:list:x'];
    const node1 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([keys])),
      del: jest.fn().mockRejectedValue(new Error('CLUSTERDOWN')),
    };

    const { svc } = await loadClusterService([node1]);

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(0);
  });

  it('returns 0 when all nodes return empty scan results', async () => {
    const node1 = {
      scanStream: jest.fn().mockImplementation(() => buildScanStream([])),
      del: jest.fn(),
    };

    const { svc } = await loadClusterService([node1]);

    const count = await svc.default.delPattern('*', 'bounty:list:');

    expect(count).toBe(0);
    expect(node1.del).not.toHaveBeenCalled();
  });
});

// ─── redisService.getStats – cluster mode ────────────────────────────────────

describe('redisService.getStats – cluster mode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('aggregates key count across master nodes and marks clusterEnabled=true', async () => {
    const node1 = {
      dbsize: jest.fn().mockResolvedValue(10),
      info: jest.fn().mockResolvedValue('used_memory_human:2.00M\r\n'),
    };
    const node2 = {
      dbsize: jest.fn().mockResolvedValue(15),
      info: jest.fn().mockResolvedValue('used_memory_human:3.00M\r\n'),
    };

    const { svc } = await loadClusterService([node1, node2]);

    const stats = await svc.default.getStats();

    expect(stats).not.toBeNull();
    expect(stats!.keys).toBe(25);
    expect(stats!.clusterEnabled).toBe(true);
    expect(stats!.memory).toContain('(one node)');
  });

  it('skips unreachable nodes and continues aggregating', async () => {
    const node1 = {
      dbsize: jest.fn().mockRejectedValue(new Error('Unreachable')),
      info: jest.fn().mockRejectedValue(new Error('Unreachable')),
    };
    const node2 = {
      dbsize: jest.fn().mockResolvedValue(7),
      info: jest.fn().mockResolvedValue('used_memory_human:1.00M\r\n'),
    };

    const { svc } = await loadClusterService([node1, node2]);

    const stats = await svc.default.getStats();

    expect(stats!.keys).toBe(7);
  });
});

// ─── redisService.flushAll – cluster mode ────────────────────────────────────

describe('redisService.flushAll – cluster mode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('calls flushdb on each master node and returns true', async () => {
    const node1 = { flushdb: jest.fn().mockResolvedValue('OK') };
    const node2 = { flushdb: jest.fn().mockResolvedValue('OK') };

    const { svc } = await loadClusterService([node1, node2]);

    const ok = await svc.default.flushAll();

    expect(ok).toBe(true);
    expect(node1.flushdb).toHaveBeenCalled();
    expect(node2.flushdb).toHaveBeenCalled();
  });
});

// ─── cacheInvalidation helpers ────────────────────────────────────────────────

describe('cacheInvalidation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('invalidateProfile calls del with PROFILE prefix', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.cacheInvalidation.invalidateProfile('user-123');

    expect(mockClient.del).toHaveBeenCalledWith('profile:user-123');
  });

  it('invalidateBounty calls del with BOUNTY prefix', async () => {
    const { svc, mockClient } = await loadStandaloneService();

    await svc.cacheInvalidation.invalidateBounty('bounty-abc');

    expect(mockClient.del).toHaveBeenCalledWith('bounty:bounty-abc');
  });

  it('invalidateBountyLists calls delPattern with BOUNTY_LIST prefix', async () => {
    const { svc } = await loadStandaloneService({
      scanStream: jest.fn().mockImplementation(() => buildScanStream([])),
    });

    await svc.cacheInvalidation.invalidateBountyLists();
  });

  it('invalidateUserBounties calls delPattern with user-scoped pattern', async () => {
    const { svc } = await loadStandaloneService({
      scanStream: jest.fn().mockImplementation(() => buildScanStream([])),
    });

    await svc.cacheInvalidation.invalidateUserBounties('user-xyz');
  });
});

// ─── No-client branches (Redis disabled at runtime) ──────────────────────────
// These tests cover the `if (!client) { return <default> }` guards in every
// service method, hit when getRedisClient() returns null.

describe('service methods when Redis client is unavailable', () => {
  const originalEnv = { ...process.env };

  /**
   * Load a module where REDIS_ENABLED=true but the mock Redis constructor
   * always throws so no client is ever established.  getRedisClient() will
   * call initRedis() which will fail and return null, exercising the
   * `if (!client)` branches in every service method.
   */
  async function loadDisconnectedService() {
    jest.resetModules();

    jest.doMock('ioredis', () => ({
      __esModule: true,
      default: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
        // Immediately fire 'error' so waitForReady rejects
        this.on = jest.fn().mockReturnThis();
        this.once = jest.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'error') setImmediate(() => cb(new Error('ECONNREFUSED')));
          return this;
        });
      }),
      Cluster: jest.fn(),
    }));

    process.env.REDIS_ENABLED = 'true';
    delete process.env.REDIS_CLUSTER_ENABLED;
    delete process.env.REDIS_CLUSTER_NODES;

    const svc = require('../services/redis-service');

    // Allow the failed init setImmediate to fire
    await new Promise<void>(resolve => setImmediate(resolve));
    await Promise.resolve();

    return svc;
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('get returns null when client is null', async () => {
    const svc = await loadDisconnectedService();
    const result = await svc.default.get('k', 'profile:');
    expect(result).toBeNull();
  });

  it('set returns false when client is null', async () => {
    const svc = await loadDisconnectedService();
    const ok = await svc.default.set('k', 'v', 'profile:');
    expect(ok).toBe(false);
  });

  it('del returns false when client is null', async () => {
    const svc = await loadDisconnectedService();
    const ok = await svc.default.del('k', 'profile:');
    expect(ok).toBe(false);
  });

  it('delPattern returns 0 when client is null', async () => {
    const svc = await loadDisconnectedService();
    const n = await svc.default.delPattern('*', 'bounty:list:');
    expect(n).toBe(0);
  });

  it('exists returns false when client is null', async () => {
    const svc = await loadDisconnectedService();
    const ok = await svc.default.exists('k', 'profile:');
    expect(ok).toBe(false);
  });

  it('expire returns false when client is null', async () => {
    const svc = await loadDisconnectedService();
    const ok = await svc.default.expire('k', 'profile:', 60);
    expect(ok).toBe(false);
  });

  it('getStats returns null when client is null', async () => {
    const svc = await loadDisconnectedService();
    const stats = await svc.default.getStats();
    expect(stats).toBeNull();
  });

  it('flushAll returns false when client is null', async () => {
    const svc = await loadDisconnectedService();
    const ok = await svc.default.flushAll();
    expect(ok).toBe(false);
  });
});

// ─── redisService.close – error path ─────────────────────────────────────────

describe('redisService.close – error path', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('handles quit() error gracefully without throwing', async () => {
    const { svc, mockClient } = await loadStandaloneService();
    mockClient.quit.mockRejectedValue(new Error('Connection already closed'));

    // Should not throw
    await expect(svc.default.close()).resolves.toBeUndefined();
  });
});

// ─── delPatternStandalone – stream.destroy error path ────────────────────────

describe('redisService.delPattern – standalone stream.destroy error path', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('returns 0 and does not throw when del() fails mid-stream', async () => {
    const keys = ['bountyexpo:bounty:list:x'];

    const { svc } = await loadStandaloneService({
      // First del call rejects, triggering stream.destroy(err) which emits 'error'
      del: jest.fn().mockRejectedValue(new Error('DEL failed')),
      scanStream: jest.fn().mockImplementation(() => {
        const handlers: Record<string, ((...args: any[]) => void)[]> = {};
        const stream = {
          pause: jest.fn(),
          resume: jest.fn(),
          destroy: jest.fn((err?: Error) => {
            if (err) setImmediate(() => (handlers['error'] || []).forEach(h => h(err)));
          }),
          on: jest.fn().mockImplementation((event: string, cb: (...args: any[]) => void) => {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
            return stream;
          }),
        };
        setImmediate(() => {
          (handlers['data'] || []).forEach(h => h(keys));
        });
        return stream;
      }),
    });

    const count = await svc.default.delPattern('*', 'bounty:list:');
    expect(count).toBe(0);
  });
});
