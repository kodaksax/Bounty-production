// services/api/src/__tests__/db-read-replica.test.ts
// Unit tests for database read-replica connection logic

// Mock 'pg' so no real TCP connections are created during tests.
// Use jest.fn() inside the factory so each isolated require gets fresh
// mock instances whose call counts start at zero.
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [] }),
  })),
}));

// Mock drizzle so it doesn't need a real pool
jest.mock('drizzle-orm/node-postgres', () => ({
  drizzle: jest.fn().mockImplementation((pool: any) => ({ _pool: pool })),
}));

describe('Database read-replica connection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses primary pool for reads when DATABASE_READ_URL is not set', () => {
    let pool: any, readPool: any, isReadReplica: any;
    jest.isolateModules(() => {
      delete process.env.DATABASE_READ_URL;
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      ({ pool, readPool, isReadReplica } = require('../db/connection'));
    });

    expect(isReadReplica).toBe(false);
    // When no replica is configured, readPool and pool should be the same reference
    expect(readPool).toBe(pool);
  });

  it('creates a separate read pool when DATABASE_READ_URL is set', () => {
    let pool: any, readPool: any, isReadReplica: any;
    jest.isolateModules(() => {
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';
      ({ pool, readPool, isReadReplica } = require('../db/connection'));
    });

    expect(isReadReplica).toBe(true);
    // When a replica is configured, readPool must be a distinct Pool instance
    expect(readPool).not.toBe(pool);
  });

  it('exports both db (write) and dbRead (read) Drizzle instances', () => {
    let conn: any;
    jest.isolateModules(() => {
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      conn = require('../db/connection');
    });

    expect(conn.db).toBeDefined();
    expect(conn.dbRead).toBeDefined();
  });

  it('exports db and dbRead as separate instances when replica is configured', () => {
    let db: any, dbRead: any;
    jest.isolateModules(() => {
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';
      ({ db, dbRead } = require('../db/connection'));
    });

    expect(db).toBeDefined();
    expect(dbRead).toBeDefined();
    expect(dbRead).not.toBe(db);
  });

  it('closeDbPools ends only the primary pool when no replica is configured', async () => {
    let pool: any, readPool: any, closeDbPools: any;
    jest.isolateModules(() => {
      delete process.env.DATABASE_READ_URL;
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      ({ pool, readPool, closeDbPools } = require('../db/connection'));
    });

    await closeDbPools();

    // primary pool.end() should be called exactly once
    expect(pool.end).toHaveBeenCalledTimes(1);
    // readPool is the same object as pool
    expect(readPool).toBe(pool);
  });

  it('closeDbPools ends both pools when replica is configured', async () => {
    let pool: any, readPool: any, closeDbPools: any;
    jest.isolateModules(() => {
      process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
      process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';
      ({ pool, readPool, closeDbPools } = require('../db/connection'));
    });

    await closeDbPools();

    // Each pool instance gets its own fresh mock.end(), so each should be called exactly once
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(readPool.end).toHaveBeenCalledTimes(1);
  });
});
