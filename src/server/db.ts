import { Pool, type PoolClient, type QueryResultRow } from 'pg';

// Keep one pool across development hot reloads. DATABASE_URL is read server-side only.
const globalDb = globalThis as typeof globalThis & { hardwarePool?: Pool };
export const pool = globalDb.hardwarePool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 20_000,
  application_name: 'it-hardware',
});
if (process.env.NODE_ENV !== 'production') globalDb.hardwarePool = pool;
pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message));

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
