import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('Zakupy, stanowiska i niezmienne dokumenty wyposażenia',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const testUrl=process.env.TEST_DATABASE_URL!;assert.ok(new URL(testUrl).pathname.endsWith('_test'));assert.notEqual(testUrl,process.env.DATABASE_URL);
 process.env.DATABASE_URL=testUrl;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const uid=randomUUID().slice(0,8),password='Synthetic workflow test only!',sessions:Record<string,{cookie:string;csrf:string}>={};
 async function call(method:'GET'|'POST'|'PATCH',path:string,body?:unknown,role='ADMIN'){
  const session=sessions[role],headers:Record<string,string>={};if(session){headers.cookie=session.cookie;headers['x-csrf-token']=session.csrf;}if(method!=='GET'){headers.origin='http://localhost:3000';headers['content-type']='application/json';}
  return route[method](new NextRequest(`http://localhost:3000/api/${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function data(response:Response){const payload=await response.json();assert.ok(response.ok,JSON.stringify(payload));return payload.data;}
 try{
  for(const role of ['ADMIN','IT_USER','VIEWER']){
   const email=`equip-${role.toLowerCase()}-${uid}@example.test`;
   await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',[`Operator ${role} ${uid}`,email,await hashPassword(password),role]);
   const response=await call('POST','auth/login',{email,password},'none'),payload=await data(response);sessions[role]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:payload.csrfToken};
  }
  const supplier=await data(await call('POST','admin/suppliers',{name:`Kontrahent testowy ${uid}`}));
  const lookup=await data(await call('GET','lookups')),categoryId=lookup.categories[0].id;
  const site=await data(await call('POST','admin/locations',{name:`Testowa strefa ${uid}`}));
  const desk=await data(await call('POST','workstations',{name:`308A-${uid}`,parentId:site.id}));
  const employee=await data(await call('POST','employees',{name:`Pracownik testowy ${uid}`,email:`employee-${uid}@example.test`,department:'Dział testowy'}));
  let invoice:any;
  await t.test('faktura z pozycjami, przyjęcie i ponowienie tworzą jeden komplet rekordów',async()=>{
   const body={number:`FV-TEST-${uid}`,supplierId:supplier.id,date:'2026-10-07',currency:'PLN',amount:'300.30',receive:true,requestId:randomUUID(),items:[{kind:'asset',name:'Monitor testowy',categoryId,quantity:2,unitPrice:'100.10',locationId:desk.id,serialNumbers:[`SN-${uid}-1`,`SN-${uid}-2`]},{kind:'other',name:'Instalacja testowa',quantity:1,unitPrice:'100.10'}]};
   assert.equal((await call('POST','invoices',body,'IT_USER')).status,403);
   const created=await data(await call('POST','invoices',body));invoice=await data(await call('GET',`invoices/${created.id}`));
   assert.equal(invoice.amount,'300.30');assert.equal(invoice.items.length,2);assert.equal(invoice.assets.length,2);assert.equal(invoice.deliveries.length,1);
   assert.equal((await data(await call('POST','invoices',body))).id,invoice.id);
   assert.equal((await call('POST','invoices',{...body,number:'CHANGED'})).status,409);
   const counts=await query('SELECT count(*)::int AS count FROM assets WHERE invoice_id=$1',[invoice.id]);assert.equal(counts.rows[0].count,2);
   assert.equal((await call('POST','invoices',{...body,requestId:randomUUID(),number:`INVALID-${uid}`,amount:'0.01'})).status,400);
   const invalid={...body,requestId:randomUUID(),number:`ROLLBACK-${uid}`,items:[{...body.items[0],serialNumbers:[`SN-${uid}-1`,`NEW-${uid}`]},{...body.items[1]}]};
   assert.equal((await call('POST','invoices',invalid)).status,409);
   assert.equal((await query('SELECT id FROM invoices WHERE number=$1',[invalid.number])).rowCount,0);
  });
  await t.test('równoczesne faktury z odwrotną kolejnością produktów zwiększają stany bez konfliktu blokad',async()=>{
   const products=[];
   for(const suffix of ['a','b'])products.push(await data(await call('POST','inventory',{name:`Produkt zakupu ${suffix} ${uid}`,slug:`purchase-${suffix}-${uid}`,category:'Akcesoria'})));
   const items=products.map(product=>({kind:'inventory',inventoryItemId:product.id,quantity:1,unitPrice:'1.50'}));
   const responses=await Promise.all([items,[...items].reverse()].map((lines,index)=>call('POST','invoices',{number:`STOCK-${index}-${uid}`,supplierId:supplier.id,date:'2026-10-07',amount:'3.00',receive:true,requestId:randomUUID(),items:lines})));
   for(const response of responses)await data(response);
   for(const product of products)assert.equal((await data(await call('GET',`inventory/${product.slug}`))).stock,2);
  });
  await t.test('stół nie wydaje wyposażenia pracownikowi',async()=>{
   const equipment=await data(await call('GET',`workstations/${desk.id}`));assert.equal(equipment.assets.length,2);assert.ok(equipment.assets.every((a:any)=>a.employeeId===null));
   const personal=await data(await call('GET',`employees/${employee.id}/equipment`));assert.equal(personal.assets.length,0);
   assert.equal((await call('POST','workstations',{name:'Unauthorized'},'VIEWER')).status,403);
  });
  await t.test('zapis stanu i obiegówka zachowują historyczną listę po zwrocie',async()=>{
   const asset=invoice.assets[0];
   const assigned=await data(await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',employeeId:employee.id,version:asset.version},'IT_USER'));
   const body={kind:'clearance',notes:'Test rozliczenia',requestId:randomUUID()};
   assert.equal((await call('POST',`employees/${employee.id}/equipment-documents`,body,'VIEWER')).status,403);
   const simultaneous=await Promise.all([call('POST',`employees/${employee.id}/equipment-documents`,body,'IT_USER'),call('POST',`employees/${employee.id}/equipment-documents`,body,'IT_USER')]);
   const doc=await data(simultaneous[0]),replayed=await data(simultaneous[1]);assert.equal(replayed.id,doc.id);assert.equal(doc.itemCount,1);assert.equal(doc.snapshot.items[0].serialNumber,asset.serialNumber);
   assert.equal((await data(await call('POST',`employees/${employee.id}/equipment-documents`,body,'IT_USER'))).id,doc.id);
   assert.equal((await call('POST',`employees/${employee.id}/equipment-documents`,{...body,notes:'changed'},'IT_USER')).status,409);
   const before=await data(await call('GET',`assets/${asset.assetId}`));assert.equal(before.employeeId,employee.id,'Dokument nie zwraca urządzenia');
   await data(await call('POST',`assets/${asset.assetId}/actions`,{action:'return',status:'AVAILABLE',locationId:desk.id,version:assigned.version},'IT_USER'));
   const reread=await data(await call('GET',`equipment-documents/${doc.id}`));assert.deepEqual(reread.snapshot,doc.snapshot);
   assert.equal((await data(await call('GET',`employees/${employee.id}/equipment`))).assets.length,0);
   const html=await call('GET',`equipment-documents/${doc.id}/html`);assert.equal(html.status,200);assert.match(await html.text(),/Podpis pracownika/);
   const mail=await call('GET',`equipment-documents/${doc.id}/email`);assert.equal(mail.headers.get('content-type'),'message/rfc822');assert.match(await mail.text(),/X-Unsent: 1/);
   await assert.rejects(query('UPDATE equipment_documents SET reference=$2 WHERE id=$1',[doc.id,'changed']),/history|Historia|histor/i);
  });
  await t.test('dokument stanowiska i wersjonowana edycja faktury',async()=>{
   const doc=await data(await call('POST',`workstations/${desk.id}/equipment-documents`,{kind:'workstation',requestId:randomUUID()}));assert.equal(doc.itemCount,2);assert.equal(doc.snapshot.subject.name,desk.name);
   assert.ok((await data(await call('GET','documents'))).some((d:any)=>d.id===doc.id&&d.equipmentDocument));
   assert.ok((await data(await call('GET','search?q='+encodeURIComponent(doc.reference)))).some((r:any)=>r.id===doc.id&&r.href.includes('equipmentDocument=')));
   const edit={number:invoice.number,supplierId:supplier.id,date:invoice.date,amount:invoice.amount,currency:invoice.currency,notes:'Poprawiona uwaga',version:invoice.version};
   const updated=await data(await call('PATCH',`invoices/${invoice.id}`,edit));assert.equal(updated.version,invoice.version+1);
   assert.equal((await call('PATCH',`invoices/${invoice.id}`,edit)).status,409);
   assert.equal((await call('PATCH',`invoices/${invoice.id}`,{...edit,version:updated.version,items:[{kind:'other',name:'Zmiana',quantity:1,unitPrice:invoice.amount}]})).status,409);
   const registered=await data(await call('POST','invoices',{number:`DOC-${uid}`,supplierId:supplier.id,date:'2026-10-07',amount:'10.00',items:[{kind:'other',name:'Testowa pozycja',quantity:1,unitPrice:'10.00'}]}));
   const changed=await data(await call('PATCH',`invoices/${registered.id}`,{number:registered.number,supplierId:supplier.id,date:registered.date,amount:'20.00',currency:'PLN',version:registered.version,items:[{kind:'other',name:'Testowa poprawka',quantity:2,unitPrice:'10.00'}]}));assert.equal(changed.amount,'20.00');
  });
 }finally{await pool.end();}
});
