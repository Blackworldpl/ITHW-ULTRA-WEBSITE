import {z} from 'zod';
import type {User} from '@/shared/types';
import type {InventoryScan,InventoryScanDetail,InventoryExpected,InventoryEvent} from '@/shared/product';
import {query,transaction} from './db';
import {parse,uuidSchema} from './validation';
import {requirePermission} from './permissions';
import {AppError} from './errors';
import {idempotent,resolveScan} from './services';
import {scanTarget} from '@/shared/scan';
import {csv} from './csv';
import type {PoolClient} from 'pg';
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const projection=`s.id,s.location_id AS "locationId",l.path AS "locationName",u.name AS "startedBy",s.started_at AS "startedAt",s.completed_at AS "completedAt",s.status,s.version,jsonb_array_length(s.snapshot) AS expected,(SELECT count(*)::int FROM inventory_scan_items i WHERE i.scan_id=s.id AND expected AND observed) AS observed,(SELECT count(*)::int FROM inventory_scan_items i WHERE i.scan_id=s.id AND expected AND NOT observed) AS missing,(SELECT count(*)::int FROM inventory_scan_items i WHERE i.scan_id=s.id AND NOT expected AND observed) AS unexpected,(SELECT count(*)::int FROM inventory_scan_events e WHERE e.scan_id=s.id AND result='DUPLICATE') AS duplicates,(SELECT count(*)::int FROM inventory_scan_events e WHERE e.scan_id=s.id AND result='UNKNOWN') AS unknown`;
const from='FROM inventory_scans s JOIN location_paths l ON l.id=s.location_id JOIN users u ON u.id=s.started_by';
export async function listStocktakes(){return clean((await query<InventoryScan>(`SELECT ${projection} ${from} ORDER BY s.started_at DESC LIMIT 100`)).rows);}
async function scanSummary(id:string){return clean((await query<InventoryScan>(`SELECT ${projection} ${from} WHERE s.id=$1`,[id])).rows[0]);}
export async function stocktakeSummary(id:string){parse(uuidSchema,id);const scan=await scanSummary(id);if(!scan)throw new AppError(404,'Nie znaleziono sesji inwentaryzacji.');return scan;}
export async function getStocktake(id:string,client?:PoolClient):Promise<InventoryScanDetail>{
 const read=client?client.query.bind(client):query;
 parse(uuidSchema,id);const row=(await read<InventoryScan&{snapshot:InventoryExpected[];summary:InventoryScanDetail|null}>(`SELECT ${projection},s.snapshot,s.summary ${from} WHERE s.id=$1`,[id])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono inwentaryzacji.');
 if(row.status==='COMPLETED'&&row.summary)return clean(row.summary);
 const events=(await read<InventoryEvent>(`SELECT e.id,a.asset_id AS "assetId",a.name,e.code,e.result,e.created_at AS "createdAt" FROM inventory_scan_events e LEFT JOIN assets a ON a.id=e.asset_id WHERE e.scan_id=$1 ORDER BY e.created_at DESC,e.id DESC LIMIT 10000`,[id])).rows;
 const observed=new Set((await read<{asset_id:string}>('SELECT asset_id FROM inventory_scan_items WHERE scan_id=$1 AND observed',[id])).rows.map(a=>a.asset_id));
 const {summary:_summary,...scan}=row;return clean({...scan,events,missingItems:row.snapshot.filter(a=>!observed.has(a.id))});
}
export async function startStocktake(body:unknown,user:User){
 requirePermission(user,'inventory.run');requirePermission(user,'asset.view');const input=parse(z.object({locationId:uuidSchema,requestId:uuidSchema}).strict(),body);
 const id=await transaction(client=>idempotent(client,user,input.requestId,'START_INVENTORY',input,async()=>{
  if(!(await client.query('SELECT id FROM locations WHERE id=$1',[input.locationId])).rowCount)throw new AppError(404,'Nie znaleziono lokalizacji.');
  const expected=(await client.query<InventoryExpected>(`WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=$1 UNION ALL SELECT l.id FROM locations l JOIN branch b ON l.parent_id=b.id) SELECT a.id,a.asset_id AS "assetId",a.name,a.serial_number AS "serialNumber",l.path AS "locationName" FROM assets a LEFT JOIN location_paths l ON l.id=a.location_id WHERE a.location_id IN (SELECT id FROM branch) AND a.status<>'RETIRED' ORDER BY a.asset_id LIMIT 10001`,[input.locationId])).rows;
  if(expected.length>10000)throw new AppError(400,'Wybierz mniejszą lokalizację: limit sesji to 10 000 urządzeń.');
  const id=(await client.query<{id:string}>('INSERT INTO inventory_scans(location_id,started_by,snapshot,request_id) VALUES($1,$2,$3,$4) RETURNING id',[input.locationId,user.id,JSON.stringify(expected),input.requestId])).rows[0].id;
  await client.query('INSERT INTO inventory_scan_items(scan_id,asset_id,expected) SELECT $1,id,true FROM assets WHERE id=ANY($2::uuid[])',[id,expected.map(a=>a.id)]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'START_INVENTORY','inventory_scan',$2,'Rozpoczęto inwentaryzację lokalizacji.',$3)",[user.id,id,JSON.stringify({locationId:input.locationId,expected:expected.length})]);return id;
 }));return getStocktake(id);
}
export async function scanStocktake(id:string,body:unknown,user:User){
 requirePermission(user,'inventory.run');requirePermission(user,'rfid.scan');parse(uuidSchema,id);const input=parse(z.object({code:z.string().trim().min(1).max(2048),requestId:uuidSchema}).strict(),body);
 // Resolve only local record URLs or plain identifiers. Never follow an external scan URL.
 const origin=new URL(process.env.APP_URL!).origin;let href:string|null=scanTarget(input.code,origin),assetId:string|null=null;
 if(input.code.includes('://')||input.code.startsWith('/')||/^(javascript|data|file|blob|vbscript):/i.test(input.code)){if(!href)throw new AppError(400,'Kod nie prowadzi do lokalnego rekordu.');}
 else try{href=(await resolveScan(input.code)).href;}catch(e){if(!(e instanceof AppError)||e.status!==404)throw e;}
 const resolved=href?.startsWith('/asset/')?(await query<{id:string;assetId:string;name:string}>('SELECT id,asset_id AS "assetId",name FROM assets WHERE asset_id=$1',[decodeURIComponent(href.slice('/asset/'.length))])).rows[0]:null;
 assetId=resolved?.id??null;
 const event=await transaction(client=>idempotent(client,user,input.requestId,'SCAN_INVENTORY',{id,input},async()=>{
  const session=(await client.query('SELECT status FROM inventory_scans WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!session)throw new AppError(404,'Nie znaleziono inwentaryzacji.');if(session.status!=='OPEN')throw new AppError(409,'Inwentaryzacja została zakończona.');
  const count=(await client.query<{count:number}>('SELECT count(*)::int AS count FROM inventory_scan_events WHERE scan_id=$1',[id])).rows[0].count;if(count>=10000)throw new AppError(400,'Limit sesji: 10 000 odczytów. Zakończ raport i rozpocznij kolejną sesję.');
  const prior=assetId?(await client.query('SELECT expected,observed FROM inventory_scan_items WHERE scan_id=$1 AND asset_id=$2',[id,assetId])).rows[0]:null;
  const result:InventoryEvent['result']=!assetId?'UNKNOWN':prior?.observed?'DUPLICATE':prior?.expected?'EXPECTED':'UNEXPECTED';
  if(assetId){await client.query('INSERT INTO inventory_scan_items(scan_id,asset_id,expected,observed,observed_at) VALUES($1,$2,false,true,now()) ON CONFLICT(scan_id,asset_id) DO UPDATE SET observed=true,observed_at=COALESCE(inventory_scan_items.observed_at,now())',[id,assetId]);if(result!=='DUPLICATE')await client.query("INSERT INTO asset_history(asset_id,actor_id,action,description,after_data) VALUES($1,$2,'INVENTORY_CHECK','Odczyt urządzenia podczas inwentaryzacji.',$3)",[assetId,user.id,JSON.stringify({scanId:id,result})]);}
  const event=(await client.query<{id:string;createdAt:string}>('INSERT INTO inventory_scan_events(scan_id,asset_id,code,result,request_id,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at AS "createdAt"',[id,assetId,input.code,result,input.requestId,user.id])).rows[0];await client.query('UPDATE inventory_scans SET version=version+1 WHERE id=$1',[id]);return clean({...event,result,assetId:resolved?.assetId??null,name:resolved?.name??null,code:input.code});
 }));return {event,scan:await scanSummary(id)};
}
export async function finishStocktake(id:string,body:unknown,user:User){
 requirePermission(user,'inventory.run');parse(uuidSchema,id);const {version}=parse(z.object({version:z.number().int().positive()}).strict(),body);
 // Take the complete report inside the session lock to exclude a concurrent scan.
 return transaction(async client=>{const row=(await client.query('SELECT status,version FROM inventory_scans WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono inwentaryzacji.');if(row.status!=='OPEN'||row.version!==version)throw new AppError(409,'Sesja zmieniła się. Odśwież raport przed zakończeniem.');
  const report=await getStocktake(id,client),completedAt=new Date().toISOString(),summary={...report,status:'COMPLETED' as const,version:version+1,completedAt};
  await client.query("UPDATE inventory_scans SET status='COMPLETED',completed_at=$2,summary=$3,version=version+1 WHERE id=$1",[id,completedAt,JSON.stringify(summary)]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'FINISH_INVENTORY','inventory_scan',$2,'Zakończono i zapisano raport inwentaryzacji.',$3)",[user.id,id,JSON.stringify({expected:summary.expected,observed:summary.observed,missing:summary.missing,unexpected:summary.unexpected,duplicates:summary.duplicates,unknown:summary.unknown})]);return summary;
 });
}
export async function exportStocktake(id:string){const report=await getStocktake(id);const seen=new Set(report.missingItems.map(a=>a.id));return csv([['Sesja','Lokalizacja','Asset ID','Urządzenie','Numer seryjny','Wynik'],...report.snapshot.map(a=>[id,report.locationName,a.assetId,a.name,a.serialNumber,seen.has(a.id)?'BRAK':'ODCZYTANO']),...report.events.filter(e=>e.result!=='EXPECTED').map(e=>[id,report.locationName,e.assetId??'',e.name??'',e.code,e.result])]);}
