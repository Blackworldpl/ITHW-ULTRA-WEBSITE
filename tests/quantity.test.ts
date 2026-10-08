import test from 'node:test';
import assert from 'node:assert/strict';
import {integerQuantity,quantityValue,quantityUnits,quantityNumber,addQuantity,subtractQuantity,validQuantity} from '../src/shared/quantity';
test('blank or malformed quantities cannot turn into stock changes',()=>{
 for(const text of ['',' ','1.5','-1','1e2','Infinity','NaN'])assert.throws(()=>integerQuantity(text));
 assert.equal(integerQuantity('0',0,10000000),0);assert.equal(integerQuantity('015'),15);assert.equal(integerQuantity(' 25 '),25);assert.throws(()=>integerQuantity('0'));assert.throws(()=>integerQuantity('1000001'));
});
test('fractional quantities accept Polish input and respect unit precision without rounding',()=>{
 assert.equal(quantityValue(' 2,5 ',3),2.5);assert.equal(quantityValue('0.001'),0.001);assert.equal(quantityValue('0',0,0),0);
 assert.equal(quantityValue('2.500',1),2.5);assert.equal(quantityValue('2.000',0),2);
 for(const value of ['', '1e2','NaN','Infinity','1.2345','1,2,3','-1','0'])assert.throws(()=>quantityValue(value));
 assert.throws(()=>quantityValue('2.5',0));assert.throws(()=>quantityValue('0.01',1));assert.equal(validQuantity(0.1+0.2),false);
 assert.equal(addQuantity(0.1,0.2),0.3);assert.equal(subtractQuantity(0.3,0.1),0.2);assert.equal(quantityNumber(quantityUnits('-0.125')),-0.125);
 let stock=0;for(let i=0;i<1000;i++)stock=addQuantity(stock,0.001);assert.equal(stock,1);
});
