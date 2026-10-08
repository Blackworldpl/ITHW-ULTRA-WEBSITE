import assert from 'node:assert/strict';
import test from 'node:test';
import { createUuid } from '../src/shared/uuid';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('HTTP LAN: generates valid distinct request IDs without crypto.randomUUID', () => {
  const httpCrypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) };
  const values = Array.from({ length: 1000 }, () => createUuid(httpCrypto));
  assert.ok(values.every(value => uuidV4.test(value)));
  assert.equal(new Set(values).size, values.length);
});

test('HTTPS/localhost: keeps native UUID generation and its receiver', () => {
  const source = {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      assert.equal(this, source);
      return '12345678-1234-4123-8123-123456789abc';
    },
  };
  assert.equal(createUuid(source), '12345678-1234-4123-8123-123456789abc');
});
