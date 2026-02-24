// services/api/src/__tests__/redis-cluster.test.ts
// Unit tests for Redis cluster configuration and service helpers

// Mock ioredis before importing anything that uses it, to prevent real
// network connections during unit tests.
jest.mock('ioredis', () => {
  const mockOn = jest.fn().mockReturnThis();
  const mockOnce = jest.fn().mockReturnThis();

  const MockRedis = jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    dbsize: jest.fn().mockResolvedValue(0),
    info: jest.fn().mockResolvedValue('used_memory_human:1.00M\r\n'),
    flushdb: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
    ping: jest.fn().mockResolvedValue('PONG'),
    scanStream: jest.fn().mockReturnValue({ on: jest.fn() }),
    on: mockOn,
    once: mockOnce,
  }));

  const MockCluster = jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    expire: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
    nodes: jest.fn().mockReturnValue([]),
    on: mockOn,
    once: mockOnce,
  }));

  return { default: MockRedis, Cluster: MockCluster };
});

// ─── Config cluster node parsing ────────────────────────────────────────────

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
});

// ─── CacheKeyPrefix ──────────────────────────────────────────────────────────

describe('CacheKeyPrefix', () => {
  it('exposes expected prefix constants', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CacheKeyPrefix } = require('../services/redis-service');
    expect(CacheKeyPrefix.PROFILE).toBe('profile:');
    expect(CacheKeyPrefix.BOUNTY).toBe('bounty:');
    expect(CacheKeyPrefix.BOUNTY_LIST).toBe('bounty:list:');
  });
});

// ─── isRedisAvailable ────────────────────────────────────────────────────────

describe('isRedisAvailable', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('returns false when REDIS_ENABLED is false', () => {
    process.env.REDIS_ENABLED = 'false';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isRedisAvailable } = require('../services/redis-service');
    expect(isRedisAvailable()).toBe(false);
  });
});

// ─── getCacheMetrics ─────────────────────────────────────────────────────────

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
});

