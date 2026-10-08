import {test} from 'node:test';
import assert from 'node:assert/strict';
import {invoiceTotal,normalizedMoney} from '../src/shared/money';
import {equipmentDocumentHtml} from '../src/shared/equipment-document';
import type {EquipmentDocument} from '../src/shared/types';
test('Kwoty faktury: przecinek, spacje, dokładne grosze i limit',()=>{
 assert.equal(normalizedMoney('1 250,50'),'1250.50');assert.equal(invoiceTotal([{quantity:3,unitPrice:'0.10'},{quantity:1,unitPrice:'0.20'}]),'0.50');
 assert.throws(()=>normalizedMoney('1.234'));assert.equal(invoiceTotal([{quantity:1.5,unitPrice:'1'}]),'1.50');assert.throws(()=>invoiceTotal([{quantity:1.0001,unitPrice:'1'}]));assert.throws(()=>invoiceTotal([{quantity:1000,unitPrice:'999999999999.99'}]));
});
test('Papierowy dokument koduje nazwy, uwagi i numery seryjne jako tekst',()=>{
 const doc:EquipmentDocument={id:'test',reference:'TEST/1',kind:'clearance',createdAt:'2026-10-07T10:00:00Z',createdBy:'Operator',itemCount:1,snapshot:{subject:{name:'<img src=x onerror=alert(1)>'},notes:'<script>bad</script>',items:[{assetId:'ITHW-00000001',name:'Monitor',model:null,serialNumber:'<svg onload=bad>',status:'ASSIGNED',locationName:null}]}};
 const html=equipmentDocumentHtml(doc);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;svg'));assert.ok(html.includes('Podpis pracownika'));assert.ok(html.includes('nie potwierdza zwrotu'));
});
