import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultDeviceConfig,defaultTerminalConfig} from '../src/shared/devices';
test('Managed screens: pairing, scoped live data, terminal workflow and revocation',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const target=process.env.TEST_DATABASE_URL!;assert.ok(new URL(target).pathname.endsWith('_test'));assert.notEqual(target,process.env.DATABASE_URL);process.env.DATABASE_URL=target;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const uid=randomUUID().slice(0,8),password='Fictional device test password!',sessions:Record<string,{cookie:string;csrf:string;id:string}>={};
 async function call(method:'GET'|'POST'|'PATCH'|'DELETE',path:string,body?:unknown,who='ADMIN',extras:Record<string,string>={}){
  const session=sessions[who],headers:Record<string,string>={...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...extras};if(method!=='GET'){headers.origin??='http://localhost:3000';headers['content-type']='application/json';}
  return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function data(response:Response){const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return json.data;}
 async function beginTv(device:any){const response=await call('POST','device/'+device.id+'/pairing',{},'none');return {...await data(response),cookie:response.headers.get('set-cookie')!.split(';')[0]};}
 async function pair(device:any,code:string|null){if(device.kind==='TV'){const pending=await beginTv(device),current=(await data(await call('GET','devices'))).find((item:any)=>item.id===device.id);await data(await call('POST','devices/'+device.id+'/approve',{code:pending.code,version:current.version}));const response=await call('GET','device/'+device.id+'/pairing',undefined,'none',{cookie:pending.cookie});assert.equal((await data(response)).status,'approved');return response.headers.getSetCookie().find(value=>value.startsWith('ith-device-'+device.id+'='))!.split(';')[0];}const response=await call('POST','device/'+device.id+'/pair',{code},'none');await data(response);return response.headers.get('set-cookie')!.split(';')[0];}
 const asScreen=async(id:string,cookie:string)=>data(await call('GET','device/'+id,undefined,'none',{cookie}));
 try{
  for(const role of ['ADMIN','IT_ADVANCED','VIEWER']){const email='screen-'+role.toLowerCase()+'-'+uid+'@example.test';await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Fictional screen '+role+' '+uid,email,await hashPassword(password),role]);const response=await call('POST','auth/login',{email,password},'none'),user=await data(response);sessions[role]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken,id:user.id};}
  const category=await data(await call('POST','admin/categories',{name:'Screen category '+uid})),site=await data(await call('POST','admin/locations',{name:'Screen site '+uid})),outside=await data(await call('POST','admin/locations',{name:'Screen outside '+uid}));
  const asset=await data(await call('POST','assets',{name:'Fictional screen laptop '+uid,categoryId:category.id,locationId:site.id,status:'AVAILABLE',serialNumber:'SCREEN-SN-'+uid,rfidTag:'SCREEN-RFID-'+uid})),other=await data(await call('POST','assets',{name:'Fictional outside laptop '+uid,categoryId:category.id,locationId:outside.id,status:'AVAILABLE'}));
  const incident=await data(await call('POST','incidents',{title:'Fictional display incident '+uid,assetId:asset.assetId,priority:'CRITICAL',requestId:randomUUID()}));await data(await call('POST','incidents',{title:'Fictional outside incident '+uid,assetId:other.assetId,requestId:randomUUID()}));
  let tv:any,terminal:any,tvCookie='',terminalCookie='';
  await t.test('RBAC, one-use expiring codes and browser binding without user access',async()=>{
   assert.equal((await call('GET','devices',undefined,'VIEWER')).status,403);assert.equal((await call('POST','devices',{name:'Denied TV '+uid,kind:'TV'},'IT_ADVANCED')).status,403);
   tv=await data(await call('POST','devices',{name:'Fictional TV '+uid,kind:'TV',assetId:asset.id,config:{...defaultDeviceConfig('TV'),locationId:site.id}}));assert.equal(tv.code,null);assert.equal(new URL(tv.url).pathname,'/device/'+tv.device.id);
   assert.equal((await call('GET','device/'+tv.device.id,undefined,'none')).status,401);
   const pending=await beginTv(tv.device);assert.match(pending.code,/^\d{6}$/);const wrong=pending.code==='000000'?'111111':'000000';
   assert.equal((await call('POST','devices/'+tv.device.id+'/approve',{code:pending.code,version:tv.device.version},'IT_ADVANCED')).status,403);
   assert.equal((await call('POST','devices/'+tv.device.id+'/approve',{code:wrong,version:tv.device.version})).status,400);
   assert.equal((await data(await call('GET','device/'+tv.device.id+'/pairing',undefined,'none',{cookie:pending.cookie}))).status,'waiting');
   assert.equal((await call('GET','device/'+tv.device.id,undefined,'none',{cookie:pending.cookie})).status,401);
   const values=await query('SELECT code_hash,browser_token_hash FROM device_pairing_requests WHERE device_id=$1',[tv.device.id]);assert.notEqual(values.rows[0].code_hash,pending.code);assert.notEqual(values.rows[0].browser_token_hash,pending.cookie.split('=')[1]);
   await data(await call('POST','devices/'+tv.device.id+'/approve',{code:pending.code,version:tv.device.version}));
   const claim=await call('GET','device/'+tv.device.id+'/pairing',undefined,'none',{cookie:pending.cookie});assert.equal((await data(claim)).status,'approved');tvCookie=claim.headers.getSetCookie().find(value=>value.startsWith('ith-device-'+tv.device.id+'='))!.split(';')[0];assert.ok(tvCookie.startsWith('ith-device-'+tv.device.id+'='));
   const current=(await data(await call('GET','devices'))).find((item:any)=>item.id===tv.device.id);assert.equal((await call('POST','devices/'+tv.device.id+'/approve',{code:pending.code,version:current.version})).status,400);
   assert.equal((await call('POST','device/'+tv.device.id+'/pair',{code:pending.code},'none')).status,409);
   const screen=await asScreen(tv.device.id,tvCookie);assert.equal(screen.name,tv.device.name);assert.ok(screen.csrfToken);
   assert.equal((await call('GET','assets',undefined,'none',{cookie:tvCookie})).status,401);assert.equal((await call('GET','auth/me',undefined,'none',{cookie:tvCookie})).status,401);
   assert.equal((await call('GET','devices',undefined,'IT_ADVANCED')).status,403);
   const list=(await data(await call('GET','devices'))).find((d:any)=>d.id===tv.device.id);assert.ok(!('token_hash' in list));assert.ok(!('csrfToken' in list));assert.ok(!('code' in list));
   const expired=await data(await call('POST','devices',{name:'Expired TV '+uid,kind:'TV'})),expiredPending=await beginTv(expired.device);await query("UPDATE device_pairing_requests SET expires_at=now()-interval '1 minute' WHERE device_id=$1",[expired.device.id]);assert.equal((await call('POST','devices/'+expired.device.id+'/approve',{code:expiredPending.code,version:expired.device.version})).status,400);assert.equal((await data(await call('GET','device/'+expired.device.id+'/pairing',undefined,'none',{cookie:expiredPending.cookie}))).status,'expired');
  });
  await t.test('live config and location-scoped TV without financial or personal payload',async()=>{
   let screen=await asScreen(tv.device.id,tvCookie);assert.equal(screen.statistics.total,1);assert.equal(screen.statistics.openIncidents,1);assert.equal(screen.statistics.criticalIncidents,1);assert.equal(screen.incidents.length,1);assert.equal(screen.incidents[0].id,incident.incident.id);
   assert.ok(!('description' in screen.incidents[0]));assert.ok(!('assignedName' in screen.incidents[0]));assert.ok(!('actor' in screen));assert.ok(!('serialNumber' in screen));
   const current=(await data(await call('GET','devices'))).find((d:any)=>d.id===tv.device.id),config={...current.config,mode:'MESSAGE',message:'Fictional safety notice',theme:'dark'};await data(await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',assetId:current.assetId,config,version:current.version}));
   screen=await asScreen(tv.device.id,tvCookie);assert.equal(screen.config.message,config.message);assert.equal(screen.config.theme,'dark');assert.equal(screen.statistics,null);assert.equal(screen.incidents.length,0);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config,version:current.version})).status,409);
   assert.equal((await call('POST','device/'+current.id+'/scan',{code:asset.assetId,version:screen.version,requestId:randomUUID()},'none',{cookie:tvCookie,'x-device-csrf':screen.csrfToken})).status,403);
  });
  await t.test('TV exact widgets, branch/category/status/priority filters and omitted fields',async()=>{
   const child=await data(await call('POST','admin/locations',{name:'Screen child '+uid,parentId:site.id})),childAsset=await data(await call('POST','assets',{name:'Fictional child display '+uid,categoryId:category.id,locationId:child.id,status:'DAMAGED'}));
   await data(await call('POST','incidents',{title:'Fictional child critical '+uid,assetId:childAsset.assetId,priority:'CRITICAL',requestId:randomUUID()}));
   await data(await call('POST','incidents',{title:'Fictional primary normal '+uid,assetId:asset.assetId,priority:'NORMAL',requestId:randomUUID()}));
   const otherCategory=await data(await call('POST','admin/categories',{name:'Excluded display category '+uid}));await data(await call('POST','assets',{name:'Excluded display asset '+uid,categoryId:otherCategory.id,locationId:child.id,status:'AVAILABLE'}));
   let current=(await data(await call('GET','devices'))).find((item:any)=>item.id===tv.device.id);
   const tvOptions={...defaultDeviceConfig('TV').tv!,metrics:['total','damaged','openIncidents'],categoryId:category.id,includeChildren:true,incidentStatuses:['OPEN'],incidentPriorities:['CRITICAL'],incidentFields:['number'],incidentLimit:1,incidentSort:'priority',sectionOrder:['statistics','incidents','message'],columns:3,textSize:'large',pageSize:1,rotateSeconds:10};
   await data(await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config:{...defaultDeviceConfig('TV'),locationId:site.id,tv:tvOptions},version:current.version}));
   let screen=await asScreen(current.id,tvCookie);assert.deepEqual(screen.metrics,[{key:'total',value:2},{key:'damaged',value:1},{key:'openIncidents',value:2}]);assert.equal(screen.incidentCount,2);assert.equal(screen.incidents.length,1);assert.deepEqual(Object.keys(screen.incidents[0]).sort(),['id','number','title']);assert.deepEqual(Object.keys(screen.statistics.statuses),['DAMAGED']);assert.ok(!('criticalIncidents' in screen.statistics));
   current=(await data(await call('GET','devices'))).find((item:any)=>item.id===current.id);const exact={...current.config,tv:{...tvOptions,includeChildren:false,metrics:['total','available'],incidentFields:[]}};
   await data(await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config:exact,version:current.version}));screen=await asScreen(current.id,tvCookie);assert.equal(screen.metrics[0].value,1);assert.equal(screen.incidentCount,1);assert.deepEqual(Object.keys(screen.incidents[0]).sort(),['id','title']);
   current=(await data(await call('GET','devices'))).find((item:any)=>item.id===current.id);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config:{...exact,tv:{...exact.tv,metrics:['total','total']}},version:current.version})).status,400);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config:{...exact,tv:{...exact.tv,sectionOrder:['message','message','incidents']}},version:current.version})).status,400);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'TV',config:{...exact,tv:{...exact.tv,incidentLimit:51}},version:current.version})).status,400);
  });
  await t.test('locations module is restricted to administrators while operational selection remains',async()=>{
   for(const role of ['VIEWER','IT_ADVANCED']){
    assert.equal((await call('GET','locations/'+site.id,undefined,role)).status,403);
    assert.equal((await call('PATCH','admin/locations/'+site.id,{name:'Denied move',version:site.version},role)).status,403);
    const matches=await data(await call('GET','search?q='+encodeURIComponent(site.name),undefined,role));assert.ok(matches.every((entry:any)=>entry.type!=='location'));
    const lookups=await data(await call('GET','lookups',undefined,role));assert.ok(lookups.locations.some((entry:any)=>entry.id===site.id));
   }
   assert.equal((await call('GET','locations/'+site.id)).status,200);
  });
  await t.test('terminal lookup, safe origin, csrf, version, inventory and replay',async()=>{
   terminal=await data(await call('POST','devices',{name:'Fictional terminal '+uid,kind:'SCANNER'}));terminalCookie=await pair(terminal.device,terminal.code);let screen=await asScreen(terminal.device.id,terminalCookie);
   const body={code:asset.rfidTag,version:screen.version,requestId:randomUUID()},headers={cookie:terminalCookie,'x-device-csrf':screen.csrfToken};
   assert.equal((await call('POST','device/'+screen.id+'/scan',body,'none',{cookie:terminalCookie})).status,403);assert.equal((await call('POST','device/'+screen.id+'/scan',body,'none',{...headers,origin:'https://untrusted.example'})).status,403);
   const result=await data(await call('POST','device/'+screen.id+'/scan',body,'none',headers));assert.equal(result.asset.assetId,asset.assetId);assert.ok(!('owner' in result.asset));assert.ok(!('invoiceId' in result.asset));assert.equal((await data(await call('POST','device/'+screen.id+'/scan',body,'none',headers))).asset.assetId,asset.assetId);
   assert.equal((await call('POST','device/'+screen.id+'/scan',{...body,code:'https://untrusted.example/asset/'+asset.assetId,requestId:randomUUID()},'none',headers)).status,400);
   const scan=await data(await call('POST','stocktakes',{locationId:site.id,requestId:randomUUID()}));const device=(await data(await call('GET','devices'))).find((d:any)=>d.id===screen.id);await data(await call('PATCH','devices/'+device.id,{name:device.name,kind:'SCANNER',config:{...device.config,mode:'INVENTORY',stocktakeId:scan.id},version:device.version}));
   assert.equal((await call('POST','device/'+screen.id+'/scan',{...body,requestId:randomUUID()},'none',headers)).status,409);screen=await asScreen(device.id,terminalCookie);assert.equal(screen.inventory.id,scan.id);
   const read={code:asset.assetId,version:screen.version,requestId:randomUUID()},first=await data(await call('POST','device/'+screen.id+'/scan',read,'none',headers)),replay=await data(await call('POST','device/'+screen.id+'/scan',read,'none',headers));assert.equal(first.event.id,replay.event.id);assert.equal(first.inventory.observed,1);assert.ok(!('snapshot' in first.inventory));
   const actual=await data(await call('GET','stocktakes/'+scan.id));assert.equal(actual.events.length,1);await data(await call('POST','stocktakes/'+scan.id+'/finish',{version:actual.version}));assert.equal((await call('POST','device/'+screen.id+'/scan',{...read,requestId:randomUUID()},'none',headers)).status,409);assert.equal((await asScreen(screen.id,terminalCookie)).inventory.status,'COMPLETED');
  });
  await t.test('terminal field configuration filters payloads, includes products and limits stocktake counters',async()=>{
   const config={...defaultDeviceConfig('SCANNER'),mode:'CONTINUOUS',scanner:{...defaultTerminalConfig(),assetFields:['assetId'],inventoryFields:['stock'],counters:['observed','missing'],showCode:false,showCamera:false,historyLimit:5,textSize:'large',inputLabel:'Odczytaj etykietę',inputPlaceholder:'Czytnik + Enter'}};
   const created=await data(await call('POST','devices',{name:'Configured terminal '+uid,kind:'SCANNER',config})),cookie=await pair(created.device,created.code);let screen=await asScreen(created.device.id,cookie);
   const headers={cookie,'x-device-csrf':screen.csrfToken};
   async function read(code:string){return data(await call('POST','device/'+screen.id+'/scan',{code,requestId:randomUUID(),version:screen.version},'none',headers));}
   let result=await read(asset.assetId);assert.deepEqual(Object.keys(result.asset).sort(),['assetId','name']);assert.equal(result.code,'');assert.ok(!('serialNumber' in result.asset));assert.ok(!('status' in result.asset));assert.equal(screen.config.scanner.historyLimit,5);assert.equal(screen.config.scanner.showCamera,false);
   const product=await data(await call('POST','inventory',{name:'Synthetic terminal cable '+uid,slug:'terminal-cable-'+uid,category:'Kable i przewody',unit:'m',openingStock:2.5,openingNote:'Synthetic length',requestId:randomUUID()}));result=await read('/inventory/'+product.slug);assert.deepEqual(Object.keys(result.product).sort(),['name','stock','unit']);assert.equal(result.product.stock,2.5);assert.equal(result.product.unit,'m');assert.ok(!('minimalStock' in result.product));assert.ok(!('notes' in result.product));
   let current=(await data(await call('GET','devices'))).find((d:any)=>d.id===screen.id);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'SCANNER',version:current.version,config:{...config,scanner:{...config.scanner,assetFields:['model','model']}}})).status,400);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'SCANNER',version:current.version,config:{...config,scanner:{...config.scanner,historyLimit:101}}})).status,400);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'SCANNER',version:current.version,config:{...config,scanner:{...config.scanner,assetFields:['owner']}}})).status,400);
   assert.equal((await call('PATCH','devices/'+current.id,{name:current.name,kind:'SCANNER',version:current.version,config},'IT_ADVANCED')).status,403);
   const scan=await data(await call('POST','stocktakes',{locationId:outside.id,requestId:randomUUID()}));await data(await call('PATCH','devices/'+current.id,{name:current.name,kind:'SCANNER',version:current.version,config:{...config,mode:'INVENTORY',stocktakeId:scan.id}}));screen=await asScreen(screen.id,cookie);
   assert.deepEqual(Object.keys(screen.inventory).sort(),['id','locationName','missing','observed','status']);assert.ok(!('startedBy' in screen.inventory));
   result=await read(other.assetId);assert.deepEqual(Object.keys(result.inventory).sort(),['id','locationName','missing','observed','status']);assert.equal(result.inventory.observed,1);assert.deepEqual(Object.keys(result.asset).sort(),['assetId','name']);assert.equal(result.event.code,'');
   const actual=await data(await call('GET','stocktakes/'+scan.id));assert.equal(actual.events.length,1);assert.equal(actual.events[0].code,other.assetId,'Hiding screen fields preserves the source journal');
  });
  await t.test('admin-only personal dashboard preferences, isolation and optimistic edits',async()=>{
   assert.equal((await call('GET','dashboard/layout',undefined,'IT_ADVANCED')).status,403);assert.equal((await call('GET','dashboard/layout',undefined,'VIEWER')).status,403);
   const preference=await data(await call('GET','dashboard/layout')),layout={...preference.layout,scanner:false,locations:false};const saved=await data(await call('PATCH','dashboard/layout',{layout,version:preference.version}));assert.deepEqual((await data(await call('GET','dashboard/layout'))).layout,layout);assert.equal(saved.version,preference.version+1);
   assert.equal((await call('PATCH','dashboard/layout',{layout,version:preference.version})).status,409);assert.equal((await call('PATCH','dashboard/layout',{layout,version:saved.version},'IT_ADVANCED')).status,403);
   const email='second-screen-admin-'+uid+'@example.test';await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')",['Second fictional screen admin '+uid,email,await hashPassword(password)]);const loginResponse=await call('POST','auth/login',{email,password},'none'),otherAdmin=await data(loginResponse);sessions.SECOND={cookie:loginResponse.headers.get('set-cookie')!.split(';')[0],csrf:otherAdmin.csrfToken,id:otherAdmin.id};const otherPreference=await data(await call('GET','dashboard/layout',undefined,'SECOND'));assert.equal(otherPreference.version,0);assert.equal(otherPreference.layout.scanner,true);
   const empty=Object.fromEntries(Object.keys(layout).map(key=>[key,false]));assert.equal((await call('PATCH','dashboard/layout',{layout:empty,version:saved.version})).status,400);
  });
  await t.test('deleting a paired TV is admin-only, versioned, audited and preserves inventory',async()=>{
   const created=await data(await call('POST','devices',{name:'Delete TV '+uid,kind:'TV',assetId:asset.id}));
   const cookie=await pair(created.device,created.code),pending=await beginTv(created.device);
   let current=(await data(await call('GET','devices'))).find((d:any)=>d.id===created.device.id);
   for(const role of ['VIEWER','IT_ADVANCED'])assert.equal((await call('DELETE','devices/'+current.id,{version:current.version},role)).status,403);
   assert.equal((await call('DELETE','devices/'+current.id,{version:current.version},'none')).status,401);
   assert.equal((await call('DELETE','devices/'+current.id,{version:current.version},'ADMIN',{'x-csrf-token':'wrong'})).status,403);
   assert.equal((await call('DELETE','devices/'+current.id,{version:current.version},'ADMIN',{origin:'https://untrusted.example'})).status,403);
   assert.equal((await call('DELETE','devices/'+current.id,{})).status,400);
   assert.equal((await call('DELETE','devices/not-a-uuid',{version:current.version})).status,400);
   const stale=current.version;await data(await call('PATCH','devices/'+current.id,{name:current.name+' updated',kind:'TV',assetId:asset.id,config:current.config,version:stale}));
   assert.equal((await call('DELETE','devices/'+current.id,{version:stale})).status,409);
   assert.equal((await asScreen(current.id,cookie)).id,current.id);
   current=(await data(await call('GET','devices'))).find((d:any)=>d.id===current.id);
   assert.deepEqual(await data(await call('DELETE','devices/'+current.id,{version:current.version},'SECOND')),{deleted:true});
   assert.ok(!(await data(await call('GET','devices'))).some((d:any)=>d.id===current.id));
   assert.equal((await call('GET','device/'+current.id,undefined,'none',{cookie})).status,401);
   assert.equal((await call('GET','device/'+current.id+'/setup',undefined,'none')).status,404);
   assert.equal((await call('POST','device/'+current.id+'/pairing',{},'none')).status,404);
   assert.equal((await call('GET','device/'+current.id+'/pairing',undefined,'none',{cookie:pending.cookie})).status,404);
   assert.equal((await query('SELECT id FROM device_pairing_requests WHERE device_id=$1',[current.id])).rowCount,0);
   assert.equal((await call('DELETE','devices/'+current.id,{version:current.version})).status,404);
   assert.equal((await data(await call('GET','assets/'+asset.assetId))).id,asset.id);
   assert.equal((await asScreen(tv.device.id,tvCookie)).id,tv.device.id);
   const audit=(await query("SELECT actor_id,before_data FROM audit_logs WHERE action='DELETE_DEVICE' AND entity_id=$1",[current.id])).rows;
   assert.equal(audit.length,1);assert.equal(audit[0].actor_id,sessions.SECOND.id);assert.deepEqual(audit[0].before_data,{name:current.name,kind:'TV',assetId:asset.id,version:current.version});
   assert.ok((await query("SELECT id FROM audit_logs WHERE action='CREATE_DEVICE' AND entity_id=$1",[current.id])).rowCount);
  });
  await t.test('disabled screens and terminals can also be removed without deleting assets',async()=>{
   const created=await data(await call('POST','devices',{name:'Delete terminal '+uid,kind:'SCANNER',assetId:asset.id})),cookie=await pair(created.device,created.code);
   const current=(await data(await call('GET','devices'))).find((d:any)=>d.id===created.device.id);
   const disabled=await data(await call('POST','devices/'+current.id+'/access',{enabled:false,version:current.version}));
   assert.deepEqual(await data(await call('DELETE','devices/'+disabled.id,{version:disabled.version})),{deleted:true});
   assert.equal((await call('POST','device/'+disabled.id+'/pair',{code:created.code},'none')).status,401);
   assert.equal((await call('GET','device/'+disabled.id,undefined,'none',{cookie})).status,401);
   assert.equal((await data(await call('GET','assets/'+asset.assetId))).id,asset.id);
  });
  await t.test('replacement pairing, disable/enable, expired credentials and admin authority',async()=>{
   let device=(await data(await call('GET','devices'))).find((d:any)=>d.id===tv.device.id);const fresh=await data(await call('POST','devices/'+device.id+'/pairing',{version:device.version})),replacement=await pair(device,fresh.code);assert.equal((await call('GET','device/'+device.id,undefined,'none',{cookie:tvCookie})).status,401);tvCookie=replacement;
   device=(await data(await call('GET','devices'))).find((d:any)=>d.id===tv.device.id);let disabled=await data(await call('POST','devices/'+device.id+'/access',{enabled:false,version:device.version}));assert.equal((await call('GET','device/'+device.id,undefined,'none',{cookie:tvCookie})).status,401);assert.equal((await call('POST','devices/'+device.id+'/pairing',{version:disabled.version})).status,409);
   await data(await call('POST','devices/'+device.id+'/access',{enabled:true,version:disabled.version}));assert.equal((await call('GET','device/'+device.id,undefined,'none',{cookie:tvCookie})).status,401);
   await query("UPDATE managed_devices SET session_expires_at=now()-interval '1 minute' WHERE id=$1",[terminal.device.id]);assert.equal((await call('GET','device/'+terminal.device.id,undefined,'none',{cookie:terminalCookie})).status,401);
   device=(await data(await call('GET','devices'))).find((d:any)=>d.id===tv.device.id);const code=await data(await call('POST','devices/'+device.id+'/pairing',{version:device.version}));tvCookie=await pair(device,code.code);await query("UPDATE users SET role='IT_ADVANCED' WHERE id=$1",[sessions.ADMIN.id]);assert.equal((await call('GET','device/'+device.id,undefined,'none',{cookie:tvCookie})).status,403);
   const audit=(await query("SELECT before_data::text,after_data::text FROM audit_logs WHERE entity_type='managed_device' AND entity_id=$1",[device.id])).rows;assert.ok(audit.length>0);assert.ok(audit.every(r=>!((r.before_data??'')+(r.after_data??'')).includes('token_hash')));
  });
 }finally{await pool.end();}
});
