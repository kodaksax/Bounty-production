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

console.log(`[db] Using connection string: ${connectionString ? '(built from env)' : '(none)'}`);

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Create Drizzle database instance
export const db = drizzle(pool, { schema });

// Export pool for raw queries if needed
export { pool };
