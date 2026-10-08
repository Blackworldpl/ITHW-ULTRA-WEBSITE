import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('First login: temporary credentials, mandatory self-change and revoked sessions',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const target=process.env.TEST_DATABASE_URL!;
 assert.ok(new URL(target).pathname.endsWith('_test'));assert.notEqual(target,process.env.DATABASE_URL);
 process.env.DATABASE_URL=target;process.env.APP_URL='http://localhost:3000';Object.assign(process.env,{NODE_ENV:'test'});
 const {NextRequest,NextResponse}=await import('next/server'),route=await import('../src/app/api/[...path]/route'),auth=await import('../src/server/auth'),{query,pool}=await import('../src/server/db'),{hashPassword}=await import('../src/server/passwords');
 const uid=randomUUID().slice(0,8),temporary='Fictional temporary password '+uid,newPassword='Fictional personal password '+uid;
 type Session={cookie:string;csrf:string;id:string};
 const json=async(response:Response)=>(await response.json()).data;
 async function call(method:'GET'|'POST'|'PATCH',path:string,body?:unknown,who?:Session,origin='http://localhost:3000',csrf=true){
  const headers:Record<string,string>={};if(who){headers.cookie=who.cookie;if(csrf)headers['x-csrf-token']=who.csrf;}
  if(method!=='GET'){headers.origin=origin;headers['content-type']='application/json';}
  return route[method](new NextRequest('http://localhost:3000/api/'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({path:path.split('?')[0].split('/')})});
 }
 async function login(email:string,password=temporary){const response=await call('POST','auth/login',{email,password});assert.equal(response.status,200);const user=await json(response);return {user,session:{cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:user.csrfToken,id:user.id} as Session};}
 const adminEmail='onboarding-admin-'+uid+'@example.test';
 try{
  await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN')",['Fictional onboarding administrator',adminEmail,await hashPassword(temporary)]);
  const admin=(await login(adminEmail)).session;
  await t.test('default first login gates every protected API and removes effective permissions',async()=>{
   for(const role of ['VIEWER','IT_USER','IT_ADVANCED','ADMIN']){
    const email='onboarding-provisioned-'+role.toLowerCase()+'-'+uid+'@example.test';
    const created=await call('POST','admin/users',{name:'Fictional '+role,email,password:temporary,role},admin);assert.equal(created.status,201);const account=await json(created);assert.equal(account.mustChangePassword,true);assert.equal(account.password_hash,undefined);
    const {user,session}=await login(email);assert.equal(user.mustChangePassword,true);assert.deepEqual(user.permissions,[]);
    const me=await call('GET','auth/me',undefined,session);assert.equal(me.status,200);assert.equal((await json(me)).mustChangePassword,true);
    for(const [method,path,body] of [['GET','inventory',undefined],['GET','lookups',undefined],['GET','admin/users',undefined],['GET','qr?type=asset&id=ITHW-00000001',undefined],['POST','inventory',{name:'Forbidden'}]] as const){const blocked=await call(method,path,body,session);assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'PASSWORD_CHANGE_REQUIRED');}
    await assert.rejects(auth.getSession(new NextRequest('http://localhost:3000/api/auth/me',{headers:{cookie:session.cookie}})),(error:any)=>error.code==='PASSWORD_CHANGE_REQUIRED');
    assert.equal((await call('POST','auth/logout',undefined,session)).status,200);
   }
  });
  await t.test('confirmed change is atomic, clears all sessions, rejects old password and in-flight logins',async()=>{
   const email='onboarding-change-'+uid+'@example.test';
   await call('POST','admin/users',{name:'Fictional own password',email,password:temporary,role:'IT_USER'},admin);
   const first=await login(email),second=await login(email),staleUser=await auth.authenticate({email,password:temporary});
   const payload={currentPassword:temporary,newPassword,confirmation:newPassword};
   assert.equal((await call('POST','auth/change-password',payload)).status,401);
   assert.equal((await call('POST','auth/change-password',payload,first.session,'https://untrusted.example')).status,403);
   assert.equal((await call('POST','auth/change-password',payload,first.session,undefined,false)).status,403);
   assert.equal((await call('POST','auth/change-password',{...payload,confirmation:'Fictional different confirmation'},first.session)).status,400);
   assert.equal((await call('POST','auth/change-password',{...payload,newPassword:'short',confirmation:'short'},first.session)).status,400);
   assert.equal((await call('POST','auth/change-password',{...payload,currentPassword:'Fictional incorrect current password'},first.session)).status,400);
   assert.equal((await call('POST','auth/change-password',{currentPassword:temporary,newPassword:temporary,confirmation:temporary},first.session)).status,400);
   assert.equal((await call('POST','auth/change-password',{...payload,userId:admin.id},first.session)).status,400);
   const changed=await call('POST','auth/change-password',payload,first.session);assert.equal(changed.status,200);assert.match(changed.headers.get('set-cookie')!,/Max-Age=0/i);
   for(const session of [first.session,second.session])assert.equal((await call('GET','auth/me',undefined,session)).status,401);
   await assert.rejects(auth.issueSession(new NextResponse(),staleUser),(error:any)=>error.status===401);
   assert.equal((await call('POST','auth/login',{email,password:temporary})).status,401);
   const ready=await login(email,newPassword);assert.equal(ready.user.mustChangePassword,false);assert.ok(ready.user.permissions.includes('inventory.view'));assert.equal((await call('GET','inventory',undefined,ready.session)).status,200);
   const row=(await query('SELECT must_change_password,password_version,password_changed_at FROM users WHERE id=$1',[ready.user.id])).rows[0];assert.equal(row.must_change_password,false);assert.equal(row.password_version,2);assert.ok(row.password_changed_at);
   const logs=(await query("SELECT after_data FROM audit_logs WHERE entity_id=$1 AND action='CHANGE_OWN_PASSWORD'",[ready.user.id])).rows;assert.deepEqual(logs,[{after_data:{firstLogin:true}}]);assert.ok(!JSON.stringify(logs).includes(temporary));assert.ok(!JSON.stringify(logs).includes(newPassword));
   assert.equal((await call('POST','auth/change-password',{currentPassword:newPassword,newPassword:newPassword+' second',confirmation:newPassword+' second'},ready.session)).status,200);
  });
  await t.test('admin reset and force-next-login preserve access boundaries',async()=>{
   const email='onboarding-reset-'+uid+'@example.test';
   const account=await json(await call('POST','admin/users',{name:'Fictional optional first login',email,password:temporary,role:'VIEWER',mustChangePassword:false},admin));assert.equal(account.mustChangePassword,false);
   const viewer=await login(email);assert.equal((await call('GET','inventory',undefined,viewer.session)).status,200);
   assert.equal((await call('POST','admin/users',{name:'Forbidden',email:'forbidden-'+uid+'@example.test',password:temporary,role:'ADMIN'},viewer.session)).status,403);
   assert.equal((await call('PATCH','admin/users/'+account.id,{mustChangePassword:true},admin)).status,200);assert.equal((await call('GET','auth/me',undefined,viewer.session)).status,401);
   const pending=await login(email);assert.equal(pending.user.mustChangePassword,true);
   assert.equal((await call('PATCH','admin/users/'+account.id,{mustChangePassword:false},admin)).status,409);
   const reset='Fictional reset credential '+uid;assert.equal((await call('PATCH','admin/users/'+account.id,{password:reset},admin)).status,200);assert.equal((await call('GET','auth/me',undefined,pending.session)).status,401);
   const resetLogin=await login(email,reset);assert.equal(resetLogin.user.mustChangePassword,true);assert.equal((await call('GET','inventory',undefined,resetLogin.session)).status,403);
   assert.equal((await call('POST','auth/change-password',{currentPassword:reset,newPassword,confirmation:newPassword},resetLogin.session)).status,200);
   await call('PATCH','admin/users/'+account.id,{active:false},admin);assert.equal((await call('POST','auth/login',{email,password:newPassword})).status,401);
  });
  await t.test('two simultaneous changes accept one password and no stale session survives',async()=>{
   const email='onboarding-concurrent-'+uid+'@example.test';await call('POST','admin/users',{name:'Fictional concurrent account',email,password:temporary,role:'IT_USER'},admin);
   const one=await login(email),two=await login(email),passwords=[newPassword+' A',newPassword+' B'];
   const results=await Promise.all([one,two].map((login,index)=>call('POST','auth/change-password',{currentPassword:temporary,newPassword:passwords[index],confirmation:passwords[index]},login.session)));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);const winner=results.findIndex(r=>r.status===200);assert.equal((await call('POST','auth/login',{email,password:passwords[1-winner]})).status,401);assert.equal((await login(email,passwords[winner])).user.mustChangePassword,false);
  });
  await t.test('invitation activation starts with a personal password and remains single use',async()=>{
   const email='onboarding-invite-'+uid+'@example.test',invite=await json(await call('POST','admin/users/invite',{name:'Fictional invited user',email,role:'IT_USER'},admin)),token=new URL(invite.url).searchParams.get('token')!;
   const accepted=await call('POST','invite',{token,password:newPassword});assert.equal(accepted.status,201);const account=await json(accepted);assert.equal(account.mustChangePassword,false);assert.equal((await call('POST','invite',{token,password:newPassword})).status,410);
   const own:Session={cookie:accepted.headers.get('set-cookie')!.split(';')[0],csrf:account.csrfToken,id:account.id};assert.equal((await call('GET','inventory',undefined,own)).status,200);
  });
 }finally{await pool.end();}
});
