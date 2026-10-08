import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Async scrypt runs on the libuv thread pool (4 threads by default), which also
// serves file I/O, DNS lookups and compression. Cap concurrent derivations so a
// burst of logins or invitations cannot starve the rest of the server.
const maxConcurrent = 2, maxQueued = 64;
let active = 0;
const waiting: (() => void)[] = [];
/** Thrown when the derivation queue is full; the API maps the code to HTTP 503. */
export class PasswordBusyError extends Error { readonly code = 'PASSWORD_BUSY'; }
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active < maxConcurrent) active++;
  else if (waiting.length >= maxQueued) throw new PasswordBusyError('Password hashing queue is full.');
  else await new Promise<void>(resolve => waiting.push(resolve)); // The releasing caller hands over its slot.
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return withSlot(() => new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key))));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:32768:8:1:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, block, parallel, salt, key] = encoded.split(':');
  if (algorithm !== 'scrypt' || cost !== '32768' || block !== '8' || parallel !== '1' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(key || '')) return false;
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function equalSecret(a: string, b: string) { return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b))); }
