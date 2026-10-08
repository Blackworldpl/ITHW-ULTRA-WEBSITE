import {test} from 'node:test';
import assert from 'node:assert/strict';
import {categoryFieldError} from '../src/shared/category-fields';
import {canNestLocation,locationSubtree} from '../src/shared/locations';
import type {CategoryField,Location} from '../src/shared/types';
import {labelZpl,zplText} from '../src/server/labels';
import {assetFieldVisible,categoryAssetBody} from '../src/shared/asset-fields';

test('category fields enforce required values, finite numbers, real dates and choices',()=>{
 const fields:CategoryField[]=[{key:'ram',label:'RAM',type:'number',required:true},{key:'checked',label:'Sprawdzony',type:'boolean',required:true},{key:'date',label:'Data',type:'date',required:false},{key:'ports',label:'Porty',type:'select',required:false,options:['USB','HDMI']}];
 const valid={ram:'0',checked:'false',date:'2024-02-29',ports:'HDMI'};
 assert.equal(categoryFieldError(fields,valid),null);
 for(const values of [{...valid,ram:''},{...valid,ram:'Infinity'},{...valid,checked:'no'},{...valid,date:'2026-02-29'},{...valid,ports:'VGA'}])assert.ok(categoryFieldError(fields,values));
 assert.equal(categoryFieldError(fields,{ram:'-1.5',checked:'true',legacy:'Preserved'}),null);
});
test('tree moves allow repeated kinds and arbitrary levels while forbidding cycles',()=>{
 const location=(id:string,kind:string,parentId:string|null):Location=>({id,name:id,path:id,kind,parentId,version:1});
 const root=location('root','SITE',null),room=location('room','ROOM','root'),bin=location('bin','BIN','room'),other=location('other','SITE',null);
 const rows=[root,room,bin,other];
 assert.deepEqual([...locationSubtree(rows,'room')],['room','bin']);
 assert.equal(canNestLocation(rows,room,other),true);
 assert.equal(canNestLocation(rows,room,bin),false);
 assert.equal(canNestLocation(rows,room,room),false);
 assert.equal(canNestLocation(rows,other,root),true);
 assert.equal(canNestLocation(rows,other,bin),true);
});
test('hidden category fields are omitted without resetting data or bypassing assignment',()=>{
 const category={standardFields:{hostname:false,ipAddress:false,macAddress:false,owner:false,isFixedAsset:false,invoiceId:false}};
 assert.equal(assetFieldVisible(category,'ipAddress'),false);
 assert.equal(assetFieldVisible(category,'model'),true);
 assert.equal(assetFieldVisible(undefined,'ipAddress'),true);
 const body={name:'Synthetic',status:'AVAILABLE',owner:'Existing owner',employeeId:'existing',ipAddress:'192.0.2.1',macAddress:'00:00:00:00:00:01',hostname:'host',isFixedAsset:true,fixedAssetNumber:'ST-TEST',invoiceId:'existing',version:2};
 assert.deepEqual(categoryAssetBody(body,category),{name:'Synthetic',status:'AVAILABLE',version:2});
 const assigned=categoryAssetBody({...body,status:'ASSIGNED'},category);
 assert.equal(assigned.owner,'Existing owner');assert.equal(assigned.employeeId,'existing');
});
test('Zebra graphic fits 300 DPI label and escapes all user-controlled text bytes',()=>{
 const label=labelZpl('Drukarka ^XZ ~JA ą','ITHW-00000001','http://localhost:3000/asset/ITHW-00000001',60,50,300);
 assert.match(label,/\^PW709\n\^LL591/);
 assert.equal(label.match(/\^XZ/g)?.length,1);
 assert.ok(!label.includes('~JA'));
 assert.equal(zplText('ą^'), '_C4_85_5E');
 const graphic=/\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/.exec(label)!;
 assert.equal(Number(graphic[1]),Number(graphic[2]));assert.equal(graphic[4].length,Number(graphic[1])*2);
 assert.ok(Number(graphic[1])/Number(graphic[3])<591);
 assert.throws(()=>labelZpl('Test','ID','https://example.invalid/'+'a'.repeat(1000),30,30,203),/rozmiar/);
});
test('Zebra graphics retain physical dimensions for 203, 300 and 600 DPI',()=>{
 for(const dpi of [203,300,600]){
  const width=Math.round(60*dpi/25.4),height=Math.round(50*dpi/25.4),label=labelZpl('Synthetic calibration','DEMO','http://localhost:3000/asset/ITHW-00000001',60,50,dpi);
  assert.ok(label.includes(`^PW${width}\n^LL${height}`));assert.equal(label.match(/\^PQ1/g)?.length,1);
  const graphic=/\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/.exec(label)!;const x=Number(/\^FO(\d+),\d+\^GFA/.exec(label)![1]),pixels=Number(graphic[1])/Number(graphic[3]);
  assert.equal(graphic[4].length,Number(graphic[1])*2);assert.ok(x>=0&&x+pixels<=width);assert.ok(pixels<height);
 }
});
