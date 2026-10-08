import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {categoryAssetBody} from '../src/shared/asset-fields';

const testUrl = process.env.TEST_DATABASE_URL;
test('PostgreSQL/API: permissions, delivery, atomic stock, idempotency and audit', {skip: !testUrl}, async t => {
  // This suite refuses the operational database and writes only to an explicitly named test DB.
  const parsed = new URL(testUrl!);
  assert.match(parsed.pathname, /test/i, 'TEST_DATABASE_URL must point to a database containing test in its name');
  assert.notEqual(testUrl, process.env.DATABASE_URL, 'Use a separate test database');
  process.env.DATABASE_URL = testUrl;
  process.env.APP_URL = 'http://localhost:3000';
  Object.assign(process.env, { NODE_ENV: 'test' });
  const {NextRequest} = await import('next/server');
  const route = await import('../src/app/api/[...path]/route');
  const {pool,query} = await import('../src/server/db');
  const {hashPassword} = await import('../src/server/passwords');
  const uid = randomUUID().slice(0,8);
  const password = 'Isolated integration test only!';
  type Session = {cookie:string;csrf:string;id:string};
  async function call(method:'GET'|'POST'|'PATCH'|'DELETE', path:string, body?:unknown, session?:Session, origin='http://localhost:3000', csrf=true) {
    const headers: Record<string,string> = {};
    if(session) { headers.cookie=session.cookie; if(csrf) headers['x-csrf-token']=session.csrf; }
    if(method!=='GET') {headers.origin=origin;headers['content-type']='application/json';}
    const req = new NextRequest(`http://localhost:3000/api/${path}`, {method,headers, ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return route[method](req,{params:Promise.resolve({path:path.split('?')[0].split('/')})});
  }
  async function json(response:Response) {return await response.json() as {data:any;error?:string};}
  const sessions: Record<string,Session> = {};
  try {
    for(const role of ['ADMIN','VIEWER','IT_USER','IT_ADVANCED']) {
      const email=`${role.toLowerCase()}-${uid}@test.invalid`;
      await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)', [`Test ${role} ${uid}`,email,await hashPassword(password),role]);
      const response = await call('POST','auth/login',{email,password});
      assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
      const body=await json(response);
      sessions[role]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:body.data.csrfToken,id:body.data.id};
    }
    const admin=sessions.ADMIN, operator=sessions.IT_USER, viewer=sessions.VIEWER;
    await t.test('authentication, CSRF, same-origin and server RBAC',async()=>{
      assert.equal((await call('GET','assets')).status,401);
      assert.equal((await call('POST','inventory',{},viewer)).status,403);
      assert.equal((await call('POST','assets',{},operator)).status,403);
      assert.equal((await call('POST','inventory',{},admin,'https://attacker.invalid')).status,403);
      assert.equal((await call('POST','inventory',{},admin,'http://localhost:3000',false)).status,403);
      assert.equal((await call('POST','setup',{token:'wrong',name:'bad',email:'bad',password:'bad'})).status,400);
      const token=admin.cookie.split('=')[1];
      assert.equal((await query('SELECT 1 FROM sessions WHERE token_hash=$1',[token])).rowCount,0);
    });
    const lookup=(await json(await call('GET','lookups',undefined,admin))).data;
    const categoryId=lookup.categories[0].id;
    const supplier=(await json(await call('POST','admin/suppliers',{name:`Test supplier ${uid}`},admin))).data;
    const location=(await json(await call('POST','admin/locations',{name:`Test site ${uid}`,kind:'SITE'},admin))).data;
    await query("INSERT INTO inventory_dictionary_entries(kind,name,label) VALUES('category','Test','Test') ON CONFLICT(kind,name) DO NOTHING");
    const itemResponse=await call('POST','inventory',{name:`Test HDMI ${uid}`,sku:`TEST-${uid}`,slug:`test-hdmi-${uid}`,category:'Test',minimalStock:10,locationId:location.id},admin);
    assert.equal(itemResponse.status,201,JSON.stringify(await itemResponse.clone().json()));
    const item=(await json(itemResponse)).data;
    const deliveryBody={invoiceNumber:`TEST-FV-${uid}`,supplierId:supplier.id,date:'2026-10-06',requestId:randomUUID(),items:[{kind:'inventory',inventoryItemId:item.id,quantity:1,unitPrice:'10.20'},{kind:'asset',name:`Test scanner ${uid}`,categoryId,quantity:2,unitPrice:'999.99',serialNumbers:[`TEST-SN-${uid}-1`,`TEST-SN-${uid}-2`],locationId:location.id}]};
    let delivery:any;
    await t.test('delivery creates invoice, physical assets and ledger atomically',async()=>{
      const response=await call('POST','deliveries',deliveryBody,admin);
      assert.equal(response.status,201,JSON.stringify(await response.clone().json())); delivery=(await json(response)).data;
      const invoice=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,admin))).data;
      assert.equal(invoice.items.length,2);assert.equal(invoice.assets.length,2);assert.equal(Number(invoice.amount),2010.18);
      assert.ok(invoice.assets.every((a:any)=>/^ITHW-\d{8}$/.test(a.assetId)));
      const stock=(await json(await call('GET',`inventory/${item.slug}`,undefined,admin))).data;
      assert.equal(stock.stock,1);
      const history=(await json(await call('GET',`inventory/${item.slug}/history`,undefined,admin))).data;
      assert.equal(history[0].delta,1);assert.equal(history[0].invoiceNumber,deliveryBody.invoiceNumber);
      const repeat=(await json(await call('POST','deliveries',deliveryBody,admin))).data;
      assert.equal(repeat.id,delivery.id);
      assert.equal((await call('POST','deliveries',{...deliveryBody,invoiceNumber:`CHANGED-${uid}`},admin)).status,409);
    });
    await t.test('admin dictionaries: edit, delete, reference protection, CSRF, RBAC and audit',async()=>{
      for(const kind of ['categories','suppliers']) {
        const original=`Synthetic ${kind} ${uid}`;
        const createdResponse=await call('POST',`admin/${kind}`,{name:original},admin);
        assert.equal(createdResponse.status,201);
        const entry=(await json(createdResponse)).data;
        const path=`admin/${kind}/${entry.id}`;
        for(const role of ['VIEWER','IT_USER','IT_ADVANCED']) {
          assert.equal((await call('PATCH',path,{name:'Unauthorized'},sessions[role])).status,403);
          assert.equal((await call('DELETE',path,undefined,sessions[role])).status,403);
        }
        assert.equal((await call('DELETE',path,undefined,admin,'http://localhost:3000',false)).status,403);
        assert.equal((await call('DELETE',path,undefined,admin,'https://attacker.invalid')).status,403);
        assert.equal((await call('PATCH',path,{name:' '},admin)).status,400);
        const duplicate=(await json(await call('POST',`admin/${kind}`,{name:`Duplicate ${kind} ${uid}`},admin))).data;
        assert.equal((await call('PATCH',path,{name:duplicate.name.toUpperCase()},admin)).status,409);
        const name=`Renamed ${original}`;
        const edited=await call('PATCH',path,{name},admin);
        assert.equal(edited.status,200);assert.equal((await json(edited)).data.name,name);
        const lookups=(await json(await call('GET','lookups',undefined,admin))).data;
        assert.equal(lookups[kind].find((row:any)=>row.id===entry.id).name,name);
        assert.equal((await call('DELETE',path,undefined,admin)).status,200);
        assert.equal((await call('DELETE',path,undefined,admin)).status,404);
        assert.equal((await call('PATCH',path,{name:'Missing'},admin)).status,404);
        assert.equal((await call('DELETE',`admin/${kind}/${duplicate.id}`,undefined,admin)).status,200);
        const action=kind==='categories'?'DELETE_CATEGORY':'DELETE_SUPPLIER';
        const log=await query('SELECT before_data,after_data FROM audit_logs WHERE entity_id=$1 AND action=$2',[entry.id,action]);
        assert.equal(log.rows[0].before_data.name,name);assert.equal(log.rows[0].after_data,null);
      }
      const protectedSupplier=await call('DELETE',`admin/suppliers/${supplier.id}`,undefined,admin);
      assert.equal(protectedSupplier.status,409);assert.match((await json(protectedSupplier)).error!,/faktur/);
      assert.equal((await call('DELETE',`admin/categories/${categoryId}`,undefined,admin)).status,409);
      assert.equal((await call('PATCH',`admin/suppliers/${supplier.id}`,{name:`Updated used supplier ${uid}`},admin)).status,200);
      const invoice=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,admin))).data;
      assert.equal(invoice.supplierName,`Updated used supplier ${uid}`);
    });
    await t.test('admin locations: free hierarchy, cycle protection and atomic deletion of labels',async()=>{
      const create=async(name:string,kind:string,parentId?:string)=>{
        const response=await call('POST','admin/locations',{name:`${name} ${uid}`,kind,parentId},admin);
        assert.equal(response.status,201);return (await json(response)).data;
      };
      const site=await create('Synthetic root','SITE');
      const other=await create('Synthetic destination','SITE');
      const room=await create('Synthetic room','ROOM',site.id);
      const bin=await create('Synthetic bin','BIN',room.id);
      const path=`admin/locations/${room.id}`;
      const edit={name:`Updated room ${uid}`,kind:'ROOM',parentId:other.id};
      assert.equal((await call('PATCH',path,edit,viewer)).status,403);
      assert.equal((await call('DELETE',path,undefined,viewer)).status,403);
      assert.equal((await call('PATCH',path,{...edit,parentId:room.id},admin)).status,400);
      assert.equal((await call('PATCH',path,{...edit,parentId:bin.id},admin)).status,400);
      assert.equal((await call('PATCH',path,{...edit,kind:'BIN'},admin)).status,200);
      assert.equal((await call('PATCH',path,{...edit,parentId:null},admin)).status,200);
      assert.equal((await call('PATCH',path,{...edit,parentId:randomUUID()},admin)).status,400);
      const updated=await call('PATCH',path,edit,admin);assert.equal(updated.status,200);
      assert.equal((await json(updated)).data.path,`${other.name} / ${edit.name}`);
      const lookups=(await json(await call('GET','lookups',undefined,admin))).data;
      assert.equal(lookups.locations.find((row:any)=>row.id===bin.id).path,`${other.name} / ${edit.name} / ${bin.name}`);
      assert.equal((await call('DELETE',path,undefined,admin)).status,409);
      assert.equal((await query('SELECT 1 FROM qr_codes WHERE location_id=$1',[room.id])).rowCount,1,'Failed deletion restores the label');
      assert.equal((await call('DELETE',`admin/locations/${bin.id}`,undefined,admin)).status,200);
      assert.equal((await query('SELECT 1 FROM qr_codes WHERE location_id=$1',[bin.id])).rowCount,0);
      for(const id of [room.id,site.id,other.id]) assert.equal((await call('DELETE',`admin/locations/${id}`,undefined,admin)).status,200);
      assert.equal((await call('DELETE',path,undefined,admin)).status,404);
      assert.equal((await call('DELETE',`admin/locations/${location.id}`,undefined,admin)).status,409,'Used location cannot be deleted');
      const rename=await call('PATCH',`admin/locations/${location.id}`,{name:`Renamed site ${uid}`,kind:'SITE',parentId:null},admin);
      assert.equal(rename.status,200);
      const inventory=(await json(await call('GET',`inventory/${item.slug}`,undefined,admin))).data;
      assert.equal(inventory.locationName,`Renamed site ${uid}`);
      const rootA=await create('Concurrent A','SITE'),rootB=await create('Concurrent B','SITE');
      const races=await Promise.all([
        call('PATCH',`admin/locations/${rootA.id}`,{name:rootA.name,kind:'ROOM',parentId:rootB.id},admin),
        call('PATCH',`admin/locations/${rootB.id}`,{name:rootB.name,kind:'ROOM',parentId:rootA.id},admin),
      ]);
      assert.deepEqual(races.map(response=>response.status).sort(),[200,400]);
      const moved=races[0].status===200?rootA:rootB,root=races[0].status===200?rootB:rootA;
      for(const id of [moved.id,root.id]) assert.equal((await call('DELETE',`admin/locations/${id}`,undefined,admin)).status,200);
    });
    await t.test('admin users: profile and password editing, deletion and history protection',async()=>{
      const created=await call('POST','admin/users',{name:`Synthetic user ${uid}`,email:`unused-${uid}@test.invalid`,password,role:'VIEWER'},admin);
      assert.equal(created.status,201);const account=(await json(created)).data;
      const path=`admin/users/${account.id}`;
      assert.equal((await call('PATCH',path,{name:'Unauthorized'},viewer)).status,403);
      assert.equal((await call('DELETE',path,undefined,viewer)).status,403);
      assert.equal((await call('PATCH',path,{email:'invalid'},admin)).status,400);
      assert.equal((await call('PATCH',path,{password:'short'},admin)).status,400);
      assert.equal((await call('PATCH',path,{email:`admin-${uid}@test.invalid`},admin)).status,409);
      const updated=await call('PATCH',path,{name:`Edited user ${uid}`,email:`edited-${uid}@test.invalid`,role:'IT_USER'},admin);
      assert.equal(updated.status,200);assert.equal((await json(updated)).data.name,`Edited user ${uid}`);
      assert.equal((await call('DELETE',path,undefined,admin)).status,200);
      assert.equal((await call('DELETE',path,undefined,admin)).status,404);
      assert.equal((await call('DELETE',`admin/users/${admin.id}`,undefined,admin)).status,409);
      assert.equal((await call('PATCH',`admin/users/${admin.id}`,{role:'VIEWER'},admin)).status,409);
      assert.equal((await call('PATCH',`admin/users/${admin.id}`,{name:`Renamed test admin ${uid}`},admin)).status,200);
      assert.equal((await call('GET','auth/me',undefined,admin)).status,200,'Name correction preserves own session');
      const resetPassword='Changed isolated test password!';
      const reset=await call('PATCH',`admin/users/${operator.id}`,{password:resetPassword},admin);
      assert.equal(reset.status,200);const resetData=(await json(reset)).data;assert.equal(resetData.mustChangePassword,true);assert.equal(resetData.password_hash,undefined);assert.ok(!JSON.stringify(resetData).includes(resetPassword));
      assert.equal((await call('GET','auth/me',undefined,operator)).status,401,'Password reset revokes sessions');
      assert.equal((await call('POST','auth/login',{email:`it_user-${uid}@test.invalid`,password})).status,401);
      const login=await call('POST','auth/login',{email:`it_user-${uid}@test.invalid`,password:resetPassword});
      assert.equal(login.status,200);const loggedIn=(await json(login)).data;
      Object.assign(operator,{cookie:login.headers.get('set-cookie')!.split(';')[0],csrf:loggedIn.csrfToken});
      assert.equal((await call('GET','inventory',undefined,operator)).status,403);
      assert.equal((await call('POST','auth/change-password',{currentPassword:resetPassword,newPassword:password,confirmation:password},operator)).status,200);
      const ready=await call('POST','auth/login',{email:`it_user-${uid}@test.invalid`,password});assert.equal(ready.status,200);const readyBody=(await json(ready)).data;assert.equal(readyBody.mustChangePassword,false);
      Object.assign(operator,{cookie:ready.headers.get('set-cookie')!.split(';')[0],csrf:readyBody.csrfToken});
      assert.equal((await call('DELETE',`admin/users/${operator.id}`,undefined,admin)).status,409,'History prevents deletion');
      const logs=await query('SELECT before_data,after_data FROM audit_logs WHERE entity_id=$1 AND action=$2',[operator.id,'UPDATE_USER']);
      assert.ok(logs.rows.every(row=>!JSON.stringify(row).includes(password)&&!JSON.stringify(row).includes(resetPassword)&&!JSON.stringify(row).includes('scrypt:')&&[row.before_data,row.after_data].every(data=>data?.password===undefined&&data?.password_hash===undefined)),'Audit stores change metadata without passwords or hashes');
    });
    await t.test('new inventory editing and counted-stock correction preserve labels and serialize changes',async()=>{
      const product=(await json(await call('POST','inventory',{name:`Synthetic correction ${uid}`,sku:`COR-${uid}`,slug:`correction-${uid}`,category:'Test',minimalStock:5},admin))).data;
      const path=`inventory/${product.slug}`;
      assert.equal((await call('PATCH',path,{name:'Denied',version:product.version},operator)).status,403);
      const edited=await call('PATCH',path,{name:`Edited correction ${uid}`,minimalStock:7,version:product.version},admin);
      assert.equal(edited.status,200);const changed=(await json(edited)).data;
      assert.equal(changed.unit,'szt.');assert.equal(changed.slug,product.slug);assert.equal(changed.stock,0);assert.equal(changed.version,product.version+1);
      assert.equal((await call('PATCH',path,{name:'Stale',version:product.version},admin)).status,409);
      assert.equal((await call('PATCH',path,{slug:'different',version:changed.version},admin)).status,400);
      const count={stock:12,expectedStock:0,note:'Synthetic physical count',requestId:randomUUID()};
      assert.equal((await call('POST',`${path}/correction`,count,operator)).status,403);
      assert.equal((await call('POST',`${path}/correction`,{...count,note:''},admin)).status,400);
      const results=await Promise.all(Array.from({length:4},()=>call('POST',`${path}/correction`,count,admin)));
      assert.ok(results.every(r=>r.status===200));assert.equal((await json(results[0])).data.stock,12);
      const ledger=(await json(await call('GET',`${path}/history`,undefined,admin))).data;
      assert.equal(ledger.length,1);assert.equal(ledger[0].action,'ADJUSTMENT');assert.equal(ledger[0].delta,12);
      assert.equal((await call('PATCH',path,{notes:'Old edit',version:changed.version},admin)).status,409,'Stock movements increment the edit version');
      const races=await Promise.all([
        call('POST',`${path}/correction`,{stock:10,expectedStock:12,note:'Synthetic first count',requestId:randomUUID()},admin),
        call('POST',`${path}/correction`,{stock:8,expectedStock:12,note:'Synthetic second count',requestId:randomUUID()},admin),
      ]);
      assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
      const current=(await json(await call('GET',path,undefined,admin))).data;
      const zero=await call('POST',`${path}/correction`,{stock:0,expectedStock:current.stock,note:'Synthetic empty container',requestId:randomUUID()},admin);
      assert.equal(zero.status,200);assert.equal((await json(zero)).data.stock,0);
      assert.equal((await query('SELECT 1 FROM qr_codes WHERE inventory_item_id=$1',[product.id])).rowCount,1);
      const shortages=await call('GET','reports/shortages.csv',undefined,admin);assert.equal(shortages.status,200);
      assert.ok((await shortages.text()).includes(product.sku));
      assert.equal((await call('GET','reports/shortages.csv',undefined,viewer)).status,403);
    });
    await t.test('new quick asset actions: issue, return, move, RFID, notes and stale-version protection',async()=>{
      const created=await call('POST','assets',{name:`Synthetic actions ${uid}`,categoryId,status:'AVAILABLE',serialNumber:`ACTION-SN-${uid}`},admin);
      assert.equal(created.status,201);let asset=(await json(created)).data;
      const path=`assets/${asset.assetId}/actions`;
      assert.equal((await call('POST',path,{action:'assign',owner:'Denied',version:asset.version},viewer)).status,403);
      assert.equal((await call('POST',path,{action:'rfid',rfidTag:'Denied',version:asset.version},operator)).status,403);
      assert.equal((await call('POST',path,{action:'status',status:'ASSIGNED',version:asset.version},admin)).status,400);
      let response=await call('POST',path,{action:'assign',owner:'Synthetic Jarek',version:asset.version},operator);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.status,'ASSIGNED');assert.ok(asset.issuedAt);
      assert.equal((await call('POST',path,{action:'assign',owner:'synthetic jarek',version:asset.version},operator)).status,400);
      response=await call('POST',path,{action:'assign',owner:'Synthetic Bartek',version:asset.version,note:'Synthetic handover'},operator);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.owner,'Synthetic Bartek');
      const transfer=(await json(await call('GET',`assets/${asset.assetId}/history`,undefined,viewer))).data[0];
      assert.equal(transfer.action,'TRANSFER_ASSET');assert.match(transfer.description,/Synthetic Jarek → Synthetic Bartek/);
      assert.equal(transfer.before.owner,'Synthetic Jarek');assert.equal(transfer.after.owner,'Synthetic Bartek');assert.ok(transfer.actorName);assert.ok(transfer.createdAt);
      assert.equal((await call('POST',path,{action:'return',status:'AVAILABLE',version:asset.version-1},admin)).status,409);
      response=await call('POST',path,{action:'return',status:'REPAIR',locationId:location.id,version:asset.version,note:'Synthetic return'},operator);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.owner,null);assert.equal(asset.issuedAt,null);
      assert.equal((await call('POST',path,{action:'assign',owner:'Unintended',version:asset.version},admin)).status,409);
      response=await call('POST',path,{action:'status',status:'AVAILABLE',version:asset.version},admin);
      assert.equal(response.status,200);asset=(await json(response)).data;
      response=await call('POST',path,{action:'rfid',rfidTag:`EPC:${uid}`,version:asset.version},admin);
      assert.equal(response.status,200);asset=(await json(response)).data;
      for(const code of [asset.assetId,asset.serialNumber,asset.rfidTag]) {
        const resolved=await call('GET',`scan/resolve?code=${encodeURIComponent(code)}`,undefined,viewer);
        assert.equal(resolved.status,200);assert.equal((await json(resolved)).data.href,`/asset/${asset.assetId}`);
      }
      const oldNotes=asset.notes;
      response=await call('POST',path,{action:'note',note:'Synthetic inspection complete',version:asset.version},admin);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.notes,oldNotes);
      const history=(await json(await call('GET',`assets/${asset.assetId}/history`,undefined,admin))).data;
      assert.ok(history.some((row:any)=>row.action==='ASSET_NOTE'&&row.description==='Synthetic inspection complete'));
      const other=(await json(await call('POST','admin/locations',{name:`Action location ${uid}`,kind:'SITE'},admin))).data;
      response=await call('POST',path,{action:'move',locationId:other.id,version:asset.version},admin);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.locationId,other.id);
      response=await call('POST',path,{action:'rfid',rfidTag:null,version:asset.version},admin);
      assert.equal(response.status,200);asset=(await json(response)).data;assert.equal(asset.rfidTag,null);
      assert.equal((await call('GET',`scan/resolve?code=${encodeURIComponent(`EPC:${uid}`)}`,undefined,viewer)).status,404);
      const ambiguous=await call('POST','inventory',{name:'Synthetic ambiguous',sku:asset.serialNumber,slug:`ambiguous-${uid}`,category:'Test'},admin);
      assert.equal(ambiguous.status,201);
      assert.equal((await call('GET',`scan/resolve?code=${asset.serialNumber}`,undefined,viewer)).status,409);
      assert.equal((await call('GET','scan/resolve?code=https%3A%2F%2Fattacker.invalid',undefined,viewer)).status,404);
    });
    await t.test('new reports, hierarchical filters and filtered CSV preserve currency and escape formulas',async()=>{
      const child=(await json(await call('POST','admin/locations',{name:`Report child ${uid}`,kind:'ROOM',parentId:location.id},admin))).data;
      const ownCategory=(await json(await call('POST','admin/categories',{name:`Report category ${uid}`},admin))).data;
      const asset=(await json(await call('POST','assets',{name:`=Synthetic formula ${uid}`,categoryId:ownCategory.id,locationId:child.id,isFixedAsset:true,fixedAssetNumber:`ST-REPORT-${uid}`,purchasePrice:'100.25',status:'AVAILABLE'},admin))).data;
      const direct=(await json(await call('GET',`assets?locationId=${location.id}&categoryId=${ownCategory.id}`,undefined,admin))).data;
      assert.equal(direct.total,0);
      const tree=(await json(await call('GET',`assets?locationId=${location.id}&includeChildren=true&categoryId=${ownCategory.id}&fixed=true`,undefined,admin))).data;
      assert.equal(tree.total,1);assert.equal(tree.items[0].assetId,asset.assetId);
      const exported=await call('GET',`assets/export?locationId=${location.id}&includeChildren=true&categoryId=${ownCategory.id}&pageSize=1`,undefined,admin);
      assert.equal(exported.status,200);const content=await exported.text();assert.ok(content.includes(`"'=Synthetic formula ${uid}"`));assert.ok(content.includes(asset.assetId));assert.ok(!content.includes(`Test scanner ${uid}`));
      assert.equal((await call('GET','assets/export',undefined,viewer)).status,403);
      assert.equal((await call('GET','assets?sort=sql-injection',undefined,admin)).status,400);
      assert.equal((await call('GET','assets?sort=constructor',undefined,admin)).status,400);
      const before=(await json(await call('GET','reports',undefined,viewer))).data;
      const usdBefore=before.values.find((row:any)=>row.currency==='USD');
      const usd=await call('POST','deliveries',{invoiceNumber:`USD-REPORT-${uid}`,supplierId:supplier.id,date:'2026-10-06',currency:'USD',requestId:randomUUID(),items:[{kind:'asset',name:'Synthetic USD asset',categoryId:ownCategory.id,quantity:1,unitPrice:'10.25'}]},admin);
      assert.equal(usd.status,201);
      const after=(await json(await call('GET','reports',undefined,viewer))).data;
      assert.equal(after.totalAssets,before.totalAssets+1);
      assert.equal(Number(after.values.find((row:any)=>row.currency==='USD').total),Number(usdBefore?.total??0)+10.25);
      assert.equal(after.values.find((row:any)=>row.currency==='PLN').total,before.values.find((row:any)=>row.currency==='PLN').total);
      assert.equal(after.byCategory.find((row:any)=>row.id===ownCategory.id).count,2);
      assert.equal(after.byLocation.find((row:any)=>row.id===child.id).count,1);
      const lookup=(await json(await call('GET',`search?q=${encodeURIComponent(child.name)}`,undefined,admin))).data;
      assert.ok(lookup.some((row:any)=>row.type==='location'&&row.id===child.id));
      const resolved=await call('GET',`scan/resolve?code=${asset.fixedAssetNumber}`,undefined,admin);
      assert.equal((await json(resolved)).data.href,`/asset/${asset.assetId}`);
    });
    await t.test('two concurrent withdrawals cannot oversell stock',async()=>{
      const results=await Promise.all([call('POST',`inventory/${item.slug}/movements`,{delta:-1,requestId:randomUUID()},operator),call('POST',`inventory/${item.slug}/movements`,{delta:-1,requestId:randomUUID()},operator)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const after=(await json(await call('GET',`inventory/${item.slug}`,undefined,admin))).data;
      assert.equal(after.stock,0);
      const history=(await json(await call('GET',`inventory/${item.slug}/history`,undefined,admin))).data;
      assert.equal(history.length,2);
    });
    await t.test('concurrent replay increases stock once and is scoped to actor and payload',async()=>{
      const body={delta:1,requestId:randomUUID()};
      const results=await Promise.all(Array.from({length:6},()=>call('POST',`inventory/${item.slug}/movements`,body,operator)));
      assert.ok(results.every(r=>r.status===200));
      const after=(await json(await call('GET',`inventory/${item.slug}`,undefined,admin))).data;
      assert.equal(after.stock,1);
      assert.equal((await call('POST',`inventory/${item.slug}/movements`,body,admin)).status,409);
      assert.equal((await call('POST',`inventory/${item.slug}/movements`,{...body,delta:2},operator)).status,409);
      assert.equal((await call('POST',`inventory/${item.slug}/movements`,{delta:0,requestId:randomUUID()},operator)).status,400);
    });
    await t.test('failed delivery rolls back invoice and stock',async()=>{
      const invalid={...deliveryBody,requestId:randomUUID(),invoiceNumber:`ROLLBACK-${uid}`,items:[{kind:'inventory',inventoryItemId:item.id,quantity:20,unitPrice:'0.10'},{kind:'asset',name:'Duplicate serial',categoryId,quantity:1,unitPrice:'1.00',serialNumbers:[`TEST-SN-${uid}-1`]}]};
      const response=await call('POST','deliveries',invalid,admin); assert.equal(response.status,409);
      assert.equal((await query('SELECT 1 FROM invoices WHERE number=$1',[invalid.invoiceNumber])).rowCount,0);
      const stock=(await json(await call('GET',`inventory/${item.slug}`,undefined,admin))).data; assert.equal(stock.stock,1);
    });
    await t.test('asset version prevents overwriting changes and history is immutable',async()=>{
      const invoice=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,admin))).data;
      const asset=invoice.assets[0];
      const edit={name:`Renamed test ${uid}`,version:asset.version};
      assert.equal((await call('PATCH',`assets/${asset.assetId}`,edit,admin)).status,200);
      assert.equal((await call('PATCH',`assets/${asset.assetId}`,edit,admin)).status,409);
      const hist=(await json(await call('GET',`assets/${asset.assetId}/history`,undefined,admin))).data;
      assert.ok(hist.length>=2);
      await assert.rejects(query('DELETE FROM audit_logs WHERE actor_id=$1',[admin.id]),(error:any)=>error.code==='42501');
      await assert.rejects(query('UPDATE inventory_transactions SET description=$1 WHERE inventory_item_id=$2',['tampered',item.id]),(error:any)=>error.code==='42501');
    });
    await t.test('partial asset edit preserves status, fixed asset flag and custom fields',async()=>{
      const created=await call('POST','assets',{name:`Assigned test ${uid}`,categoryId,status:'ASSIGNED',owner:'Test employee',isFixedAsset:true,fixedAssetNumber:`TEST-FA-${uid}`,customFields:{cpu:'test cpu'}},admin);
      assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
      const asset=(await json(created)).data;
      const response=await call('PATCH',`assets/${asset.assetId}`,{name:`Updated test ${uid}`,version:asset.version},admin);
      assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
      const edited=(await json(response)).data;
      assert.equal(edited.status,'ASSIGNED');assert.equal(edited.isFixedAsset,true);assert.deepEqual(edited.customFields,{cpu:'test cpu'});
    });
    await t.test('opening import: permissions, individual fixed assets, duplicate preview and concurrent replay',async()=>{
      const payload={sourceHash:createHash('sha256').update(`synthetic-assets-${uid}`).digest('hex'),sheet:'Synthetic only',mode:'assets',categoryId,category:'Test',locationId:location.id,fixedAssets:true,rows:[{row:2,name:`Synthetic laptop ${uid}`,quantity:1,serialNumber:`IMP-SN-${uid}`},{row:3,name:`Synthetic monitor ${uid}`,quantity:2}]};
      assert.equal((await call('POST','imports/preview',payload,viewer)).status,403);
      assert.equal((await call('POST','imports/preview',payload,operator)).status,403);
      assert.equal((await call('POST','imports/preview',payload,admin,'http://localhost:3000',false)).status,403);
      const checked=await call('POST','imports/preview',payload,admin);assert.equal(checked.status,200);const preview=(await json(checked)).data;
      assert.equal(preview.newUnits,3);assert.equal(preview.errors,0);
      const body={payload,requestId:randomUUID(),previewToken:preview.token};
      const results=await Promise.all(Array.from({length:3},()=>call('POST','imports/commit',body,admin)));
      assert.ok(results.every(r=>r.status===201));const saved=(await json(results[0])).data;
      for(const response of results.slice(1))assert.equal((await json(response)).data.batchId,saved.batchId);
      const records=await query('SELECT asset_id,fixed_asset_number,custom_fields FROM assets WHERE custom_fields->>\'importBatch\'=$1',[saved.batchId]);
      assert.equal(records.rowCount,3);assert.ok(records.rows.every(r=>/^ITHW-\d{8}$/.test(r.asset_id)&&/^ST-\d{8}$/.test(r.fixed_asset_number)&&r.custom_fields.importVerification==='UNVERIFIED'));
      assert.equal((await query('SELECT count(*)::int AS n FROM qr_codes WHERE asset_id IN (SELECT id FROM assets WHERE custom_fields->>\'importBatch\'=$1)',[saved.batchId])).rows[0].n,3);
      const repeated=(await json(await call('POST','imports/preview',payload,admin))).data;assert.equal(repeated.duplicates,2);assert.equal(repeated.newRows,0);
      const another=(await json(await call('POST','imports/preview',{...payload,sourceHash:'a'.repeat(64),rows:[payload.rows[0]]},admin))).data;assert.equal(another.duplicates,1);
      assert.equal((await call('POST','imports/commit',{...body,payload:{...payload,category:'Changed'}},admin)).status,409);
      assert.equal((await query('SELECT 1 FROM inventory_scans WHERE started_by=$1',[admin.id])).rowCount,0);
    });
    await t.test('opening stock import preserves existing stock, records provenance and a separate opening ledger',async()=>{
      const payload={sourceHash:createHash('sha256').update(`synthetic-stock-${uid}`).digest('hex'),sheet:'CSV',mode:'inventory',category:'Test',fixedAssets:false,rows:[{row:2,name:`Synthetic cables ${uid}`,sku:`IMP-STOCK-${uid}`,quantity:8},{row:3,name:'Existing stock',sku:item.sku,quantity:999}]};
      const preview=(await json(await call('POST','imports/preview',payload,admin))).data;assert.equal(preview.newRows,1);assert.equal(preview.duplicates,1);
      const before=await query('SELECT stock FROM inventory_items WHERE id=$1',[item.id]);
      const response=await call('POST','imports/commit',{payload,requestId:randomUUID(),previewToken:preview.token},admin);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
      const stock=await query('SELECT id,stock::float8 AS stock FROM inventory_items WHERE sku=$1',[payload.rows[0].sku]);assert.equal(stock.rows[0].stock,8);
      assert.equal((await query('SELECT stock FROM inventory_items WHERE id=$1',[item.id])).rows[0].stock,before.rows[0].stock);
      const ledger=await query('SELECT action,delta::float8 AS delta,invoice_id FROM inventory_transactions WHERE inventory_item_id=$1',[stock.rows[0].id]);assert.equal(ledger.rows[0].action,'OPENING_BALANCE');assert.equal(ledger.rows[0].delta,8);assert.equal(ledger.rows[0].invoice_id,null);
    });
    await t.test('import validation and stale preview prevent unintended writes',async()=>{
      const base={sourceHash:createHash('sha256').update(`synthetic-invalid-${uid}`).digest('hex'),sheet:'CSV',mode:'assets',categoryId,category:'Test',fixedAssets:false};
      const bad={...base,rows:[{row:2,name:'Same serial 1',quantity:1,serialNumber:'duplicate'},{row:3,name:'Same serial 2',quantity:1,serialNumber:'DUPLICATE'}]};
      const preview=(await json(await call('POST','imports/preview',bad,admin))).data;assert.equal(preview.errors,2);
      assert.equal((await call('POST','imports/commit',{payload:bad,requestId:randomUUID(),previewToken:preview.token},admin)).status,400);
      const good={...base,rows:[{row:2,name:'Synthetic race',quantity:1,serialNumber:`IMP-RACE-${uid}`}]};
      const checked=(await json(await call('POST','imports/preview',good,admin))).data;
      assert.equal((await call('POST','assets',{name:'Synthetic concurrent addition',categoryId,serialNumber:good.rows[0].serialNumber},admin)).status,201);
      assert.equal((await call('POST','imports/commit',{payload:good,requestId:randomUUID(),previewToken:checked.token},admin)).status,409);
      assert.equal((await query('SELECT 1 FROM inventory_import_batches WHERE source_hash=$1',[base.sourceHash])).rowCount,0);
    });
    await t.test('late database failure rolls back the entire import batch and opening balances',async()=>{
      const sourceHash=createHash('sha256').update(`synthetic-rollback-${uid}`).digest('hex');
      const key=createHash('sha256').update(JSON.stringify([sourceHash,'CSV',3])).digest('hex').slice(0,24);
      await call('POST','inventory',{name:'Synthetic slug collision',sku:`COLLISION-${uid}`,slug:`import-${key}`,category:'Test'},admin);
      const payload={sourceHash,sheet:'CSV',mode:'inventory',category:'Test',fixedAssets:false,rows:[{row:2,name:'Synthetic first',sku:`ROLL-FIRST-${uid}`,quantity:4},{row:3,name:'Synthetic second',sku:`ROLL-SECOND-${uid}`,quantity:2}]};
      const checked=(await json(await call('POST','imports/preview',payload,admin))).data;assert.equal(checked.newRows,2);
      assert.equal((await call('POST','imports/commit',{payload,requestId:randomUUID(),previewToken:checked.token},admin)).status,409);
      assert.equal((await query('SELECT 1 FROM inventory_items WHERE sku=$1',[payload.rows[0].sku])).rowCount,0);
      assert.equal((await query('SELECT 1 FROM inventory_import_batches WHERE source_hash=$1',[sourceHash])).rowCount,0);
    });
    await t.test('standalone purchase invoice links existing assets without changing stock or leaving stale invoice lines',async()=>{
      const payload={number:`PAPER-FV-${uid}`,supplierId:supplier.id,date:'2026-10-06',amount:'800.50',currency:'EUR'};
      assert.equal((await call('POST','invoices',payload,operator)).status,403);
      const response=await call('POST','invoices',payload,admin);assert.equal(response.status,201);
      const invoice=(await json(response)).data;assert.equal(invoice.number,payload.number);assert.equal(Number(invoice.amount),800.50);
      const old=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,admin))).data;
      const asset=old.assets[0];
      const edited=await call('PATCH',`assets/${asset.assetId}`,{invoiceId:invoice.id,version:asset.version},admin);assert.equal(edited.status,200);
      const linked=(await json(edited)).data;assert.equal(linked.invoiceNumber,payload.number);assert.equal(linked.supplierName,old.supplierName);
      const oldAfter=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,viewer))).data;
      assert.ok(!oldAfter.assets.some((a:any)=>a.id===asset.id));assert.ok(oldAfter.items.every((i:any)=>!i.assetIds.includes(asset.assetId)));
      const detail=(await json(await call('GET',`invoices/${invoice.id}`,undefined,viewer))).data;
      assert.equal(detail.assets.length,1);assert.equal(detail.assets[0].assetId,asset.assetId);assert.equal(detail.deliveries.length,0);
      const moved=await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',owner:'Synthetic paper recipient',version:linked.version},operator);
      assert.equal(moved.status,200);assert.equal((await json(moved)).data.invoiceId,invoice.id);
      assert.equal((await call('POST','invoices',payload,admin)).status,409);
    });
    await t.test('invoice PDF upload, exact authenticated download, deduplication, limits, document scoping and audit',async()=>{
      const id=delivery.invoiceId;
      const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
      async function upload(data:Buffer,name='Synthetic FV.pdf',session:Session|null=admin,extra:Record<string,string>={}) {
        const request=new NextRequest(`http://localhost:3000/api/invoices/${id}/documents`,{method:'POST',body:new Uint8Array(data),headers:{origin:'http://localhost:3000','content-type':'application/pdf','x-file-name':encodeURIComponent(name),...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...extra}});
        return route.POST(request,{params:Promise.resolve({path:['invoices',id,'documents']})});
      }
      assert.equal((await upload(pdf,'Synthetic FV.pdf',null)).status,401);
      assert.equal((await upload(pdf,'Synthetic FV.pdf',viewer)).status,403);
      assert.equal((await upload(pdf,'Synthetic FV.pdf',operator)).status,403);
      assert.equal((await upload(pdf,'Synthetic FV.pdf',admin,{origin:'https://evil.invalid'})).status,403);
      assert.equal((await upload(pdf,'Synthetic FV.pdf',admin,{'x-csrf-token':''})).status,403);
      assert.equal((await upload(pdf,'Synthetic FV.pdf',admin,{'content-type':'text/html'})).status,415);
      assert.equal((await upload(Buffer.from('<html>invalid</html>'))).status,400);
      assert.equal((await upload(pdf,'../path.pdf')).status,400);
      assert.equal((await upload(Buffer.alloc(10*1024*1024+1)) ).status,413);
      const response=await upload(pdf,'Faktura testowa ą.pdf');assert.equal(response.status,201);
      const document=(await json(response)).data;assert.equal(document.sha256,createHash('sha256').update(pdf).digest('hex'));assert.equal(document.size,pdf.length);assert.equal(document.content,undefined);
      const repeated=await upload(pdf,'Retry.pdf');assert.equal((await json(repeated)).data.id,document.id);
      const list=(await json(await call('GET',`invoices/${id}/documents`,undefined,viewer))).data;assert.equal(list.length,1);
      const downloadPath=`invoices/${id}/documents/${document.id}`;
      assert.equal((await call('GET',downloadPath)).status,401);
      assert.equal((await call('GET',`invoices/${randomUUID()}/documents/${document.id}`,undefined,admin)).status,404);
      const download=await call('GET',downloadPath,undefined,viewer);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/pdf');assert.match(download.headers.get('content-disposition')!,/attachment/);assert.equal(download.headers.get('cache-control'),'private, no-store');assert.equal(download.headers.get('x-content-type-options'),'nosniff');
      assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
      const log=await query('SELECT after_data FROM audit_logs WHERE action=$1 AND entity_id=$2',['UPLOAD_INVOICE_PDF',id]);assert.equal(log.rowCount,1);assert.equal(log.rows[0].after_data.sha256,document.sha256);assert.equal(log.rows[0].after_data.content,undefined);
    });
    await t.test('optional product identifiers, scoped history CSV and authenticated PNG/ZPL labels',async()=>{
      const created=await call('POST','inventory',{name:`Synthetic no SKU ${uid}`,sku:'',productCode:`CODE-${uid}`,slug:`no-sku-${uid}`,category:'Test'},admin);
      assert.equal(created.status,201);const noSku=(await json(created)).data;assert.equal(noSku.sku,null);
      assert.equal((await call('POST','inventory',{name:'Synthetic second no SKU',slug:`no-sku-second-${uid}`,category:'Test'},admin)).status,201);
      const moved=await call('POST',`inventory/${noSku.slug}/movements`,{delta:2,note:'Only this item',requestId:randomUUID()},operator);assert.equal(moved.status,200);
      const resolved=(await json(await call('GET',`scan/resolve?code=CODE-${uid}`,undefined,viewer))).data;assert.equal(resolved.href,`/inventory/${noSku.slug}`);
      const csvResponse=await call('GET',`inventory/${noSku.slug}/history/export`,undefined,viewer);assert.equal(csvResponse.status,200);const text=await csvResponse.text();assert.ok(text.includes(noSku.name));assert.ok(!text.includes(item.name));
      assert.equal((await call('GET',`inventory/${noSku.slug}/history/export`)).status,401);
      const assetResponse=await call('POST','assets',{name:`Synthetic identifiers ${uid}`,categoryId,sku:'',productCode:`AS-CODE-${uid}`},admin);assert.equal(assetResponse.status,201);const asset=(await json(assetResponse)).data;
      assert.equal(asset.sku,null);assert.equal(asset.productCode,`AS-CODE-${uid}`);
      const assetScan=(await json(await call('GET',`scan/resolve?code=AS-CODE-${uid}`,undefined,viewer))).data;assert.equal(assetScan.href,`/asset/${asset.assetId}`);
      const assetCsv=await call('GET',`assets/${asset.assetId}/history/export`,undefined,viewer);assert.equal(assetCsv.status,200);const assetText=await assetCsv.text();assert.ok(assetText.includes(asset.assetId));assert.ok(!assetText.includes('Synthetic paper recipient'));
      const png=await call('GET',`qr?type=asset&id=${asset.assetId}&format=png`,undefined,viewer);assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await png.arrayBuffer()).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
      assert.equal((await call('GET',`qr?type=asset&id=${asset.assetId}&format=png`)).status,401);
      const zplPath=`labels/zpl?type=asset&id=${asset.assetId}&dpi=300&width=60&height=50`;
      const zpl=await call('GET',zplPath,undefined,operator);assert.equal(zpl.status,200);assert.match(await zpl.text(),/\^PW709/);
      for(const [dpi,width] of [[203,480],[600,1417]]){const label=await call('GET',`labels/zpl?type=asset&id=${asset.assetId}&dpi=${dpi}&width=60&height=50`,undefined,operator);assert.equal(label.status,200);assert.ok((await label.text()).includes(`^PW${width}`));}
      assert.equal((await call('GET',`labels/zpl?type=asset&id=${asset.assetId}&dpi=1200`,undefined,operator)).status,400);
      assert.equal((await call('GET',zplPath,undefined,viewer)).status,200);
      assert.equal((await call('GET',zplPath)).status,401);
      assert.equal((await call('GET',`labels/zpl?type=asset&id=${asset.assetId}&width=10`,undefined,admin)).status,400);
    });
    await t.test('detailed suppliers persist edits, prevent stale writes and appear on purchase invoices',async()=>{
      const payload={name:`Ultimate supplier ${uid}`,taxId:`TEST-${uid}`,street:'Fikcyjna 12',postalCode:'00-000',city:'Miasto testowe',country:'PL',contactName:'Kontakt testowy',email:`supplier-${uid}@test.invalid`,phone:'000000000',website:'https://example.invalid',bankAccount:'SYNTHETIC-ACCOUNT',notes:'Synthetic fixture only'};
      const response=await call('POST','admin/suppliers',payload,admin);assert.equal(response.status,201);const company=(await json(response)).data;assert.equal(company.taxId,`TEST${uid.toUpperCase()}`);
      const patch={...payload,name:`Updated ${payload.name}`,city:'Nowe miasto testowe',version:company.version};
      const saved=await call('PATCH',`admin/suppliers/${company.id}`,patch,admin);assert.equal(saved.status,200);const updated=(await json(saved)).data;assert.equal(updated.city,patch.city);
      assert.equal((await call('PATCH',`admin/suppliers/${company.id}`,patch,admin)).status,409);
      assert.equal((await call('POST','admin/suppliers',{...payload,name:`Duplicate tax ${uid}`},admin)).status,409);
      assert.equal((await call('POST','admin/suppliers',{name:'Synthetic unsafe URL',website:'javascript:alert(1)'},admin)).status,400);
      const invoice=(await json(await call('POST','invoices',{number:`FULL-FV-${uid}`,supplierId:company.id,date:'2026-10-06',amount:'10.00'},admin))).data;
      const detail=(await json(await call('GET',`invoices/${invoice.id}`,undefined,viewer))).data;assert.equal(detail.supplier.street,payload.street);assert.equal(detail.supplier.city,patch.city);assert.equal(detail.supplier.bankAccount,payload.bankAccount);
    });
    await t.test('category-defined fields validate assets and retain unrelated custom fields',async()=>{
      const fields=[{key:'ram',label:'RAM',type:'number',required:true},{key:'ports',label:'Porty',type:'select',required:false,options:['USB','HDMI']},{key:'checked',label:'Sprawdzony',type:'boolean',required:true}];
      const response=await call('POST','admin/categories',{name:`Ultimate category ${uid}`,description:'Synthetic category',fieldDefinitions:fields},admin);assert.equal(response.status,201);const category=(await json(response)).data;assert.deepEqual(category.fieldDefinitions,fields);
      assert.equal((await call('POST','admin/categories',{name:'Synthetic duplicate keys',fieldDefinitions:[fields[0],fields[0]]},admin)).status,400);
      assert.equal((await call('POST','assets',{name:'Synthetic missing RAM',categoryId:category.id},admin)).status,400);
      assert.equal((await call('POST','assets',{name:'Synthetic invalid RAM',categoryId:category.id,customFields:{ram:'lots',checked:'false'}},admin)).status,400);
      const assetResponse=await call('POST','assets',{name:'Synthetic typed fields',categoryId:category.id,customFields:{ram:'16',ports:'HDMI',checked:'false',oldNote:'Preserved'}},admin);assert.equal(assetResponse.status,201);const asset=(await json(assetResponse)).data;
      assert.equal((await call('PATCH',`assets/${asset.assetId}`,{version:asset.version,customFields:{ram:'16',ports:'VGA',checked:'false'}},admin)).status,400);
      const note=await call('POST',`assets/${asset.assetId}/actions`,{action:'note',note:'Synthetic service note',version:asset.version},operator);assert.equal(note.status,200);assert.equal((await json(note)).data.customFields.oldNote,'Preserved');
      const edited=await call('PATCH',`admin/categories/${category.id}`,{name:category.name,description:'Edited',version:category.version},admin);assert.equal(edited.status,200);assert.deepEqual((await json(edited)).data.fieldDefinitions,fields);
      assert.equal((await call('PATCH',`admin/categories/${category.id}`,{name:category.name,version:category.version},admin)).status,409);
    });
    await t.test('employee transfers preserve purchase documents, historical names and exact employee equipment',async()=>{
      assert.equal((await call('POST','employees',{name:'Synthetic unauthorized'},operator)).status,403);
      const create=async(name:string)=>{const r=await call('POST','employees',{name:`${name} ${uid}`,employeeNumber:`${name}-${uid}`,department:'Test IT',locationId:location.id},admin);assert.equal(r.status,201);return (await json(r)).data;};
      const jarek=await create('Synthetic Jarek'),bartek=await create('Synthetic Bartek');
      const assets=(await json(await call('GET',`invoices/${delivery.invoiceId}`,undefined,admin))).data.assets;
      let asset=assets[0];
      const assign=await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',employeeId:jarek.id,version:asset.version},operator);assert.equal(assign.status,200);asset=(await json(assign)).data;assert.equal(asset.owner,jarek.name);assert.equal(asset.employeeId,jarek.id);
      const first=(await json(await call('GET',`employees/${jarek.id}/equipment`,undefined,viewer))).data;assert.equal(first.assets.length,1);assert.equal(first.assets[0].invoiceId,delivery.invoiceId);
      assert.equal((await call('PATCH',`employees/${jarek.id}`,{name:jarek.name,active:false,version:jarek.version},admin)).status,409);
      const renamedResponse=await call('PATCH',`employees/${jarek.id}`,{name:`Renamed ${jarek.name}`,version:jarek.version},admin);assert.equal(renamedResponse.status,200);const renamed=(await json(renamedResponse)).data;
      assert.equal((await call('PATCH',`employees/${jarek.id}`,{name:jarek.name,version:jarek.version},admin)).status,409);
      const filtered=(await json(await call('GET',`assets?owner=${encodeURIComponent(renamed.name)}`,undefined,viewer))).data;assert.ok(filtered.items.some((a:any)=>a.assetId===asset.assetId));
      const transfer=await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',employeeId:bartek.id,version:asset.version},operator);assert.equal(transfer.status,200);asset=(await json(transfer)).data;assert.equal(asset.employeeId,bartek.id);assert.equal(asset.invoiceId,delivery.invoiceId);
      const old=(await json(await call('GET',`employees/${jarek.id}/equipment`,undefined,viewer))).data;assert.equal(old.assets.length,0);assert.ok(old.history.some((h:any)=>h.action==='ASSIGN_ASSET'&&h.after.owner===jarek.name));
      const current=(await json(await call('GET',`employees/${bartek.id}/equipment`,undefined,viewer))).data;assert.equal(current.assets.length,1);assert.ok(current.history.some((h:any)=>h.action==='TRANSFER_ASSET'&&h.before.owner===renamed.name&&h.after.owner===bartek.name));
      const inactive=await call('PATCH',`employees/${jarek.id}`,{name:renamed.name,active:false,version:renamed.version},admin);assert.equal(inactive.status,200);
      assert.equal((await call('POST',`assets/${asset.assetId}/actions`,{action:'assign',employeeId:jarek.id,version:asset.version},operator)).status,400);
      const returned=await call('POST',`assets/${asset.assetId}/actions`,{action:'return',status:'AVAILABLE',version:asset.version},operator);assert.equal(returned.status,200);asset=(await json(returned)).data;assert.equal(asset.employeeId,null);assert.equal(asset.owner,null);
    });
    await t.test('employee accounts enforce roles, session revocation and personal equipment scope without logging passwords',async()=>{
      const profileResponse=await call('POST','employees',{name:`Synthetic account worker ${uid}`,email:`worker-${uid}@test.invalid`},admin);assert.equal(profileResponse.status,201);let profile=(await json(profileResponse)).data;
      const accountBody={email:profile.email,password,version:profile.version,role:'IT_USER'};
      assert.equal((await call('POST',`employees/${profile.id}/account`,accountBody,sessions.IT_ADVANCED)).status,403);
      assert.equal((await call('POST',`employees/${profile.id}/account`,{...accountBody,role:'ADMIN'},admin)).status,400);
      const accountResponse=await call('POST',`employees/${profile.id}/account`,accountBody,admin);assert.equal(accountResponse.status,201);const account=(await json(accountResponse)).data;assert.equal(account.password_hash,undefined);
      profile=(await json(await call('GET',`employees/${profile.id}`,undefined,admin))).data;assert.equal(profile.userId,account.id);
      assert.equal((await call('POST',`employees/${profile.id}/account`,{...accountBody,version:profile.version},admin)).status,409);
      assert.equal((await call('POST','employees',{name:'Synthetic forbidden link',userId:account.id},sessions.IT_ADVANCED)).status,403);
      assert.equal((await call('POST','employees',{name:'Synthetic duplicate account link',userId:account.id},admin)).status,409);
      const login=await call('POST','auth/login',{email:profile.email,password});assert.equal(login.status,200);const loginBody=(await json(login)).data;const worker:Session={cookie:login.headers.get('set-cookie')!.split(';')[0],csrf:loginBody.csrfToken,id:account.id};
      assert.equal(loginBody.mustChangePassword,true);const personal='Fictional worker personal password!';assert.equal((await call('POST','auth/change-password',{currentPassword:password,newPassword:personal,confirmation:personal},worker)).status,200);
      const workerLogin=await call('POST','auth/login',{email:profile.email,password:personal});assert.equal(workerLogin.status,200);const workerReady=(await json(workerLogin)).data;Object.assign(worker,{cookie:workerLogin.headers.get('set-cookie')!.split(';')[0],csrf:workerReady.csrfToken});
      const created=await call('POST','assets',{name:`Synthetic personal laptop ${uid}`,categoryId,employeeId:profile.id,status:'ASSIGNED'},admin);assert.equal(created.status,201);let asset=(await json(created)).data;
      const mine=(await json(await call('GET','my-equipment',undefined,worker))).data;assert.equal(mine.employee.id,profile.id);assert.equal(mine.assets.length,1);assert.equal(mine.assets[0].assetId,asset.assetId);
      assert.equal((await json(await call('GET','my-equipment',undefined,viewer))).data.employee,null);
      const log=await query('SELECT after_data FROM audit_logs WHERE entity_id=$1 AND action=$2',[profile.id,'CREATE_EMPLOYEE_ACCOUNT']);assert.equal(log.rowCount,1);assert.ok(!JSON.stringify(log.rows).includes(password));assert.ok(!JSON.stringify(log.rows).includes('password_hash'));
      const returned=await call('POST',`assets/${asset.assetId}/actions`,{action:'return',status:'AVAILABLE',version:asset.version},operator);assert.equal(returned.status,200);
      assert.equal((await call('PATCH',`employees/${profile.id}`,{name:profile.name,active:false,version:profile.version},sessions.IT_ADVANCED)).status,403);
      assert.equal((await call('PATCH',`employees/${profile.id}`,{name:profile.name,active:false,version:profile.version},admin)).status,200);
      assert.equal((await call('GET','my-equipment',undefined,worker)).status,401);
      profile=(await json(await call('GET',`employees/${profile.id}`,undefined,admin))).data;
      assert.equal((await call('PATCH',`employees/${profile.id}`,{name:'Synthetic inactive contact edit',userId:profile.userId,version:profile.version},admin)).status,200);
      assert.equal((await call('POST','employees',{name:'Synthetic inactive link',active:false,userId:viewer.id},admin)).status,400);
    });
    await t.test('location version conflicts protect concurrent tree edits',async()=>{
      const rows=(await json(await call('GET','lookups',undefined,admin))).data.locations;const node=rows.find((l:any)=>l.id===location.id);
      const patch={name:node.name,kind:node.kind,parentId:node.parentId,version:node.version};
      assert.equal((await call('PATCH',`admin/locations/${node.id}`,patch,admin)).status,200);
      assert.equal((await call('PATCH',`admin/locations/${node.id}`,patch,admin)).status,409);
    });
    await t.test('inline folders allow zones inside zones and children inside containers',async()=>{
      const create=async(name:string,parentId?:string,kind?:string)=>{
        const response=await call('POST','admin/locations',{name:`${name} ${uid}`,parentId,kind},admin);
        assert.equal(response.status,201);return (await json(response)).data;
      };
      const root=await create('Flexible root',undefined,'ZONE'),zone=await create('Flexible zone',root.id,'ZONE'),nested=await create('Nested zone',zone.id,'ZONE'),bin=await create('Flexible bin',nested.id,'BIN'),folder=await create('Inline folder',bin.id);
      assert.equal(folder.kind,'FOLDER');assert.equal(folder.path,[root,zone,nested,bin,folder].map(n=>n.name).join(' / '));
      assert.equal((await call('POST','admin/locations',{name:folder.name,parentId:bin.id},admin)).status,409);
      assert.equal((await call('PATCH',`admin/locations/${root.id}`,{name:root.name,parentId:folder.id,version:root.version},admin)).status,400);
      const moved=await call('PATCH',`admin/locations/${nested.id}`,{name:nested.name,parentId:null,version:nested.version},admin);assert.equal(moved.status,200);assert.equal((await json(moved)).data.kind,'ZONE');
      for(const node of [folder,bin,nested,zone,root])assert.equal((await call('DELETE',`admin/locations/${node.id}`,undefined,admin)).status,200);
    });
    await t.test('category field visibility persists and editing preserves hidden financial and network data',async()=>{
      const standardFields={hostname:false,ipAddress:false,macAddress:false,isFixedAsset:false,invoiceId:false};
      const response=await call('POST','admin/categories',{name:`Synthetic DHCP laptops ${uid}`,standardFields},admin);assert.equal(response.status,201);let category=(await json(response)).data;
      assert.deepEqual(category.standardFields,standardFields);
      assert.equal((await call('POST','admin/categories',{name:'Invalid setting',standardFields:{arbitrary:false}},admin)).status,400);
      assert.equal((await call('PATCH',`admin/categories/${category.id}`,{name:category.name,standardFields:{}},viewer)).status,403);
      const updated=await call('PATCH',`admin/categories/${category.id}`,{name:category.name,description:'Retain settings',version:category.version},admin);assert.equal(updated.status,200);category=(await json(updated)).data;assert.deepEqual(category.standardFields,standardFields);
      const fresh=await call('POST','assets',categoryAssetBody({name:'Synthetic DHCP laptop',categoryId:category.id,ipAddress:'invalid hidden value',invoiceId:'unused hidden value',isFixedAsset:true},category),admin);assert.equal(fresh.status,201);assert.equal((await json(fresh)).data.ipAddress,null);
      const created=await call('POST','assets',{name:'Synthetic stored laptop',categoryId:category.id,ipAddress:'192.0.2.34',hostname:'synthetic-host',macAddress:'00:00:00:00:00:01',invoiceId:delivery.invoiceId,isFixedAsset:true,fixedAssetNumber:`ST-HIDDEN-${uid}`},admin);assert.equal(created.status,201);const asset=(await json(created)).data;
      const edited=await call('PATCH',`assets/${asset.assetId}`,categoryAssetBody({name:'Synthetic renamed laptop',categoryId:category.id,status:asset.status,ipAddress:'',hostname:'',macAddress:'',invoiceId:'',isFixedAsset:false,fixedAssetNumber:'',version:asset.version},category),admin);assert.equal(edited.status,200);const saved=(await json(edited)).data;
      for(const key of ['ipAddress','hostname','macAddress','invoiceId','isFixedAsset','fixedAssetNumber'])assert.equal(saved[key],asset[key],key);
      const found=(await json(await call('GET','lookups',undefined,admin))).data.categories.find((row:any)=>row.id===category.id);assert.deepEqual(found.standardFields,standardFields);
      const reset=await call('PATCH',`admin/categories/${category.id}`,{name:category.name,standardFields:{},version:category.version},admin);assert.equal(reset.status,200);
      assert.equal((await call('PATCH',`admin/categories/${category.id}`,{name:category.name,standardFields,version:category.version},admin)).status,409);
      const invoices=(await json(await call('GET',`invoices?q=${encodeURIComponent(deliveryBody.invoiceNumber)}&pageSize=30`,undefined,viewer))).data;assert.ok(invoices.items.some((row:any)=>row.id===delivery.invoiceId));
    });
    await t.test('invoice search, generated QR, role/session revocation and CSV',async()=>{
      const found=(await json(await call('GET',`search?q=${encodeURIComponent(deliveryBody.invoiceNumber)}`,undefined,admin))).data;
      assert.ok(found.some((r:any)=>r.type==='invoice' && r.id===delivery.invoiceId));
      const qr=await call('GET',`qr?type=inventory&id=${item.slug}`,undefined,admin);
      assert.equal(qr.status,200);assert.match(qr.headers.get('content-type')!,/svg/);assert.match(await qr.text(),/<svg/);
      const exportResult=await call('GET','admin/inventory-export',undefined,admin);assert.equal(exportResult.status,200);assert.ok((await exportResult.text()).includes(uid));
      assert.equal((await call('GET','admin/inventory-export',undefined,viewer)).status,403);
      assert.equal((await call('PATCH',`admin/users/${operator.id}`,{active:false},admin)).status,200);
      assert.equal((await call('GET','inventory',undefined,operator)).status,401);
      const logout=await call('POST','auth/logout',{},viewer);assert.equal(logout.status,200);
      assert.equal((await call('GET','assets',undefined,viewer)).status,401);
    });
  } finally { await pool.end(); }
});
