import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NextRequest} from 'next/server';
import type {InventoryDictionaryEntry,InventoryDictionaries} from '../src/shared/inventory-dictionaries';
import type {InventoryItem} from '../src/shared/types';

const enabled=!!process.env.TEST_DATABASE_URL;
test('Inventory dictionaries: administrator CRUD, fixed choices and preserved products',{skip:!enabled},async t=>{
 assert.ok(new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('_test'));process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;process.env.APP_URL='http://localhost:3000';
 const route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const tag=randomUUID().slice(0,8),sessions:Record<string,{cookie:string;csrf:string}>={};
 async function call(method:'GET'|'POST'|'PATCH'|'DELETE',path:string,body?:unknown,role='ADMIN',csrf=true){const session=sessions[role],headers:Record<string,string>={};if(session){headers.cookie=session.cookie;if(csrf)headers['x-csrf-token']=session.csrf;}if(method!=='GET'){headers.origin=process.env.APP_URL!;headers['content-type']='application/json';}return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});}
 async function data<T>(response:Response):Promise<T>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body.data;}
 let category:InventoryDictionaryEntry,unit:InventoryDictionaryEntry,item:InventoryItem;
 try{
  for(const role of ['ADMIN','IT_ADVANCED','VIEWER']){const email=`dictionary-${role.toLowerCase()}-${tag}@example.test`,password='Fictional dictionary test!';await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',[email,email,await hashPassword(password),role]);const response=await call('POST','auth/login',{email,password},'none'),user=await data<{csrfToken:string}>(response);sessions[role]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};}
  await t.test('reads are scoped; list writes require ADMIN, CSRF and fresh versions',async()=>{
   assert.equal((await call('GET','inventory/dictionaries',undefined,'none')).status,401);
   assert.equal((await call('GET','admin/inventory-dictionaries',undefined,'IT_ADVANCED')).status,403);
   const dictionaries=await data<InventoryDictionaries>(await call('GET','inventory/dictionaries',undefined,'VIEWER'));assert.ok(dictionaries.units.some(e=>e.name==='szt.'));
   const body={kind:'category',name:`Synthetic list ${tag}`,label:'Synthetic'};
   assert.equal((await call('POST','admin/inventory-dictionaries',body,'IT_ADVANCED')).status,403);
   assert.equal((await call('POST','admin/inventory-dictionaries',body,'ADMIN',false)).status,403);
   category=await data(await call('POST','admin/inventory-dictionaries',body));
   assert.equal((await call('POST','admin/inventory-dictionaries',{...body,name:body.name.toUpperCase()})).status,409);
   assert.equal((await call('PATCH','admin/inventory-dictionaries/'+category.id,{...body,version:999})).status,409);
   unit=await data(await call('POST','admin/inventory-dictionaries',{kind:'unit',name:`u-${tag}`,label:'Synthetic unit'}));
  });
  await t.test('interactive products reject unlisted values; label edits preserve ID and QR',async()=>{
   const payload={name:`Synthetic product ${tag}`,slug:`dict-product-${tag}`,category:category.name,unit:unit.name,minimalStock:0};
   assert.equal((await call('POST','inventory',{...payload,category:'unknown-'+tag})).status,400);
   assert.equal((await call('POST','inventory',{...payload,unit:'unknown-'+tag})).status,400);
   assert.equal((await call('POST','imports/preview',{sourceHash:tag.repeat(8),sheet:'Synthetic',mode:'inventory',category:'unknown-'+tag,fixedAssets:false,rows:[{row:2,name:'Synthetic import',quantity:1}]})).status,400);
   item=await data(await call('POST','inventory',payload));
   category=await data(await call('PATCH','admin/inventory-dictionaries/'+category.id,{kind:'category',name:category.name+' renamed',label:'Renamed',version:category.version}));
   const after=await data<InventoryItem>(await call('GET','inventory/'+item.slug));assert.equal(after.category,category.name);assert.equal(after.id,item.id);assert.equal(after.slug,item.slug);assert.equal(after.stock,0);assert.ok(after.version>item.version);
   assert.equal((await query('SELECT id FROM qr_codes WHERE inventory_item_id=$1',[item.id])).rowCount,1);item=after;
   assert.equal((await call('PATCH','admin/inventory-dictionaries/'+unit.id,{kind:'unit',name:'changed-'+tag,label:'Changed',version:unit.version})).status,409);
   unit=await data(await call('PATCH','admin/inventory-dictionaries/'+unit.id,{kind:'unit',name:unit.name,label:'Full unit name',version:unit.version}));assert.equal(unit.used,1);
  });
  await t.test('inactive choices preserve existing products and used values cannot be deleted',async()=>{
   category=await data(await call('PATCH','admin/inventory-dictionaries/'+category.id,{kind:'category',name:category.name,label:category.label,active:false,version:category.version}));
   assert.equal((await call('POST','inventory',{name:'Denied inactive',slug:`inactive-${tag}`,category:category.name,unit:unit.name})).status,400);
   item=await data(await call('PATCH','inventory/'+item.slug,{category:category.name,notes:'Existing inactive choice retained',version:item.version}));assert.equal(item.category,category.name);
   assert.equal((await call('DELETE','admin/inventory-dictionaries/'+category.id,{version:category.version})).status,409);
   assert.equal((await call('DELETE','admin/inventory-dictionaries/'+unit.id,{version:unit.version})).status,409);
   const supplier=await data<{id:string}>(await call('POST','admin/suppliers',{name:'Synthetic dictionary supplier '+tag}));
   await data(await call('POST','invoices',{number:'DICT-FV-'+tag,supplierId:supplier.id,date:'2026-10-08',amount:'1.00',items:[{kind:'inventory',inventoryItemId:item.id,quantity:1,unitPrice:'1.00'}]}));
   assert.equal((await call('PATCH','inventory/'+item.slug,{unit:'szt.',version:item.version})).status,409,'A document preserves its unit even before any stock movement');
   await data(await call('POST','inventory/'+item.slug+'/movements',{delta:2,requestId:randomUUID()}));item=await data(await call('GET','inventory/'+item.slug));
   assert.equal((await call('PATCH','inventory/'+item.slug,{unit:'szt.',version:item.version})).status,409);
  });
  await t.test('unused entries can be deleted once and changes have an audit trail',async()=>{
   const disposable=await data<InventoryDictionaryEntry>(await call('POST','admin/inventory-dictionaries',{kind:'unit',name:'unused-'+tag,label:'Disposable synthetic'}));
   assert.equal((await call('DELETE','admin/inventory-dictionaries/'+disposable.id,{version:999})).status,409);
   assert.equal((await call('DELETE','admin/inventory-dictionaries/'+disposable.id,{version:disposable.version})).status,200);
   assert.equal((await call('DELETE','admin/inventory-dictionaries/'+disposable.id,{version:disposable.version})).status,404);
   assert.ok((await query("SELECT id FROM audit_logs WHERE entity_type='inventory_dictionary' AND entity_id=$1",[disposable.id])).rowCount!>=2);
  });
  await t.test('concurrent creation and deletion cannot leave a product without its choice',async()=>{
   const entry=await data<InventoryDictionaryEntry>(await call('POST','admin/inventory-dictionaries',{kind:'category',name:'Race '+tag,label:'Race'}));
   const [created,deleted]=await Promise.all([call('POST','inventory',{name:'Synthetic race '+tag,slug:'race-'+tag,category:entry.name,unit:'szt.'}),call('DELETE','admin/inventory-dictionaries/'+entry.id,{version:entry.version})]);
   if(created.ok){assert.equal(deleted.status,409);assert.equal((await query('SELECT id FROM inventory_dictionary_entries WHERE id=$1',[entry.id])).rowCount,1);}else{assert.equal(created.status,400);assert.equal(deleted.status,200);}
  });
 }finally{await pool.end();}
});
