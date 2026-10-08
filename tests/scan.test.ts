import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanTarget } from '../src/shared/scan';

test('QR resolver accepts local record paths and hardware keyboard identifiers',()=>{
  const origin='https://hardware.internal';
  assert.equal(scanTarget('ITHW-00001284',origin),'/asset/ITHW-00001284');
  assert.equal(scanTarget('hdmi-2m',origin),'/inventory/hdmi-2m');
  assert.equal(scanTarget(`${origin}/asset/ITHW-00001284`,origin),'/asset/ITHW-00001284');
  assert.equal(scanTarget('/inventory/hdmi-2m',origin),'/inventory/hdmi-2m');
  assert.equal(scanTarget('/workstations/11111111-1111-4111-8111-111111111111',origin),'/workstations/11111111-1111-4111-8111-111111111111');
  assert.equal(scanTarget('/assets?locationId=11111111-1111-4111-8111-111111111111',origin),'/assets?locationId=11111111-1111-4111-8111-111111111111');
});
test('QR resolver rejects external URLs, scripts, path tricks and unsupported routes',()=>{
  const origin='https://hardware.internal';
  for(const value of ['https://attacker.invalid/asset/ITHW-00001284','javascript:alert(1)','//attacker.invalid/inventory/hdmi','https://user:password@hardware.internal/asset/ITHW-00001284','/admin','/inventory/hdmi?redirect=evil','/asset/ITHW-123','/asset/ITHW-00001284#evil','/assets?locationId=bad','/assets?locationId=11111111-1111-4111-8111-111111111111&next=/admin'])assert.equal(scanTarget(value,origin),null,value);
});
