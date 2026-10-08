import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/shared/import';

test('CSV: quoting, multiline, escaped quotes, BOM and original row positions',()=>{
 const rows=parseCsv('\uFEFFNazwa;Serial;Ilość\r\n"Monitor; duży";0000123;1\r\n\r\n"Opis\n""druga linia""";;2\r\n');
 assert.deepEqual(rows,[['Nazwa','Serial','Ilość'],['Monitor; duży','0000123','1'],[''],['Opis\n"druga linia"','','2']]);
 assert.deepEqual(parseCsv('Name,Qty\n"A,B",2'),[['Name','Qty'],['A,B','2']]);
 assert.deepEqual(parseCsv('Name\tQty\nA\t1'),[['Name','Qty'],['A','1']]);
});
test('CSV: reject broken quoting, excessive rows and oversized cells',()=>{
 assert.throws(()=>parseCsv('Name;Qty\n"open;2'),/cudzysłów/);
 assert.throws(()=>parseCsv('Name;Qty\n"x"bad;2'),/cudzysłowu/);
 assert.throws(()=>parseCsv('x'.repeat(10001)),/komórka/);
 assert.throws(()=>parseCsv('Name\n'+'A\n'.repeat(10001)),/wierszy/);
});
