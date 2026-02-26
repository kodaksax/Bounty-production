// services/api/src/__tests__/db-read-replica.test.ts
// Unit tests for database read-replica connection logic

// Mock 'pg' so no real TCP connections are created during tests.
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPoolQuery = jest.fn().mockResolvedValue({ rows: [] });

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      end: mockPoolEnd,
      query: mockPoolQuery,
    })),
  };
});

// Mock drizzle so it doesn't need a real pool
jest.mock('drizzle-orm/node-postgres', () => ({
  drizzle: jest.fn().mockImplementation((pool: any) => ({ _pool: pool })),
}));

describe('Database read-replica connection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses primary pool for reads when DATABASE_READ_URL is not set', () => {
    delete process.env.DATABASE_READ_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';

    const { pool, readPool, isReadReplica } = require('../db/connection');

    expect(isReadReplica).toBe(false);
    // When no replica is configured, readPool and pool should be the same reference
    expect(readPool).toBe(pool);
  });

  it('creates a separate read pool when DATABASE_READ_URL is set', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
    process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';

    const { pool, readPool, isReadReplica } = require('../db/connection');

    expect(isReadReplica).toBe(true);
    // When a replica is configured, readPool must be a distinct Pool instance
    expect(readPool).not.toBe(pool);
  });

  it('exports both db (write) and dbRead (read) Drizzle instances', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';

    const conn = require('../db/connection');

    expect(conn.db).toBeDefined();
    expect(conn.dbRead).toBeDefined();
  });

  it('exports db and dbRead as separate instances when replica is configured', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
    process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';

    const { db, dbRead } = require('../db/connection');

    expect(db).toBeDefined();
    expect(dbRead).toBeDefined();
    expect(dbRead).not.toBe(db);
  });

  it('closeDbPools ends only the primary pool when no replica is configured', async () => {
    delete process.env.DATABASE_READ_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';

    const { pool, readPool, closeDbPools } = require('../db/connection');

    await closeDbPools();

    // primary pool.end() should be called once
    expect(pool.end).toHaveBeenCalledTimes(1);
    // readPool is the same object as pool, end is already counted above
    expect(readPool).toBe(pool);
  });

  it('closeDbPools ends both pools when replica is configured', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@primary:5432/db';
    process.env.DATABASE_READ_URL = 'postgresql://user:pass@replica:5432/db';

    const { pool, readPool, closeDbPools } = require('../db/connection');

    await closeDbPools();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(readPool.end).toHaveBeenCalledTimes(1);
  });
});
