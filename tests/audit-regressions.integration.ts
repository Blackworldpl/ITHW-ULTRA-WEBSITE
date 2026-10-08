import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';

// Regression tests for audit findings F01–F06 (2026-10-08). Synthetic data only.
test('Audit regressions: alternative API paths respect fine-grained permissions',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const url=process.env.TEST_DATABASE_URL!;assert.ok(new URL(url).pathname.endsWith('_test'));assert.notEqual(url,process.env.DATABASE_URL);
 process.env.DATABASE_URL=url;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const tag=randomUUID().slice(0,8),password='Synthetic audit regression only!',sessions:Record<string,{cookie:string;csrf:string}>={};
 async function call(method:'GET'|'POST'|'PATCH',path:string,body?:unknown,who='ADMIN'){
  const session=sessions[who],headers:Record<string,string>={origin:'http://localhost:3000','content-type':'application/json'};
  if(session){headers.cookie=session.cookie;headers['x-csrf-token']=session.csrf;}
  const request=new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return route[method](request,{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function data(response:Response){const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body.data;}
 async function account(who:string,role:string,permissions?:string[]){
  const roleId=permissions?(await data(await call('POST','admin/permissions',{name:`Audit ${who} ${tag}`,baseRole:role,permissions}))).id:null;
  const email=`audit-${who.toLowerCase()}-${tag}@test.invalid`;
  await query('INSERT INTO users(name,email,password_hash,role,permission_role_id) VALUES($1,$2,$3,$4,$5)',[`Audit ${who} ${tag}`,email,await hashPassword(password),role,roleId]);
  const response=await call('POST','auth/login',{email,password},'none'),user=await data(response);
  sessions[who]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};return user;
 }
 const count=async(sql:string,values:unknown[])=>(await query<{count:number}>(sql,values)).rows[0].count;
 try{
  const adminEmail=`audit-admin-${tag}@test.invalid`;
  await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')",['Audit admin '+tag,adminEmail,await hashPassword(password)]);
  const login=await call('POST','auth/login',{email:adminEmail,password},'none'),admin=await data(login);sessions.ADMIN={cookie:login.headers.get('set-cookie')!.split(';')[0],csrf:admin.csrfToken};
  const supplier=await data(await call('POST','admin/suppliers',{name:'Audit supplier '+tag,bankAccount:'PL61 1090 1014 0000 0712 1981 2874',email:'billing@example.test',notes:'Synthetic supplier note'}));
  const plain=await data(await call('POST','admin/categories',{name:'Audit plain '+tag}));
  const strict=await data(await call('POST','admin/categories',{name:'Audit strict '+tag,fieldDefinitions:[{key:'inventoryNo',label:'Numer inwentarzowy',type:'text',required:true}]}));
  const product=await data(await call('POST','inventory',{name:'Audit cable '+tag,slug:'audit-'+tag,category:'Kable i przewody',unit:'m'}));
  const employee=await data(await call('POST','employees',{name:'Audit employee '+tag}));

  await t.test('F01: receipts cannot create equipment or move stock without asset.create / inventory.move',async()=>{
   await account('RECEIVER','IT_ADVANCED',['invoice.view','invoice.edit','asset.view','inventory.view']);
   assert.equal((await call('POST','assets',{name:'Direct '+tag,categoryId:plain.id},'RECEIVER')).status,403);
   assert.equal((await call('POST',`inventory/${product.slug}/movements`,{delta:1,requestId:randomUUID()},'RECEIVER')).status,403);
   const stock=async()=>(await data(await call('GET','inventory/'+product.slug))).stock;const before=await stock();
   const stockLine={kind:'inventory',inventoryItemId:product.id,quantity:1,unitPrice:'1.00'},assetLine={kind:'asset',name:'Audit receipt device '+tag,categoryId:plain.id,quantity:1,unitPrice:'10.00',locationId:null};
   for(const [i,line] of [stockLine,assetLine].entries()){
    const number=`AUDIT-LEGACY-${i}-${tag}`;
    assert.equal((await call('POST','deliveries',{invoiceNumber:number,supplierId:supplier.id,date:'2026-10-08',requestId:randomUUID(),items:[line]},'RECEIVER')).status,403);
    assert.equal(await count('SELECT count(*)::int AS count FROM invoices WHERE number=$1',[number]),0,'refused delivery leaves no document');
    const invoiceNumber=`AUDIT-RECEIVE-${i}-${tag}`;
    assert.equal((await call('POST','invoices',{number:invoiceNumber,supplierId:supplier.id,date:'2026-10-08',receive:true,requestId:randomUUID(),items:[line]},'RECEIVER')).status,403);
    assert.equal(await count('SELECT count(*)::int AS count FROM invoices WHERE number=$1',[invoiceNumber]),0,'refused receipt is atomic');
   }
   assert.equal(await stock(),before);
   assert.equal(await count('SELECT count(*)::int AS count FROM assets WHERE name=$1',['Audit receipt device '+tag]),0);
   // A draft document is allowed; completing it still needs the effect-level permission.
   const draft=await data(await call('POST','invoices',{number:'AUDIT-DRAFT-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[assetLine,{...stockLine,unitPrice:'1.00'}]},'RECEIVER'));
   const detail=await data(await call('GET','invoices/'+draft.id));
   assert.equal((await call('POST',`invoices/${draft.id}/items/${detail.items[0].id}/serials`,{serialNumbers:['AUDIT-DRAFT-SN-'+tag],createMissing:true,version:detail.version,requestId:randomUUID()},'RECEIVER')).status,403);
   assert.equal((await call('POST',`invoices/${draft.id}/items/${detail.items[1].id}/receive`,{quantity:1,version:detail.version,requestId:randomUUID()},'RECEIVER')).status,403);
   assert.equal(await count('SELECT count(*)::int AS count FROM assets WHERE invoice_id=$1',[draft.id]),0);assert.equal(await stock(),before);
   // Positive control: the same legacy receipt works with full permissions.
   const accepted=await call('POST','deliveries',{invoiceNumber:'AUDIT-LEGACY-OK-'+tag,supplierId:supplier.id,date:'2026-10-08',requestId:randomUUID(),items:[assetLine,stockLine]});
   assert.equal(accepted.status,201);assert.equal(await stock(),before+1);
   const created=(await query<{status:string}>('SELECT status FROM assets WHERE name=$1',['Audit receipt device '+tag])).rows;
   assert.deepEqual(created.map(row=>row.status),['PREPARATION']);
  });

  await t.test('F05: received equipment cannot be issued until required category fields are filled',async()=>{
   const saved=await data(await call('POST','invoices',{number:'AUDIT-STRICT-'+tag,supplierId:supplier.id,date:'2026-10-08',receive:true,requestId:randomUUID(),items:[{kind:'asset',name:'Audit strict device '+tag,categoryId:strict.id,quantity:1,unitPrice:'5.00',serialNumbers:['AUDIT-SN-'+tag]}]}));
   let asset=(await data(await call('GET','invoices/'+saved.id))).assets[0];
   assert.deepEqual(asset.customFields,{});assert.equal(asset.status,'PREPARATION');
   const refused=await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',owner:'Synthetic recipient',version:asset.version});
   assert.equal(refused.status,400);assert.match((await refused.json()).error,/Przed wydaniem.*Numer inwentarzowy/);
   assert.equal((await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',employeeId:employee.id,version:asset.version})).status,400);
   assert.equal((await call('POST','assets/bulk',{action:'assign',employeeId:employee.id,items:[{assetId:asset.assetId,version:asset.version}],requestId:randomUUID()})).status,400);
   asset=await data(await call('PATCH','assets/'+asset.assetId,{customFields:{inventoryNo:'INV-'+tag},version:asset.version}));
   asset=await data(await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',owner:'Synthetic recipient',version:asset.version}));
   assert.equal(asset.status,'ASSIGNED');
  });

  await t.test('F02: lookups disclose supplier details and device counts only with matching permissions',async()=>{
   await account('EMPTY','VIEWER',[]);await account('ASSETS','VIEWER',['asset.view']);await account('STAFF','VIEWER',['employee.view']);
   const empty=await data(await call('GET','lookups',undefined,'EMPTY'));
   assert.deepEqual(empty.suppliers,[]);assert.deepEqual(empty.employees,[]);
   const assets=await data(await call('GET','lookups',undefined,'ASSETS'));
   const option=assets.suppliers.find((s:any)=>s.id===supplier.id);assert.deepEqual(option,{id:supplier.id,name:supplier.name});
   assert.ok(assets.suppliers.every((s:any)=>Object.keys(s).sort().join()==='id,name'));
   const staff=await data(await call('GET','lookups',undefined,'STAFF'));
   assert.ok(staff.employees.some((e:any)=>e.id===employee.id));assert.ok(staff.employees.every((e:any)=>!('assetCount' in e)));
   assert.ok((await data(await call('GET','employees',undefined,'STAFF'))).every((e:any)=>!('assetCount' in e)));
   assert.ok(!('assetCount' in await data(await call('GET','employees/'+employee.id,undefined,'STAFF'))));
   const full=await data(await call('GET','lookups'));
   assert.equal(full.suppliers.find((s:any)=>s.id===supplier.id).bankAccount,supplier.bankAccount);
   assert.equal(typeof full.employees.find((e:any)=>e.id===employee.id).assetCount,'number');
  });

  await t.test('F03: shortage export requires inventory.view like the inventory screen',async()=>{
   await account('NOSTOCK','IT_ADVANCED',['asset.view']);
   assert.equal((await call('GET','inventory',undefined,'NOSTOCK')).status,403);
   assert.equal((await call('GET','reports/shortages.csv',undefined,'NOSTOCK')).status,403);
   assert.equal((await call('GET','reports/shortages.csv')).status,200);
  });

  await t.test('F04: unknown invitation tokens stop before password hashing and rate-limit rows',async()=>{
   const unknown=randomBytes(32).toString('hex');
   const refused=await call('POST','invite',{token:unknown,password:'Synthetic invite password'},'none');assert.equal(refused.status,410);
   assert.equal(await count('SELECT count(*)::int AS count FROM auth_rate_limits WHERE key=$1',['invite:'+createHash('sha256').update(unknown).digest('hex')]),0);
   const invite=await data(await call('POST','admin/users/invite',{name:'Audit invited '+tag,email:`audit-invited-${tag}@test.invalid`,role:'VIEWER'})),token=new URL(invite.url).searchParams.get('token')!;
   assert.equal((await call('POST','invite',{token,password:'Synthetic invite password'},'none')).status,201);
   assert.equal((await call('POST','invite',{token,password:'Synthetic invite password'},'none')).status,410,'an invitation stays single-use');
  });

  await t.test('F06: a missing amount means the sum of the lines on create and on edit',async()=>{
   const body={number:'AUDIT-TOTAL-'+tag,supplierId:supplier.id,date:'2026-10-08',items:[{kind:'other',name:'Audit service',quantity:3,unitPrice:'2.00'}]};
   let invoice=await data(await call('POST','invoices',body));assert.equal(invoice.amount,'6.00');
   invoice=await data(await call('PATCH','invoices/'+invoice.id,{...body,amount:null,version:invoice.version,items:[{kind:'other',name:'Audit service',quantity:4,unitPrice:'2.50'}]}));
   assert.equal(invoice.amount,'10.00');
   invoice=await data(await call('PATCH','invoices/'+invoice.id,{number:body.number,supplierId:supplier.id,date:'2026-10-09',version:invoice.version}));
   assert.equal(invoice.amount,'10.00','header-only edit keeps the computed total');
   invoice=await data(await call('PATCH','invoices/'+invoice.id,{...body,version:invoice.version,items:[{kind:'other',name:'Audit service',quantity:1,unitPrice:null}]}));
   assert.equal(invoice.amount,null,'an unpriced line keeps the total unknown, not zero');
  });
 }finally{await pool.end();}
});
