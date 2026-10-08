import {randomBytes,randomInt} from 'node:crypto';
import type {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import type {User,Role} from '@/shared/types';
import {effectivePermissions,hasPermission,type Permission} from '@/shared/permissions';
import {defaultDeviceConfig,tvDashboard,tvMetricLabels,tvIncidentFieldLabels,terminalConfig,terminalAssetFieldLabels,terminalInventoryFieldLabels,terminalCounterLabels,type DeviceConfig,type DevicePairing,type DeviceScreenData,type DeviceReading,type ManagedDevice} from '@/shared/devices';
import {query,transaction} from './db';
import {parse,uuidSchema} from './validation';
import {AppError} from './errors';
import {requirePermission} from './permissions';
import {requireRole,throttle} from './auth';
import {digest,equalSecret} from './passwords';
import {observeIdentifier} from './scans';
import {scanStocktake,stocktakeSummary} from './stocktakes';
import {tvDashboardData} from './tv-dashboard';
import {terminalInventory,terminalReading} from './device-terminal';
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const projection=`d.id,d.name,d.kind,d.asset_id AS "assetId",a.name AS "assetName",d.enabled,d.configuration AS config,d.version,(d.token_hash IS NOT NULL AND d.session_expires_at>now()) AS paired,d.paired_at AS "pairedAt",d.last_seen_at AS "lastSeenAt",d.pairing_expires_at AS "pairingExpiresAt",d.created_at AS "createdAt"`;
const from='FROM managed_devices d LEFT JOIN assets a ON a.id=d.asset_id';
const unique=<T,>(values:T[])=>new Set(values).size===values.length;
const tvSchema=z.object({
 metrics:z.array(z.enum(Object.keys(tvMetricLabels) as [keyof typeof tvMetricLabels,...(keyof typeof tvMetricLabels)[]])).max(9).refine(unique,'Liczniki nie mogą się powtarzać.'),
 incidentStatuses:z.array(z.enum(['OPEN','ASSIGNED','WAITING','RESOLVED'])).min(1).max(4).refine(unique),incidentPriorities:z.array(z.enum(['LOW','NORMAL','HIGH','CRITICAL'])).min(1).max(4).refine(unique),
 incidentFields:z.array(z.enum(Object.keys(tvIncidentFieldLabels) as [keyof typeof tvIncidentFieldLabels,...(keyof typeof tvIncidentFieldLabels)[]])).max(5).refine(unique),
 categoryId:uuidSchema.nullable(),includeChildren:z.boolean(),incidentLimit:z.number().int().min(1).max(50),incidentSort:z.enum(['priority','newest','oldest']),
 sectionOrder:z.array(z.enum(['message','statistics','incidents'])).length(3).refine(unique,'Każda sekcja musi wystąpić raz.'),columns:z.union([z.literal(1),z.literal(2),z.literal(3)]),textSize:z.enum(['standard','large','xlarge']),
 pageSize:z.number().int().min(1).max(12),rotateSeconds:z.number().int().min(10).max(120),showClock:z.boolean()
}).strict();
const scannerSchema=z.object({
 assetFields:z.array(z.enum(Object.keys(terminalAssetFieldLabels) as [keyof typeof terminalAssetFieldLabels,...(keyof typeof terminalAssetFieldLabels)[]])).max(5).refine(unique),
 inventoryFields:z.array(z.enum(Object.keys(terminalInventoryFieldLabels) as [keyof typeof terminalInventoryFieldLabels,...(keyof typeof terminalInventoryFieldLabels)[]])).max(4).refine(unique),
 counters:z.array(z.enum(Object.keys(terminalCounterLabels) as [keyof typeof terminalCounterLabels,...(keyof typeof terminalCounterLabels)[]])).max(6).refine(unique),
 showCode:z.boolean(),showHistory:z.boolean(),historyLimit:z.number().int().min(1).max(100),showCamera:z.boolean(),textSize:z.enum(['standard','large']),
 inputLabel:z.string().trim().min(1).max(120),inputPlaceholder:z.string().trim().min(1).max(160)
}).strict();
const configSchema=z.object({
 mode:z.enum(['OVERVIEW','INCIDENTS','MESSAGE','LOOKUP','CONTINUOUS','INVENTORY']),theme:z.enum(['light','dark']),
 title:z.string().trim().max(160),locationId:uuidSchema.nullable(),stocktakeId:uuidSchema.nullable(),
 showStats:z.boolean(),showIncidents:z.boolean(),message:z.string().trim().max(2000),messageLevel:z.enum(['INFO','WARNING','CRITICAL']),
 refreshSeconds:z.number().int().min(5).max(60),tv:tvSchema.optional(),scanner:scannerSchema.optional()
}).strict();
const inputSchema=z.object({name:z.string().trim().min(2).max(120),kind:z.enum(['TV','SCANNER']),assetId:uuidSchema.nullable().default(null),config:configSchema.optional(),version:z.number().int().positive().optional()}).strict();
function manager(user:User){requireRole(user,['ADMIN']);requirePermission(user,'device.manage');}
export async function deviceSetup(id:string){parse(uuidSchema,id);const device=(await query<{kind:'TV'|'SCANNER';enabled:boolean}>('SELECT kind,enabled FROM managed_devices WHERE id=$1',[id])).rows[0];if(!device)throw new AppError(404,'Nie znaleziono urządzenia.');if(!device.enabled)throw new AppError(403,'Urządzenie jest wyłączone. Poproś administratora o włączenie.');return {kind:device.kind};}
export async function listDevices(user:User){requireRole(user,['ADMIN']);requirePermission(user,'device.view');return clean((await query<ManagedDevice>(`SELECT ${projection} ${from} ORDER BY d.created_at DESC`)).rows);}
export async function validateConfig(config:DeviceConfig,kind:string,user:User){
 const tv=['OVERVIEW','INCIDENTS','MESSAGE'].includes(config.mode);
 if(tv!==(kind==='TV'))throw new AppError(400,'Wybrany tryb nie pasuje do typu urządzenia.');
 if(config.locationId&&!(await query('SELECT id FROM locations WHERE id=$1',[config.locationId])).rowCount)throw new AppError(400,'Wybrana lokalizacja nie istnieje.');
 if(tv){const options=tvDashboard(config);if(options.categoryId&&!(await query('SELECT id FROM asset_categories WHERE id=$1',[options.categoryId])).rowCount)throw new AppError(400,'Wybrana kategoria nie istnieje.');if(config.mode==='OVERVIEW'&&config.showStats&&options.metrics.some(key=>key!=='openIncidents'&&key!=='criticalIncidents'))requirePermission(user,'asset.view');if(config.mode==='INCIDENTS'||config.mode==='OVERVIEW'&&(config.showIncidents||config.showStats&&options.metrics.some(key=>key==='openIncidents'||key==='criticalIncidents')))requirePermission(user,'incident.view');}
 else{requirePermission(user,'rfid.scan');requirePermission(user,'asset.view');}
 if(config.mode==='INVENTORY'){requirePermission(user,'inventory.run');if(!config.stocktakeId)throw new AppError(400,'Wybierz otwartą sesję inwentaryzacji.');const scan=await stocktakeSummary(config.stocktakeId);if(scan.status!=='OPEN')throw new AppError(409,'Wybierz otwartą sesję inwentaryzacji.');}
 else if(config.stocktakeId)throw new AppError(400,'Sesja inwentaryzacji jest dostępna tylko w trybie inwentaryzacji.');
}
function pairingValue(id:string,code:string){return digest(id+':'+code);}
function generatePairing(){return {code:String(randomInt(0,1000000)).padStart(6,'0'),expiresAt:new Date(Date.now()+15*60*1000).toISOString()};}
export async function saveDevice(id:string|null,body:unknown,user:User):Promise<ManagedDevice|DevicePairing>{
 manager(user);if(id)parse(uuidSchema,id);const input=parse(inputSchema,body),config=input.config??defaultDeviceConfig(input.kind);await validateConfig(config,input.kind,user);
 if(input.assetId&&!(await query('SELECT id FROM assets WHERE id=$1',[input.assetId])).rowCount)throw new AppError(400,'Nie znaleziono urządzenia w ewidencji.');
 const pairing=generatePairing();
 const device=await transaction(async client=>{
  const before=id?(await client.query('SELECT name,kind,configuration,version FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!before)throw new AppError(404,'Nie znaleziono ekranu.');if(id&&(before.version!==input.version||before.kind!==input.kind))throw new AppError(409,'Ekran zmienił się. Otwórz ponownie ustawienia.');
  const saved=id?(await client.query('UPDATE managed_devices SET name=$2,asset_id=$3,configuration=$4,configured_by=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING id',[id,input.name,input.assetId,JSON.stringify(config),user.id])).rows[0]:(await client.query('INSERT INTO managed_devices(name,kind,asset_id,configuration,created_by,configured_by) VALUES($1,$2,$3,$4,$5,$5) RETURNING id',[input.name,input.kind,input.assetId,JSON.stringify(config),user.id])).rows[0];
  if(!id&&input.kind==='SCANNER')await client.query('UPDATE managed_devices SET pairing_code_hash=$2,pairing_expires_at=$3 WHERE id=$1',[saved.id,pairingValue(saved.id,pairing.code),pairing.expiresAt]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,$2,'managed_device',$3,$4,$5,$6)",[user.id,id?'UPDATE_DEVICE':'CREATE_DEVICE',saved.id,`Zapisano ustawienia ekranu ${input.name}.`,before?JSON.stringify({name:before.name,config:before.configuration}):null,JSON.stringify({name:input.name,kind:input.kind,config})]);
  return clean((await client.query<ManagedDevice>(`SELECT ${projection} ${from} WHERE d.id=$1`,[saved.id])).rows[0]);
 });
 return id?device:{device,url:new URL('/device/'+device.id,process.env.APP_URL).toString(),...(input.kind==='TV'?{code:null,expiresAt:null}:pairing)};
}
export async function newPairing(id:string,body:unknown,user:User):Promise<DevicePairing>{
 manager(user);parse(uuidSchema,id);const {version}=parse(z.object({version:z.number().int().positive()}).strict(),body),pairing=generatePairing();
 const device=await transaction(async client=>{const row=(await client.query('SELECT version,enabled,kind FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono ekranu.');if(row.version!==version)throw new AppError(409,'Ekran zmienił się. Odśwież listę.');if(!row.enabled)throw new AppError(409,'Najpierw włącz urządzenie.');if(row.kind==='TV')return clean((await client.query<ManagedDevice>(`SELECT ${projection} ${from} WHERE d.id=$1`,[id])).rows[0]);
  await client.query('UPDATE managed_devices SET pairing_code_hash=$2,pairing_expires_at=$3,version=version+1 WHERE id=$1',[id,pairingValue(id,pairing.code),pairing.expiresAt]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1,'PAIRING_CODE','managed_device',$2,'Przygotowano nowy kod parowania ekranu.')",[user.id,id]);return clean((await client.query<ManagedDevice>(`SELECT ${projection} ${from} WHERE d.id=$1`,[id])).rows[0]);
 });return {device,url:new URL('/device/'+id,process.env.APP_URL).toString(),...(device.kind==='TV'?{code:null,expiresAt:null}:pairing)};
}
export async function setDeviceEnabled(id:string,body:unknown,user:User){
 manager(user);parse(uuidSchema,id);const input=parse(z.object({enabled:z.boolean(),version:z.number().int().positive()}).strict(),body);
 return transaction(async client=>{const before=(await client.query('SELECT enabled,version FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)throw new AppError(404,'Nie znaleziono ekranu.');if(before.version!==input.version)throw new AppError(409,'Ekran zmienił się. Odśwież listę.');
  await client.query('DELETE FROM device_pairing_requests WHERE device_id=$1',[id]);
  await client.query(`UPDATE managed_devices SET enabled=$2,token_hash=CASE WHEN $2 THEN token_hash ELSE NULL END,csrf_token=CASE WHEN $2 THEN csrf_token ELSE NULL END,session_expires_at=CASE WHEN $2 THEN session_expires_at ELSE NULL END,pairing_code_hash=NULL,pairing_expires_at=NULL,version=version+1,updated_at=now() WHERE id=$1`,[id,input.enabled]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'DEVICE_ACCESS','managed_device',$2,$3,$4,$5)",[user.id,id,input.enabled?'Włączono ekran; wymagane nowe parowanie.':'Wyłączono ekran i odwołano dostęp.',JSON.stringify({enabled:before.enabled}),JSON.stringify({enabled:input.enabled})]);return clean((await client.query<ManagedDevice>(`SELECT ${projection} ${from} WHERE d.id=$1`,[id])).rows[0]);
 });
}
export async function deleteDevice(id:string,body:unknown,user:User){
 manager(user);parse(uuidSchema,id);const {version}=parse(z.object({version:z.number().int().positive()}).strict(),body);
 return transaction(async client=>{
  const before=(await client.query('SELECT name,kind,asset_id AS "assetId",version FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!before)throw new AppError(404,'Nie znaleziono ekranu.');
  if(before.version!==version)throw new AppError(409,'Ekran zmienił się. Odśwież listę i potwierdź usunięcie ponownie.');
  await client.query('DELETE FROM managed_devices WHERE id=$1',[id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data) VALUES($1,'DELETE_DEVICE','managed_device',$2,$3,$4)",[user.id,id,`Usunięto ekran ${before.name} i odwołano dostęp jego przeglądarki.`,JSON.stringify(before)]);
  return {deleted:true};
 });
}
export function deviceCookieName(id:string){return 'ith-device-'+id;}
export async function pairDevice(id:string,body:unknown,response:NextResponse){
 parse(uuidSchema,id);const {code}=parse(z.object({code:z.string().trim().regex(/^\d{6}$/)}).strict(),body);await throttle('device-pair-global',300,60);await throttle('device-pair:'+id,8,900);
 const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
 await transaction(async client=>{const device=(await client.query('SELECT pairing_code_hash,pairing_expires_at,enabled,kind FROM managed_devices WHERE id=$1 FOR UPDATE',[id])).rows[0];if(device?.kind==='TV')throw new AppError(409,'Kod wyświetlony na TV zatwierdza administrator w panelu.');if(!device||!device.enabled||!device.pairing_code_hash||new Date(device.pairing_expires_at).getTime()<Date.now()||!equalSecret(device.pairing_code_hash,pairingValue(id,code)))throw new AppError(401,'Kod jest nieprawidłowy, wykorzystany lub wygasł. Poproś administratora o nowy.');
  await client.query("UPDATE managed_devices SET token_hash=$2,csrf_token=$3,session_expires_at=now()+interval '180 days',pairing_code_hash=NULL,pairing_expires_at=NULL,paired_at=now(),last_seen_at=now(),version=version+1 WHERE id=$1",[id,digest(token),csrf]);await client.query("INSERT INTO audit_logs(action,entity_type,entity_id,description) VALUES('PAIR_DEVICE','managed_device',$1,'Sparowano przeglądarkę urządzenia.')",[id]);
 });await query('DELETE FROM auth_rate_limits WHERE key=$1',['device-pair:'+id]);
 response.cookies.set(deviceCookieName(id),token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/device/'+id,maxAge:180*24*3600});
}
interface DeviceSession extends ManagedDevice {csrfToken:string;actor:User}
async function deviceSession(id:string,request:NextRequest,write=false):Promise<DeviceSession>{
 parse(uuidSchema,id);const token=request.cookies.get(deviceCookieName(id))?.value;if(!token||!/^[a-f0-9]{64}$/.test(token))throw new AppError(401,'Sparuj tę przeglądarkę kodem z panelu.');
 const row=(await query<ManagedDevice&{csrfToken:string;actorId:string;actorName:string;actorRole:Role;actorActive:boolean;customPermissions:Permission[]|null}>(`SELECT ${projection},d.csrf_token AS "csrfToken",u.id AS "actorId",u.name AS "actorName",u.role AS "actorRole",u.active AS "actorActive",p.permissions AS "customPermissions" ${from} JOIN users u ON u.id=d.configured_by LEFT JOIN permission_roles p ON p.id=u.permission_role_id WHERE d.id=$1 AND d.token_hash=$2 AND d.session_expires_at>now()`,[id,digest(token)])).rows[0];
 if(!row)throw new AppError(401,'Parowanie wygasło lub zostało zastąpione. Poproś o nowy kod.');
 const actor={id:row.actorId,name:row.actorName,role:row.actorRole,active:row.actorActive,permissions:effectivePermissions(row.actorRole,row.customPermissions)} as User;
 if(!row.enabled||!actor.active||actor.role!=='ADMIN'||!hasPermission(actor,'device.manage'))throw new AppError(403,'Dostęp urządzenia został wyłączony.');
 if(write&&!equalSecret(request.headers.get('x-device-csrf')??'',row.csrfToken))throw new AppError(403,'Sesja odczytu zmieniła się. Odśwież ekran.');
 return {...row,actor};
}
export async function deviceScreen(id:string,request:NextRequest):Promise<DeviceScreenData>{
 const session=await deviceSession(id,request),{config,actor}=session;
 const tv=session.kind==='TV'?await tvDashboardData(config,actor):{statistics:null,metrics:[],incidents:[],incidentCount:0};
 let inventory:DeviceScreenData['inventory']=null;
 if(session.kind==='SCANNER'&&config.mode==='INVENTORY'&&config.stocktakeId){requirePermission(actor,'inventory.run');requirePermission(actor,'asset.view');inventory=terminalInventory(await stocktakeSummary(config.stocktakeId),config);}
 await query('UPDATE managed_devices SET last_seen_at=now() WHERE id=$1',[id]);
 return clean({id:session.id,name:session.name,kind:session.kind,version:session.version,config,csrfToken:session.csrfToken,updatedAt:new Date().toISOString(),...tv,inventory});
}
export async function deviceScan(id:string,request:NextRequest,body:unknown):Promise<DeviceReading>{
 const session=await deviceSession(id,request,true);if(session.kind!=='SCANNER')throw new AppError(403,'Ten ekran nie jest terminalem skanującym.');const input=parse(z.object({code:z.string().trim().min(1).max(2048),requestId:uuidSchema,version:z.number().int().positive()}).strict(),body);if(input.version!==session.version)throw new AppError(409,'Ustawienia terminala zmieniły się. Odśwież ekran i ponownie odczytaj kod.');const reading={code:input.code,requestId:input.requestId};await throttle('device-scans:'+id,600,60);
 if(session.config.mode==='INVENTORY'&&session.config.stocktakeId){const result=await scanStocktake(session.config.stocktakeId,reading,session.actor);const options=terminalConfig(session.config),title=result.event.name??'Nieznany kod',details=result.event.assetId?await terminalReading('/asset/'+result.event.assetId,title,input.code,session.config):null;return {code:options.showCode?input.code:'',title,asset:details?.asset??null,event:{...result.event,code:options.showCode?result.event.code:'',assetId:options.assetFields.includes('assetId')?result.event.assetId:null},inventory:terminalInventory(result.scan,session.config)};}
 if(!['LOOKUP','CONTINUOUS'].includes(session.config.mode))throw new AppError(409,'Administrator zmienił tryb terminala. Odśwież ekran.');
 const result=await observeIdentifier(reading,session.actor);
 return clean(await terminalReading(result.href,result.title,input.code,session.config));
}
