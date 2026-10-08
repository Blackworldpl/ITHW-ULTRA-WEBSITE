import {randomBytes,randomInt} from 'node:crypto';
import type {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import type {User} from '@/shared/types';
import type {TvPairingCode,TvPairingState} from '@/shared/devices';
import {query,transaction} from './db';
import {parse,uuidSchema} from './validation';
import {AppError} from './errors';
import {requireRole,throttle} from './auth';
import {requirePermission} from './permissions';
import {digest} from './passwords';
import {deviceCookieName,validateConfig} from './devices';

const pendingCookie=(id:string)=>'ith-device-pending-'+id;
const cookieOptions=(id:string,maxAge:number)=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict' as const,path:'/api/device/'+id,maxAge});
const browserToken=(request:NextRequest,id:string)=>{const token=request.cookies.get(pendingCookie(id))?.value;return token&&/^[a-f0-9]{64}$/.test(token)?token:null;};

export async function beginTvPairing(id:string,request:NextRequest,response:NextResponse):Promise<TvPairingCode>{
 parse(uuidSchema,id);await throttle('tv-pair-global',300,60);await throttle('tv-pair:'+id,8,900);
 const secret=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+15*60*1000).toISOString(),previous=browserToken(request,id);
 const result=await transaction(async client=>{
  const device=(await client.query('SELECT kind,enabled FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!device||device.kind!=='TV')throw new AppError(404,'Nie znaleziono TV.');if(!device.enabled)throw new AppError(403,'TV jest wyłączony. Poproś administratora o włączenie.');
  await client.query('DELETE FROM device_pairing_requests WHERE expires_at<now()');
  if(previous)await client.query('DELETE FROM device_pairing_requests WHERE device_id=$1 AND browser_token_hash=$2 AND approved_at IS NULL',[id,digest(previous)]);
  if((await client.query("SELECT count(*)::int AS count FROM device_pairing_requests WHERE device_id=$1 AND approved_at IS NULL",[id])).rows[0].count>=8)throw new AppError(429,'Dla tego TV oczekuje zbyt wiele kodów. Spróbuj po ich wygaśnięciu.');
  for(let attempt=0;attempt<10;attempt++){
   const code=String(randomInt(0,1000000)).padStart(6,'0');
   const saved=await client.query('INSERT INTO device_pairing_requests(device_id,code_hash,browser_token_hash,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(code_hash) DO NOTHING RETURNING id',[id,digest('tv:'+code),digest(secret),expiresAt]);
   if(saved.rowCount)return {code,expiresAt};
  }
  throw new AppError(503,'Nie udało się przygotować kodu. Spróbuj ponownie.');
 });
 response.cookies.set(pendingCookie(id),secret,cookieOptions(id,15*60));return result;
}

export async function approveTvPairing(id:string,body:unknown,user:User){
 requireRole(user,['ADMIN']);requirePermission(user,'device.manage');parse(uuidSchema,id);
 const input=parse(z.object({code:z.string().trim().regex(/^\d{6}$/),version:z.number().int().positive()}).strict(),body);
 await throttle('tv-approval:'+user.id,30,900);
 return transaction(async client=>{
  const device=(await client.query('SELECT name,kind,enabled,configuration,version FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!device||device.kind!=='TV')throw new AppError(404,'Nie znaleziono TV.');if(!device.enabled)throw new AppError(409,'Najpierw włącz TV.');if(device.version!==input.version)throw new AppError(409,'TV zmienił się. Otwórz parowanie ponownie.');
  const pending=(await client.query('SELECT id,browser_token_hash FROM device_pairing_requests WHERE device_id=$1 AND code_hash=$2 AND expires_at>now() AND approved_at IS NULL FOR UPDATE',[id,digest('tv:'+input.code)])).rows[0];
  if(!pending)throw new AppError(400,'Kod nie pasuje do tego TV, wygasł lub został już użyty.');
  await validateConfig(device.configuration,'TV',user);
  await client.query("UPDATE managed_devices SET token_hash=$2,csrf_token=$3,session_expires_at=now()+interval '180 days',pairing_code_hash=NULL,pairing_expires_at=NULL,paired_at=now(),configured_by=$4,version=version+1,updated_at=now() WHERE id=$1",[id,pending.browser_token_hash,randomBytes(32).toString('hex'),user.id]);
  await client.query('UPDATE device_pairing_requests SET approved_at=now() WHERE id=$1',[pending.id]);
  await client.query('DELETE FROM device_pairing_requests WHERE device_id=$1 AND id<>$2 AND approved_at IS NULL',[id,pending.id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1,'APPROVE_TV','managed_device',$2,$3)",[user.id,id,`Administrator potwierdził przeglądarkę TV ${device.name}.`]);
  return {paired:true};
 });
}

export async function tvPairingStatus(id:string,request:NextRequest,response:NextResponse):Promise<TvPairingState>{
 parse(uuidSchema,id);const token=browserToken(request,id);if(!token)return {status:'expired'};
 return transaction(async client=>{
  const device=(await client.query('SELECT kind,enabled,token_hash FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!device||device.kind!=='TV')throw new AppError(404,'Nie znaleziono TV.');if(!device.enabled)throw new AppError(403,'TV jest wyłączony.');
  const pending=(await client.query('SELECT id,expires_at,approved_at FROM device_pairing_requests WHERE device_id=$1 AND browser_token_hash=$2 FOR UPDATE',[id,digest(token)])).rows[0];
  if(!pending||new Date(pending.expires_at).getTime()<Date.now())return {status:'expired'};
  if(!pending.approved_at)return {status:'waiting'};
  if(device.token_hash!==digest(token))return {status:'replaced'};
  response.cookies.set(deviceCookieName(id),token,cookieOptions(id,180*24*3600));response.cookies.set(pendingCookie(id),'',cookieOptions(id,0));
  await client.query('UPDATE device_pairing_requests SET claimed_at=COALESCE(claimed_at,now()) WHERE id=$1',[pending.id]);
  return {status:'approved'};
 });
}
