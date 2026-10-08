import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// Keep one pool across development hot reloads. DATABASE_URL is read server-side only.
const globalDb = globalThis as typeof globalThis & { hardwarePool?: Pool; searchPool?: Pool };
const positive = (value: string | undefined, fallback: number) => { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback; };
// Size the pool for all application instances together (node-postgres guidance);
// raise DATABASE_POOL_MAX only when measurements show requests waiting for a client.
export const pool = globalDb.hardwarePool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: positive(process.env.DATABASE_POOL_MAX, 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 20_000,
  application_name: 'it-hardware',
});
// The global search gets its own small pool and a short timeout: bursts of typing
// queue here instead of taking connections from saves and lists, and an abandoned
// search cannot hold a connection for the full 20 seconds.
const searchPool = globalDb.searchPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: positive(process.env.SEARCH_POOL_MAX, 4),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: positive(process.env.SEARCH_STATEMENT_TIMEOUT_MS, 5_000),
  application_name: 'it-hardware-search',
  allowExitOnIdle: true,
});
if (process.env.NODE_ENV !== 'production') { globalDb.hardwarePool = pool; globalDb.searchPool = searchPool; }
pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));
searchPool.on('error', (error) => console.error('PostgreSQL search pool error:', error.message));
export function searchQuery<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  return searchPool.query<T>(sql, params);
}
/** Closes both pools (scripts and tests). */
export async function closePools() { await Promise.all([pool.end(), searchPool.end()]); }

export function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  return pool.query<T>(sql, params);
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
