import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Helper: sanitize env values (trim whitespace and surrounding quotes)
function sanitizeEnv(value?: string | null): string | undefined {
  if (!value && value !== '') return undefined;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v === '' ? undefined : v;
}

// Build connection string: prefer DATABASE_URL, otherwise construct from DB_* env vars
const connectionString: string = (() => {
  const envDbUrl = sanitizeEnv(process.env.DATABASE_URL);
  if (envDbUrl) return envDbUrl;

  const host = sanitizeEnv(process.env.DB_HOST) || sanitizeEnv(process.env.PGHOST) || 'localhost';
  const port = sanitizeEnv(process.env.DB_PORT) || sanitizeEnv(process.env.PGPORT) || '5432';
  const user = sanitizeEnv(process.env.DB_USER) || sanitizeEnv(process.env.PGUSER) || 'postgres';
  const password = sanitizeEnv(process.env.DB_PASSWORD) || sanitizeEnv(process.env.PGPASSWORD) || '';
  const dbName = sanitizeEnv(process.env.DB_NAME) || sanitizeEnv(process.env.PGDATABASE) || 'postgres';

  // Detect common mismatch: MySQL default port 3306 used in env
  if (port === '3306') {
    console.warn('[db] Detected DB_PORT=3306 (MySQL default). This service expects a PostgreSQL database. Please set a PostgreSQL DATABASE_URL or correct DB_PORT/DB_* variables.');
  }

  // Build a basic postgres connection string. If password is empty, omit it.
  if (user && password) {
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  }

  if (user && !password) {
    return `postgres://${encodeURIComponent(user)}@${host}:${port}/${dbName}`;
  }

  return `postgresql://${host}:${port}/${dbName}`;
})();

// Read replica connection string: prefer DATABASE_READ_URL, fall back to primary
const readConnectionString: string = sanitizeEnv(process.env.DATABASE_READ_URL) || connectionString;

const isReadReplica = readConnectionString !== connectionString;

console.log(`[db] Using connection string: ${connectionString ? '(built from env)' : '(none)'}`);
console.log(`[db] Read replica: ${isReadReplica ? '(separate DATABASE_READ_URL configured)' : '(same as primary)'}`);

// Shared pool configuration applied to both the primary and replica pools.
// Tune DB_POOL_MAX / DB_POOL_IDLE_TIMEOUT_MS / DB_POOL_CONNECT_TIMEOUT_MS via env
// for production workloads.
const poolConfig = {
  max: parseInt(sanitizeEnv(process.env.DB_POOL_MAX) || '10', 10),
  idleTimeoutMillis: parseInt(sanitizeEnv(process.env.DB_POOL_IDLE_TIMEOUT_MS) || '30000', 10),
  connectionTimeoutMillis: parseInt(sanitizeEnv(process.env.DB_POOL_CONNECT_TIMEOUT_MS) || '5000', 10),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
} as const;

// Create primary PostgreSQL connection pool (used for writes and transactions)
const pool = new Pool({ connectionString, ...poolConfig });

// Create read replica connection pool (used for read-heavy SELECT queries).
// Falls back to the primary pool when DATABASE_READ_URL is not set.
//
// NOTE – Replication lag: reads via `dbRead` may return slightly stale data
// (typically < 1 s on a healthy streaming replica). For operations where a
// write must be immediately visible to the caller (e.g. "create bounty then
// search for it"), use `db` (the primary) instead of `dbRead`.
const readPool = isReadReplica
  ? new Pool({ connectionString: readConnectionString, ...poolConfig })
  : pool;

// Create Drizzle database instance for writes/transactions
export const db = drizzle(pool, { schema });

// Create Drizzle database instance for read-heavy queries (points to replica when configured)
export const dbRead = drizzle(readPool, { schema });

// Export pools for raw queries if needed
export { pool, readPool, isReadReplica };

/**
 * Close all database connection pools gracefully.
 * Call this during process shutdown before fastify.close().
 * When no separate read replica is configured readPool === pool,
 * so we only end it once.
 */
export async function closeDbPools(): Promise<void> {
  await pool.end();
  if (isReadReplica) {
    await readPool.end();
  }
}
