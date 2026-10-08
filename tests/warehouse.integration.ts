import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {InventoryPage,InventoryCategory} from '../src/shared/inventory';
import type {PageResult} from '../src/shared/types';
test('Warehouse: bounded catalogue, exact filters, summaries and movement safety',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const target=process.env.TEST_DATABASE_URL!;assert.ok(new URL(target).pathname.endsWith('_test'));assert.notEqual(target,process.env.DATABASE_URL);process.env.DATABASE_URL=target;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const uid=randomUUID().slice(0,8),password='Fictional warehouse test!',sessions:Record<string,{cookie:string;csrf:string}>={};
 async function call(method:'GET'|'POST',path:string,body?:unknown,who='ADMIN'){
  const session=sessions[who],headers:Record<string,string>=session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{};
  if(method==='POST'){headers.origin='http://localhost:3000';headers['content-type']='application/json';}
  return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function data<T=any>(response:Response):Promise<T>{const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return json.data;}
 const base={q:'Warehouse '+uid,overview:'true'};
 const list=(extra:Record<string,string>={},who='ADMIN')=>call('GET','inventory?'+new URLSearchParams({...base,...extra}),undefined,who).then(response=>data<InventoryPage>(response));
 try{
  // Explicitly register synthetic choices through the same administrator flow.
  for(const role of ['ADMIN','VIEWER','IT_USER']){const email='warehouse-'+role.toLowerCase()+'-'+uid+'@example.test';await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Fictional warehouse '+role+' '+uid,email,await hashPassword(password),role]);const response=await call('POST','auth/login',{email,password},'none'),user=await data(response);sessions[role]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};}
  for(const prefix of ['Literal ','Ładowarki ','Movement '])await data(await call('POST','admin/inventory-dictionaries',{kind:'category',name:prefix+uid,label:prefix+uid}));
  const root=await data(await call('POST','admin/locations',{name:'Warehouse site '+uid})),child=await data(await call('POST','admin/locations',{name:'Rack '+uid,parentId:root.id})),other=await data(await call('POST','admin/locations',{name:'Other warehouse '+uid}));
  await query(`INSERT INTO inventory_items(name,sku,product_code,slug,category,unit,stock,minimal_stock,location_id)
   SELECT 'Warehouse '||$1||' HDMI '||lpad(i::text,3,'0'),'W-'||$1||'-'||i,'MODEL-'||$1||'-'||i,'warehouse-'||$1||'-'||i,
   CASE i%3 WHEN 0 THEN 'Cables '||$1 WHEN 1 THEN 'Adapters '||$1 ELSE 'Peripherals '||$1 END,'szt.',
   CASE i%5 WHEN 0 THEN 0 WHEN 1 THEN 3 WHEN 2 THEN 5 WHEN 3 THEN 12 ELSE 40 END,5,
   CASE i%4 WHEN 0 THEN $2::uuid WHEN 1 THEN $3::uuid WHEN 2 THEN $4::uuid ELSE NULL END FROM generate_series(1,120) i`,[uid,root.id,child.id,other.id]);
  await t.test('pagination is bounded and deterministic, with summary for the full filtered scope',async()=>{
   const first=await list({pageSize:'50'}),second=await list({pageSize:'50',page:'2'}),last=await list({pageSize:'50',page:'3'});
   assert.equal(first.total,120);assert.equal(first.items.length,50);assert.equal(second.items.length,50);assert.equal(last.items.length,20);
   assert.equal(new Set([...first.items,...second.items,...last.items].map(item=>item.id)).size,120);
   assert.deepEqual(first.summary,{products:120,low:72,out:24,ok:48});assert.deepEqual(last.summary,first.summary);
   assert.deepEqual((await list({pageSize:'50'})).items.map(item=>item.id),first.items.map(item=>item.id));
   assert.equal((await list({page:'4',pageSize:'50'})).items.length,0);
   const ordinary=await data(await call('GET','inventory?'+new URLSearchParams({q:base.q,pageSize:'10'})));assert.equal(ordinary.items.length,10);assert.ok(!('summary' in ordinary));
  });
  await t.test('stock presets preserve totals outside the selected preset and legacy links still work',async()=>{
   const counts={all:120,low:72,out:24,ok:48,inStock:96};
   for(const [stockState,count] of Object.entries(counts)){const result=await list({stockState,pageSize:'100'});assert.equal(result.total,count);assert.equal(result.summary!.products,120);}
   const low=await data(await call('GET','inventory?'+new URLSearchParams({q:base.q,lowStock:'true',overview:'true'})));assert.equal(low.total,72);
   assert.ok((await list({stockState:'out'})).items.every(item=>item.stock===0));assert.ok((await list({stockState:'ok'})).items.every(item=>item.stock>item.minimalStock));
  });
  await t.test('categories, exact location, descendants and unassigned items combine with search',async()=>{
   assert.equal((await list({category:'Cables '+uid})).total,40);
   assert.equal((await list({locationId:root.id})).total,60);assert.equal((await list({locationId:root.id,includeChildren:'false'})).total,30);
   assert.equal((await list({noLocation:'true'})).total,30);
   const combined=await list({category:'Cables '+uid,locationId:root.id,includeChildren:'false'});assert.equal(combined.total,10);assert.equal(combined.summary!.products,10);
   assert.equal((await list({q:uid+' HDMI Warehouse'})).total,120);assert.equal((await list({q:'MODEL-'+uid+'-120'})).total,1);assert.equal((await list({q:'W-'+uid+'-120'})).total,1);
   assert.equal((await list({q:'Rack '+uid})).total,30);
   const facets=await data<PageResult<InventoryCategory>>(await call('GET','inventory/facets/categories?q='+uid));assert.equal(facets.total,3);assert.deepEqual(facets.items.map(item=>item.count),[40,40,40]);
   assert.equal((await data(await call('GET','inventory/facets/categories?q='+encodeURIComponent('Adapters '+uid)))).items[0].name,'Adapters '+uid);
  });
  await t.test('sort keys are whitelisted and ordering is stable across equal stocks',async()=>{
   const asc=await list({sort:'stock',direction:'asc',pageSize:'100'});assert.ok(asc.items.every((item,index)=>!index||item.stock>=asc.items[index-1].stock));
   const desc=await list({sort:'shortage',pageSize:'100'}),gaps=desc.items.map(item=>Math.max(0,item.minimalStock-item.stock));assert.ok(gaps.every((gap,index)=>!index||gap<=gaps[index-1]));assert.equal(gaps[0],5);
   const first=await list({sort:'stock',direction:'asc',pageSize:'17'}),second=await list({sort:'stock',direction:'asc',pageSize:'17',page:'2'});assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,34);
   for(const sort of ['name','sku','category','minimum','location','updatedAt'])assert.equal((await list({sort})).items.length,25);
  });
  await t.test('invalid filters are rejected and wildcard text remains literal',async()=>{
   const invalid:Record<string,string>[]=[{page:'0'},{pageSize:'101'},{stockState:'bad'},{sort:'stock; DROP TABLE inventory_items'},{direction:'bad'},{includeChildren:'bad'},{noLocation:'bad'},{lowStock:'bad'},{locationId:'bad'},{locationId:root.id,noLocation:'true'},{q:'x'.repeat(201)},{category:'x'.repeat(121)}];
   for(const extra of invalid)assert.equal((await call('GET','inventory?'+new URLSearchParams({...base,...extra}))).status,400);
   assert.equal((await call('GET','inventory/facets/categories?pageSize=101')).status,400);
   const literal=await data(await call('POST','inventory',{name:'Literal '+uid,slug:'literal-'+uid,sku:'50%_SKU_'+uid,category:'Literal '+uid}));
   const found=await list({q:'50%_SKU_'+uid});assert.equal(found.total,1);assert.equal(found.items[0].id,literal.id);
   assert.equal((await list({q:"' OR TRUE --"})).total,0);
   const polish=await data(await call('POST','inventory',{name:'Żółty przewód ładowania '+uid,slug:'polish-'+uid,category:'Ładowarki '+uid}));
   assert.equal((await list({q:uid+' zolty przewod'})).items[0].id,polish.id);
   assert.equal((await data(await call('GET','inventory/facets/categories?q='+encodeURIComponent('ladowarki '+uid)))).items[0].name,'Ładowarki '+uid);
  });
  await t.test('read access remains scoped; quick withdrawal and return are audited and replay-safe',async()=>{
   assert.equal((await call('GET','inventory',undefined,'none')).status,401);assert.equal((await list({},'VIEWER')).total,120);
   const product=await data(await call('POST','inventory',{name:'Movement '+uid,slug:'movement-'+uid,category:'Movement '+uid,minimalStock:5}));
   await data(await call('POST','inventory/'+product.slug+'/correction',{stock:10,expectedStock:0,note:'Fictional counted stock',requestId:randomUUID()}));
   const withdrawal={delta:-3,note:'Fictional quick withdrawal',requestId:randomUUID()};
   assert.equal((await call('POST','inventory/'+product.slug+'/movements',withdrawal,'VIEWER')).status,403);
   assert.equal((await data(await call('POST','inventory/'+product.slug+'/movements',withdrawal,'IT_USER'))).stock,7);
   assert.equal((await data(await call('POST','inventory/'+product.slug+'/movements',withdrawal,'IT_USER'))).stock,7);
   const returned={delta:2,note:'Fictional quick return',requestId:randomUUID()};await data(await call('POST','inventory/'+product.slug+'/movements',returned,'IT_USER'));await data(await call('POST','inventory/'+product.slug+'/movements',returned,'IT_USER'));
   assert.equal((await data(await call('GET','inventory/'+product.slug))).stock,9);
   assert.equal((await data(await call('GET','inventory/'+product.slug+'/history'))).length,3);
   assert.equal((await call('POST','inventory/'+product.slug+'/movements',{delta:-10,requestId:randomUUID()},'IT_USER')).status,409);
   assert.equal((await data(await call('GET','inventory/'+product.slug))).stock,9);
   const role=await data(await call('POST','admin/permissions',{name:'No warehouse '+uid,baseRole:'VIEWER',permissions:[]}));
   const email='warehouse-restricted-'+uid+'@example.test';await query("INSERT INTO users(name,email,password_hash,role,permission_role_id) VALUES($1,$2,$3,'VIEWER',$4)",['Restricted fictional warehouse',email,await hashPassword(password),role.id]);
   const response=await call('POST','auth/login',{email,password},'none'),user=await data(response);sessions.RESTRICTED={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken};
   assert.equal((await call('GET','inventory?overview=true',undefined,'RESTRICTED')).status,403);assert.equal((await call('GET','inventory/facets/categories',undefined,'RESTRICTED')).status,403);
  });
 }finally{await pool.end();}
});
