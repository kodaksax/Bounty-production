// services/api/src/__tests__/db-read-replica.test.ts
// Unit tests for database read-replica connection logic

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

    // Re-import after resetting modules so the module re-evaluates env vars
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
});
