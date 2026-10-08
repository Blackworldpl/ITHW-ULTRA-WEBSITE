import {test} from 'node:test';
import assert from 'node:assert/strict';
import {purchaseTotal} from '../src/shared/money';
test('purchase amounts keep missing prices distinct from zero and exact complete totals',()=>{
 assert.equal(purchaseTotal([{quantity:2,unitPrice:'12.34'},{quantity:1,unitPrice:null}]),null);
 assert.equal(purchaseTotal([{quantity:2,unitPrice:'0.00'}]),'0.00');
 assert.equal(purchaseTotal([{quantity:25,unitPrice:'1,99'},{quantity:2,unitPrice:'0.10'}]),'49.95');
});
test('fractional purchase values round each line to cents before summing',()=>{
 assert.equal(purchaseTotal([{quantity:2.5,unitPrice:'1.99'}]),'4.98');
 assert.equal(purchaseTotal([{quantity:0.5,unitPrice:'0.01'},{quantity:0.5,unitPrice:'0.01'}]),'0.02');
 assert.equal(purchaseTotal([{quantity:0.001,unitPrice:'1234.56'}]),'1.23');
 assert.equal(purchaseTotal([{quantity:0.1,unitPrice:'0.10'},{quantity:0.2,unitPrice:'0.10'}]),'0.03');
 assert.throws(()=>purchaseTotal([{quantity:1.0001,unitPrice:'1.00'}]));
});
