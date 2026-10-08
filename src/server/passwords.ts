import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key)));
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
