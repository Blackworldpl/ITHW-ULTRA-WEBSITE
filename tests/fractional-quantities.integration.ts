import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {InventoryItem,InvoiceDetail} from '../src/shared/types';
import type {InventoryDictionaryEntry,InventoryDictionaries} from '../src/shared/inventory-dictionaries';

test('Fractional quantities: exact stock, partial purchases, immutable precision and imports',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(new URL(url).pathname.endsWith('_test'));process.env.DATABASE_URL=url;process.env.APP_URL='http://localhost:3000';
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const tag=randomUUID().slice(0,8),sessions:Record<string,{cookie:string;csrf:string}>={};
 async function call(method:'GET'|'POST'|'PATCH',path:string,body?:unknown,role='ADMIN',csrf=true){const session=sessions[role],headers:Record<string,string>={origin:process.env.APP_URL!,'content-type':'application/json'};if(session){headers.cookie=session.cookie;if(csrf)headers['x-csrf-token']=session.csrf;}return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});}
 async function data<T=any>(response:Response):Promise<T>{const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body.data;}
 try{
  for(const role of ['ADMIN','IT_USER','VIEWER']){const email=`fraction-${role.toLowerCase()}-${tag}@example.test`,password='Synthetic fractions test!';await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',[email,email,await hashPassword(password),role]);const r=await call('POST','auth/login',{email,password},'none'),user=await data(r);sessions[role]={cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};}
  const dictionaries=await data<InventoryDictionaries>(await call('GET','inventory/dictionaries')),category=dictionaries.categories.find(c=>c.active)!.name;
  assert.equal(dictionaries.units.find(u=>u.name==='m')!.quantityPrecision,3);assert.equal(dictionaries.units.find(u=>u.name==='szt.')!.quantityPrecision,0);
  const supplier=await data(await call('POST','admin/suppliers',{name:'Synthetic fractions supplier '+tag}));
  let item:InventoryItem,unit:InventoryDictionaryEntry,draft:InvoiceDetail;
  await t.test('opening stock, comma precision rules and repeated tenths keep exact balances',async()=>{
   item=await data(await call('POST','inventory',{name:'Synthetic cable '+tag,slug:'fraction-cable-'+tag,category,unit:'m',minimalStock:0.125,openingStock:0.3,openingNote:'Synthetic counted length',requestId:randomUUID()}));assert.equal(item.stock,0.3);assert.equal(item.quantityPrecision,3);assert.equal(item.minimalStock,0.125);
   for(let i=0;i<3;i++)item=await data(await call('POST','inventory/'+item.slug+'/movements',{delta:-0.1,requestId:randomUUID()},'IT_USER'));assert.equal(item.stock,0);
   const concurrent=await Promise.all([0.1,0.2].map(delta=>call('POST','inventory/'+item.slug+'/movements',{delta,requestId:randomUUID()},'IT_USER')));for(const r of concurrent)await data(r);item=await data(await call('GET','inventory/'+item.slug));assert.equal(item.stock,0.3);
   const history=await data(await call('GET','inventory/'+item.slug+'/history'));assert.ok(history.every((h:any)=>typeof h.delta==='number'&&typeof h.balanceAfter==='number'));assert.equal(history[0].balanceAfter,0.3);
   assert.equal((await call('POST','inventory/'+item.slug+'/movements',{delta:0.0001,requestId:randomUUID()})).status,400);assert.equal((await call('POST','inventory/'+item.slug+'/movements',{delta:0.1,requestId:randomUUID()},'VIEWER')).status,403);
   const whole={name:'Synthetic whole '+tag,slug:'fraction-whole-'+tag,category,unit:'szt.'};assert.equal((await call('POST','inventory',{...whole,minimalStock:0.5})).status,400);assert.equal((await call('POST','inventory',{...whole,openingStock:0.5,openingNote:'Synthetic count',requestId:randomUUID()})).status,400);
   const product=await data(await call('POST','inventory',whole));assert.equal((await call('POST','inventory/'+product.slug+'/movements',{delta:0.5,requestId:randomUUID()})).status,400);
   await assert.rejects(query('UPDATE inventory_items SET stock=0.5 WHERE id=$1',[product.id]),(error:any)=>error.code==='23514');
  });
  await t.test('concurrent withdrawal cannot overdraw a fractional balance; correction is exact and replayable',async()=>{
   await data(await call('POST','inventory/'+item.slug+'/correction',{stock:0.1,expectedStock:0.3,note:'Synthetic counted correction',requestId:randomUUID()}));
   const results=await Promise.all([1,2].map(()=>call('POST','inventory/'+item.slug+'/movements',{delta:-0.1,requestId:randomUUID()},'IT_USER')));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);item=await data(await call('GET','inventory/'+item.slug));assert.equal(item.stock,0);
   const body={stock:0.125,expectedStock:0,note:'Synthetic correction with precision',requestId:randomUUID()};assert.equal((await data(await call('POST','inventory/'+item.slug+'/correction',body))).stock,0.125);assert.equal((await data(await call('POST','inventory/'+item.slug+'/correction',body))).stock,0.125);
   assert.equal((await call('POST','inventory/'+item.slug+'/correction',{...body,requestId:randomUUID()})).status,409);
  });
  await t.test('partial invoice receipts preserve fractional remainder, replay and stale-version protection',async()=>{
   const invoice=await data(await call('POST','invoices',{number:'FRACTION-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[{kind:'inventory',inventoryItemId:item.id,quantity:0.3,unitPrice:'1.99'}]}));draft=await data(await call('GET','invoices/'+invoice.id));assert.equal(draft.amount,'0.60');assert.equal(draft.items[0].quantityPrecision,3);
   const path=`invoices/${draft.id}/items/${draft.items[0].id}/receive`,body={quantity:0.1,version:draft.version,requestId:randomUUID()};assert.deepEqual(await data(await call('POST',path,body)),{received:0.1,remaining:0.2});assert.deepEqual(await data(await call('POST',path,body)),{received:0.1,remaining:0.2});
   assert.equal((await call('POST',path,{...body,requestId:randomUUID()})).status,409);draft=await data(await call('GET','invoices/'+draft.id));assert.equal((await call('POST',path,{quantity:0.201,version:draft.version,requestId:randomUUID()})).status,409);
   assert.deepEqual(await data(await call('POST',path,{quantity:0.2,version:draft.version,requestId:randomUUID()})),{received:0.3,remaining:0});draft=await data(await call('GET','invoices/'+draft.id));assert.equal(draft.items[0].receivedQuantity,0.3);assert.deepEqual(draft.deliveries[0].quantities,[{unit:'m',quantity:0.3}]);assert.equal((await data(await call('GET','inventory/'+item.slug))).stock,0.425);
   assert.equal((await call('POST',path,{quantity:0.001,version:draft.version,requestId:randomUUID()})).status,409);
   const other={number:'FRACTION-OTHER-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[{kind:'other',name:'Synthetic whole service',quantity:0.5}]};assert.equal((await call('POST','invoices',other)).status,400);
  });
  await t.test('unit precision can increase, but earlier invoice precision stays fixed',async()=>{
   unit=await data(await call('POST','admin/inventory-dictionaries',{kind:'unit',name:'fu-'+tag,label:'Synthetic fractional unit',quantityPrecision:1}));const product=await data<InventoryItem>(await call('POST','inventory',{name:'Synthetic precise '+tag,slug:'fraction-precise-'+tag,category,unit:unit.name}));
   assert.equal((await call('POST','inventory/'+product.slug+'/movements',{delta:0.01,requestId:randomUUID()})).status,400);
   const invoice=await data(await call('POST','invoices',{number:'FRACTION-SNAPSHOT-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[{kind:'inventory',inventoryItemId:product.id,quantity:0.2}]}));let detail=await data<InvoiceDetail>(await call('GET','invoices/'+invoice.id));assert.equal(detail.items[0].quantityPrecision,1);
   unit=await data(await call('PATCH','admin/inventory-dictionaries/'+unit.id,{kind:unit.kind,name:unit.name,label:unit.label,quantityPrecision:2,version:unit.version}));assert.equal((await data(await call('GET','inventory/'+product.slug))).quantityPrecision,2);await data(await call('POST','inventory/'+product.slug+'/movements',{delta:0.01,requestId:randomUUID()}));
   const path=`invoices/${invoice.id}/items/${detail.items[0].id}/receive`;assert.equal((await call('POST',path,{quantity:0.05,version:detail.version,requestId:randomUUID()})).status,400);await data(await call('POST',path,{quantity:0.1,version:detail.version,requestId:randomUUID()}));
   assert.equal((await call('PATCH','admin/inventory-dictionaries/'+unit.id,{kind:unit.kind,name:unit.name,label:unit.label,quantityPrecision:0,version:unit.version})).status,409);
   await assert.rejects(query('UPDATE inventory_dictionary_entries SET quantity_precision=0 WHERE id=$1',[unit.id]),(error:any)=>error.code==='23514');
  });
  await t.test('mixed receipts and later prices round per line; legacy receipt agrees',async()=>{
   const items=[{kind:'inventory',inventoryItemId:item.id,quantity:0.5,unitPrice:'0.01'},{kind:'inventory',inventoryItemId:item.id,quantity:0.5,unitPrice:'0.01'},{kind:'other',name:'Synthetic service',quantity:1,unitPrice:'0.00'}];
   const invoice=await data(await call('POST','invoices',{number:'FRACTION-ROUND-'+tag,supplierId:supplier.id,date:'2026-10-08',items,receive:true,requestId:randomUUID()}));assert.equal(invoice.amount,'0.02');
   const legacy=await data(await call('POST','deliveries',{invoiceNumber:'FRACTION-LEGACY-'+tag,supplierId:supplier.id,date:'2026-10-08',requestId:randomUUID(),items:items.slice(0,2)}));assert.equal((await data(await call('GET','invoices/'+legacy.invoiceId))).amount,'0.02');
   const pending=await data(await call('POST','invoices',{number:'FRACTION-LATE-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[{kind:'inventory',inventoryItemId:item.id,quantity:2.5}]}));const detail=await data<InvoiceDetail>(await call('GET','invoices/'+pending.id));const priced=await data(await call('PATCH','invoices/'+pending.id,{number:pending.number,supplierId:supplier.id,date:'2026-10-08',currency:'PLN',amount:null,version:pending.version,itemPrices:[{id:detail.items[0].id,unitPrice:'1.99'}]}));assert.equal(priced.amount,'4.98');
  });
  await t.test('synthetic import selects its unit and keeps exact totals; reports return numbers',async()=>{
   const payload={sourceHash:createHash('sha256').update(tag).digest('hex'),sheet:'Synthetic',mode:'inventory',unit:'m',category,fixedAssets:false,rows:[{row:2,name:'Synthetic fraction import A '+tag,quantity:0.1},{row:3,name:'Synthetic fraction import B '+tag,quantity:0.2}]};const preview=await data(await call('POST','imports/preview',payload));assert.equal(preview.errors,0);assert.equal(preview.newUnits,0.3);const result=await data(await call('POST','imports/commit',{payload,requestId:randomUUID(),previewToken:preview.token}));assert.equal(result.createdUnits,0.3);
   const whole=await data(await call('POST','imports/preview',{...payload,unit:'szt.'}));assert.equal(whole.errors,2);
   const report=await data(await call('GET','reports'));assert.ok(report.topWithdrawals.every((row:any)=>typeof row.quantity==='number'));assert.ok(report.shortages.every((row:any)=>typeof row.stock==='number'&&typeof row.missing==='number'));
  });
 }finally{await pool.end();}
});
