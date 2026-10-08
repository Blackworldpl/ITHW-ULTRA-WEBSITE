import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
test('Rebuild: persistent product workflows and granular access',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const target=process.env.TEST_DATABASE_URL!;assert.ok(new URL(target).pathname.endsWith('_test'));assert.notEqual(target,process.env.DATABASE_URL);process.env.DATABASE_URL=target;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const uid=randomUUID().slice(0,8),password='Fictional product integration!',sessions:Record<string,{cookie:string;csrf:string;id:string;email:string}>={};
 async function call(method:'GET'|'POST'|'PATCH',path:string,body?:unknown,who='ADMIN',extras:Record<string,string>={}){
  const session=sessions[who],headers:Record<string,string>={...extras};if(session){headers.cookie=session.cookie;headers['x-csrf-token']=session.csrf;}if(method!=='GET'){headers.origin='http://localhost:3000';headers['content-type']??=body instanceof Uint8Array?'application/octet-stream':'application/json';}
  return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function data(response:Response){const payload=await response.json();assert.ok(response.ok,JSON.stringify(payload));return payload.data;}
 async function login(who:string){const email=sessions[who]?.email??'product-'+who.toLowerCase()+'-'+uid+'@example.test';const response=await call('POST','auth/login',{email,password},'none'),value=await data(response);sessions[who]={cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:value.csrfToken,id:value.id,email};return value;}
 try{
  for(const role of ['ADMIN','VIEWER','IT_USER','IT_ADVANCED']){const email='product-'+role.toLowerCase()+'-'+uid+'@example.test';await query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)',['Product '+role+' '+uid,email,await hashPassword(password),role]);await login(role);}
  const category=await data(await call('POST','admin/categories',{name:'Synthetic product category '+uid})),site=await data(await call('POST','admin/locations',{name:'Product site '+uid})),other=await data(await call('POST','admin/locations',{name:'Other product site '+uid}));
  const fixtureMac='02:'+uid.match(/.{2}/g)!.join(':')+':01',fixtureIp='2001:db8::'+uid.slice(0,4)+':'+uid.slice(4);
  const create=async(suffix:string,locationId=site.id)=>data(await call('POST','assets',{name:'Synthetic computer '+suffix+' '+uid,categoryId:category.id,serialNumber:'PRODUCT-SN-'+uid+'-'+suffix,rfidTag:'PRODUCT-RFID-'+uid+'-'+suffix,locationId,status:'AVAILABLE',hostname:'test-host-'+uid+'-'+suffix,macAddress:suffix==='a'?fixtureMac:null,ipAddress:suffix==='a'?fixtureIp:null}));
  let a=await create('a'),b=await create('b'),outside=await create('outside',other.id),config:any;
  await t.test('configuration versions, replay, immutable bytes and asset assignment',async()=>{
   const body={name:'Synthetic switch configuration '+uid,content:'hostname fixture\ninterface eth0\n',releaseNotes:'First version',requestId:randomUUID()};
   assert.equal((await call('POST','configs',body,'VIEWER')).status,403);
   config=await data(await call('POST','configs',body));assert.equal(config.latestVersion,1);assert.equal((await data(await call('POST','configs',body))).id,config.id);
   const v1=config.versions[0],second={...body,version:1,content:'hostname revised\n',releaseNotes:'New version',requestId:randomUUID()};config=await data(await call('PATCH','configs/'+config.id,second));assert.equal(config.latestVersion,2);assert.equal(config.versions.length,2);
   assert.equal((await call('PATCH','configs/'+config.id,{...second,requestId:randomUUID()})).status,409);
   assert.equal((await data(await call('GET','configs/'+config.id+'?versionId='+v1.id))).content,body.content);
   assert.equal(await (await call('GET','configs/'+config.id+'/download?versionId='+v1.id)).text(),body.content);
   await assert.rejects(query('UPDATE configuration_versions SET version=$2 WHERE id=$1',[v1.id,'mutated']),/histor/i);
   assert.equal((await call('POST','configs',{...body,content:'bad\u0000file',requestId:randomUUID()})).status,400);
   assert.equal((await call('POST','configs/'+config.id+'/apply',{assetId:a.id,assetVersion:a.version,versionId:config.versions[0].id})).status,200);
   a=await data(await call('GET','assets/'+a.assetId));const assigned=await data(await call('GET','assets/'+a.assetId+'/configurations'));assert.equal(assigned[0].version,'2');
   const log=await query("SELECT after_data::text FROM audit_logs WHERE entity_type='configuration' AND entity_id=$1",[config.id]);assert.ok(log.rows.every(r=>!r.after_data.includes('hostname')));
  });
  await t.test('document bytes, idempotency, bounded upload and protected download scope',async()=>{
   const requestId=randomUUID(),bytes=Buffer.from('Fictional technical document\n'),path='documents?assetId='+a.id+'&requestId='+requestId,headers={'x-file-name':'Synthetic-'+uid+'.txt'};
   const doc=await data(await call('POST',path,bytes,'ADMIN',headers));assert.equal((await data(await call('POST',path,bytes,'ADMIN',headers))).id,doc.id);
   assert.equal((await call('POST',path,Buffer.from('changed'),'ADMIN',headers)).status,409);
   assert.equal((await call('POST','documents?requestId='+randomUUID(),bytes,'VIEWER',headers)).status,403);
   assert.deepEqual(Buffer.from(await (await call('GET','documents/'+doc.id)).arrayBuffer()),bytes);
   assert.equal((await call('GET','documents/'+config.versions[0].attachmentId)).status,404);
   assert.equal((await call('POST','documents?requestId='+randomUUID(),Buffer.from([0,1,2]),'ADMIN',headers)).status,400);
   assert.ok((await data(await call('GET','documents?assetId='+a.id))).some((d:any)=>d.id===doc.id));
  });
  await t.test('inventory snapshot, concurrent replay, unknown/duplicate/unexpected readings and frozen report',async()=>{
   const startBody={locationId:site.id,requestId:randomUUID()};assert.equal((await call('POST','stocktakes',startBody,'VIEWER')).status,403);
   let scan=await data(await call('POST','stocktakes',startBody,'IT_USER'));assert.equal(scan.expected,2);assert.equal((await data(await call('POST','stocktakes',startBody,'IT_USER'))).id,scan.id);
   const late=await create('late'),readBody={code:a.rfidTag,requestId:randomUUID()};
   const concurrent=await Promise.all([call('POST','stocktakes/'+scan.id+'/scan',readBody,'IT_USER'),call('POST','stocktakes/'+scan.id+'/scan',readBody,'IT_USER')]);
   const first=await data(concurrent[0]),replay=await data(concurrent[1]);assert.equal(first.event.id,replay.event.id);
   assert.equal(first.event.assetId,a.assetId);assert.ok(first.event.createdAt);assert.equal(first.scan.observed,1);assert.ok(!('snapshot' in first.scan));assert.ok(!('events' in first.scan));assert.ok(JSON.stringify(first).length<2000);
   for(const code of [a.assetId,outside.assetId,late.assetId,'UNKNOWN-TEST-'+uid])scan=(await data(await call('POST','stocktakes/'+scan.id+'/scan',{code,requestId:randomUUID()},'IT_USER'))).scan;
   scan=await data(await call('GET','stocktakes/'+scan.id,undefined,'IT_USER'));
   assert.equal(scan.observed,1);assert.equal(scan.missing,1);assert.equal(scan.unexpected,2);assert.equal(scan.duplicates,1);assert.equal(scan.unknown,1);assert.equal(scan.events.length,5);
   assert.equal((await call('POST','stocktakes/'+scan.id+'/scan',{code:'https://untrusted.example/asset/'+a.assetId,requestId:randomUUID()},'IT_USER')).status,400);
   assert.equal((await call('POST','stocktakes/'+scan.id+'/finish',{version:1},'IT_USER')).status,409);
   const report=await data(await call('POST','stocktakes/'+scan.id+'/finish',{version:scan.version},'IT_USER'));assert.equal(report.status,'COMPLETED');
   assert.equal((await call('POST','stocktakes/'+scan.id+'/scan',{code:b.assetId,requestId:randomUUID()},'IT_USER')).status,409);
   a=await data(await call('GET','assets/'+a.assetId));const version=a.version;a=await data(await call('POST','assets/'+a.assetId+'/actions',{action:'move',locationId:other.id,version}));
   assert.deepEqual(await data(await call('GET','stocktakes/'+scan.id,undefined,'IT_USER')),report);assert.equal((await call('GET','stocktakes/'+scan.id+'/export',undefined,'IT_USER')).status,200);
   await assert.rejects(query('DELETE FROM inventory_scan_events WHERE scan_id=$1',[scan.id]),/histor/i);
  });
  await t.test('bulk move rollback, stale version, replay and one history event per changed asset',async()=>{
   const bad={action:'move',locationId:site.id,items:[{assetId:a.assetId,version:a.version},{assetId:b.assetId,version:b.version+99}],requestId:randomUUID()};
   assert.equal((await call('POST','assets/bulk',bad)).status,409);assert.equal((await data(await call('GET','assets/'+a.assetId))).locationId,other.id);
   const body={...bad,items:[{assetId:a.assetId,version:a.version},{assetId:b.assetId,version:b.version}],requestId:randomUUID()};
   assert.equal((await call('POST','assets/bulk',body,'IT_USER')).status,403);const value=await data(await call('POST','assets/bulk',body));assert.equal(value.changed,1);assert.equal((await data(await call('POST','assets/bulk',body))).changed,1);
   a=await data(await call('GET','assets/'+a.assetId));assert.equal(a.locationId,site.id);assert.equal((await call('GET','assets/selection.csv?ids='+a.assetId+','+b.assetId)).status,200);
   const contents=await data(await call('GET','locations/'+site.id));assert.ok(contents.assets.some((item:any)=>item.assetId===a.assetId));assert.ok(contents.activity.some((event:any)=>event.action==='MOVE_ASSET'));
  });
  await t.test('incident versions, real operational counters, search ranking and scanner history',async()=>{
   const body={title:'Synthetic keyboard failure '+uid,assetId:a.assetId,priority:'CRITICAL',requestId:randomUUID()};
   assert.equal((await call('POST','incidents',body,'VIEWER')).status,403);const incident=(await data(await call('POST','incidents',body,'IT_USER'))).incident;assert.equal((await data(await call('POST','incidents',body,'IT_USER'))).incident.id,incident.id);
   const ops=await data(await call('GET','operations'));assert.ok(ops.criticalIncidents>=1);assert.ok(ops.recentIncidents.some((x:any)=>x.id===incident.id));
   const update={...body,status:'RESOLVED',version:incident.version,requestId:randomUUID()};await data(await call('PATCH','incidents/'+incident.id,update,'IT_USER'));assert.equal((await call('PATCH','incidents/'+incident.id,{...update,requestId:randomUUID()},'IT_USER')).status,409);
   for(const term of [a.assetId,a.rfidTag,a.hostname,a.macAddress,a.ipAddress])assert.ok((await data(await call('GET','search?q='+encodeURIComponent(term)))).some((r:any)=>r.type==='asset'&&r.id===a.assetId),term);
   assert.equal((await data(await call('GET','search?q='+a.assetId)))[0].id,a.assetId);
   assert.ok((await data(await call('GET','search?q='+encodeURIComponent(sessions.ADMIN.email)))).some((r:any)=>r.type==='user'&&r.id===sessions.ADMIN.id));
   assert.ok((await data(await call('GET','search?q='+encodeURIComponent('synthetic keybord failure')))).some((r:any)=>r.id===incident.id));
   const qr=(await query('SELECT id FROM qr_codes WHERE asset_id=$1',[a.id])).rows[0].id;const read={code:qr,requestId:randomUUID()},one=await data(await call('POST','scan/observe',read,'VIEWER'));assert.equal(one.href,'/asset/'+a.assetId);await data(await call('POST','scan/observe',read,'VIEWER'));
   const before=(await query("SELECT count(*)::int AS count FROM asset_history WHERE asset_id=$1 AND action='QR_SCANNED'",[a.id])).rows[0].count;assert.equal(before,1);
   assert.equal((await call('POST','scan/observe',{code:'javascript:alert(1)',requestId:randomUUID()},'VIEWER')).status,400);
  });
  await t.test('custom role denies field bypass, download, scan disclosure and revokes sessions',async()=>{
   const account=await data(await call('POST','admin/users',{name:'Restricted product '+uid,email:'restricted-'+uid+'@example.test',password,role:'IT_ADVANCED',mustChangePassword:false}));sessions.RESTRICTED={email:account.email} as any;await login('RESTRICTED');
   const profile=await data(await call('POST','admin/permissions',{name:'Restricted profile '+uid,baseRole:'IT_ADVANCED',permissions:['asset.view','asset.edit','asset.history','config.view','location.view','rfid.scan']}));
   assert.equal((await call('PATCH','admin/users/'+account.id+'/access',{roleId:profile.id})).status,200);assert.equal((await call('GET','auth/me',undefined,'RESTRICTED')).status,401);
   const effective=await login('RESTRICTED');assert.equal(effective.customRoleName,profile.name);assert.ok(!effective.permissions.includes('asset.move'));
   assert.equal((await call('PATCH','assets/'+a.assetId,{locationId:other.id,version:a.version},'RESTRICTED')).status,403);
   assert.equal((await call('PATCH','assets/'+a.assetId,{owner:'Unauthorized',version:a.version},'RESTRICTED')).status,403);
   assert.equal((await call('POST','assets/'+a.assetId+'/actions',{action:'rfid',version:a.version,rfidTag:'new'},'RESTRICTED')).status,403);
   assert.equal((await call('GET','configs/'+config.id+'/download',undefined,'RESTRICTED')).status,403);
   assert.equal((await call('GET','invoices',undefined,'RESTRICTED')).status,403);
   assert.ok((await data(await call('GET','search?q=synthetic',undefined,'RESTRICTED'))).every((r:any)=>['asset','config','location'].includes(r.type)));
   const noAssets=await data(await call('POST','admin/permissions',{name:'No records profile '+uid,baseRole:'VIEWER',permissions:['rfid.scan']}));
   await data(await call('PATCH','admin/users/'+account.id+'/access',{roleId:noAssets.id}));await login('RESTRICTED');assert.equal((await call('POST','scan/observe',{code:a.assetId,requestId:randomUUID()},'RESTRICTED')).status,403);
   const dash=await data(await call('GET','dashboard',undefined,'RESTRICTED'));assert.equal(dash.totalAssets,0);assert.equal(dash.inventoryCount,0);assert.equal(dash.activity.length,0);assert.equal((await data(await call('GET','lookups',undefined,'RESTRICTED'))).locations.length,0);
   assert.equal((await call('GET','scan/resolve?code='+a.assetId,undefined,'RESTRICTED')).status,403);
   assert.equal((await call('PATCH','admin/users/'+sessions.ADMIN.id+'/access',{roleId:profile.id})).status,409);
   await data(await call('PATCH','admin/users/'+account.id,{role:'IT_USER'}));const normal=await login('RESTRICTED');assert.equal(normal.customRoleId,null);assert.ok(normal.permissions.includes('asset.assign'));
   assert.ok((await data(await call('GET','admin/users'))).find((u:any)=>u.id===account.id).lastLoginAt);
  });
  await t.test('one-use invitation, expiry and HTTPS portal settings with optimistic version',async()=>{
   const invite=await data(await call('POST','admin/users/invite',{name:'Invited product '+uid,email:'invite-product-'+uid+'@example.test',role:'IT_USER'})),token=new URL(invite.url).searchParams.get('token')!;
   assert.ok((await data(await call('GET','invite?token='+token,undefined,'none'))).email.includes(uid));
   const response=await call('POST','invite',{token,password},'none');assert.equal(response.status,201);assert.equal((await call('POST','invite',{token,password},'none')).status,410);
   const expired=await data(await call('POST','admin/users/invite',{name:'Expired product '+uid,email:'expired-product-'+uid+'@example.test',role:'VIEWER'}));await query("UPDATE user_invitations SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.id]);assert.equal((await call('GET','invite?token='+new URL(expired.url).searchParams.get('token'),undefined,'none')).status,410);
   const settings=await data(await call('GET','admin/settings'));assert.equal((await call('PATCH','admin/settings',{version:settings.version,serviceNowUrl:'http://unsafe.example'})).status,400);
   const next=await data(await call('PATCH','admin/settings',{version:settings.version,serviceNowUrl:'https://example.service-now.com/'}));assert.equal(next.version,settings.version+1);assert.equal((await data(await call('GET','lookups'))).serviceNowUrl,next.serviceNowUrl);
   assert.equal((await call('PATCH','admin/settings',{version:settings.version,serviceNowUrl:null})).status,409);
  });
 }finally{await pool.end();}
});
