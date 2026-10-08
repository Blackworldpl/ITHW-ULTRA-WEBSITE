import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, equalSecret } from '../src/server/passwords';
import { loginUrl, safeReturnPath,passwordChangeUrl } from '../src/shared/login-return';

test('passwords are salted scrypt hashes, verified without plaintext storage', async () => {
  const password='Test only password 2026!';
  const a=await hashPassword(password), b=await hashPassword(password);
  assert.notEqual(a,b); assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password,a),true);
  assert.equal(await verifyPassword('wrong password',a),false);
  assert.equal(await verifyPassword(password,'bad-format'),false);
});
test('CSRF/setup secrets compare full values',()=>{
  assert.equal(equalSecret('abc','abc'),true);
  assert.equal(equalSecret('abc','abcd'),false);
  assert.equal(equalSecret('','x'),false);
});
test('QR login returns to the record and preserves filters',()=>{
  for(const path of ['/asset/ITHW-00000001','/inventory/synthetic-hdmi','/assets?fixed=true&locationId=example','#invalid']) {
    if(path==='#invalid')assert.equal(safeReturnPath(path),'/');
    else assert.equal(safeReturnPath(new URLSearchParams(loginUrl(path).split('?')[1]).get('next')),path);
  }
});
test('login return refuses external URLs, scripts, encoded paths and auth loops',()=>{
  for(const path of ['https://evil.invalid','//evil.invalid','/\\evil.invalid','javascript:alert(1)','/%2f%2fevil.invalid','/%5cevil.invalid','/login?next=/login','/api/auth/logout','/setup','/asset/ITHW-00000001\n','/assets/../../login','/assets\u0000']) assert.equal(safeReturnPath(path),'/');
});

test('mandatory password change preserves local return and refuses auth loops',()=>{
 const destination='/inventory/synthetic-cable?returnTo=%2Finventory';
 assert.equal(new URLSearchParams(passwordChangeUrl(destination).split('?')[1]).get('next'),destination);
 for(const path of ['https://evil.invalid','//evil.invalid','/change-password?next=/change-password','/invite?token=example','/api/auth/change-password'])assert.equal(passwordChangeUrl(path),'/change-password?next=%2F');
});
