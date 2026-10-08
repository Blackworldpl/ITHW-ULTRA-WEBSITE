import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Asset,EquipmentDocument,EquipmentDocumentSummary,User,Workstation,WorkstationEquipment} from '@/shared/types';
import {query,transaction,pool} from './db';
import type {PoolClient} from 'pg';
import {requireRole} from './auth';
import {AppError} from './errors';
import {parse,uuidSchema} from './validation';
import {assetFrom,assetProjection} from './services';

const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const stationProjection=`l.id,l.name,l.path,l.kind,l.parent_id AS "parentId",l.version,(WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=l.id UNION ALL SELECT child.id FROM locations child JOIN branch b ON child.parent_id=b.id) SELECT count(*)::integer FROM assets a WHERE a.location_id IN (SELECT id FROM branch)) AS "assetCount"`;
const documentProjection=`d.id,d.reference,d.kind,d.created_at AS "createdAt",u.name AS "createdBy",jsonb_array_length(d.snapshot->'items') AS "itemCount"`;
async function snapshotTransaction<T>(requestId:string,apply:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();let locked=false;
 try{
  // Acquire the replay lock before BEGIN so a waiting request starts with a fresh snapshot.
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[requestId]);locked=true;
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try{const result=await apply(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}
 }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[requestId]);}finally{client.release();}}
}
export async function listWorkstations():Promise<Workstation[]>{return clean((await query<Workstation>(`SELECT ${stationProjection} FROM location_paths l WHERE l.kind='DESK' ORDER BY l.path,l.id`)).rows);}
export async function createWorkstation(body:unknown,user:User):Promise<Workstation>{
 requireRole(user,['IT_ADVANCED','ADMIN']);
 const input=parse(z.object({name:z.string().trim().min(1).max(160),parentId:uuidSchema.nullable().optional()}).strict(),body);
 return transaction(async client=>{
  await client.query('LOCK TABLE locations IN SHARE ROW EXCLUSIVE MODE');
  if(input.parentId&&!(await client.query('SELECT id FROM locations WHERE id=$1',[input.parentId])).rowCount)throw new AppError(400,'Wybierz istniejącą lokalizację.');
  const id=(await client.query<{id:string}>("INSERT INTO locations(name,kind,parent_id) VALUES($1,'DESK',$2) RETURNING id",[input.name,input.parentId??null])).rows[0].id;
  await client.query('INSERT INTO qr_codes(location_id,target_path,created_by) VALUES($1,$2,$3)',[id,`/workstations/${id}`,user.id]);
  const station=(await client.query<Workstation>(`SELECT ${stationProjection} FROM location_paths l WHERE l.id=$1`,[id])).rows[0];
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'CREATE_WORKSTATION','location',$2,$3,$4)",[user.id,id,`Dodano stanowisko ${station.path}.`,JSON.stringify(station)]);
  return clean(station);
 });
}
export async function getWorkstation(id:string):Promise<WorkstationEquipment>{
 parse(uuidSchema,id);
 const location=(await query<Workstation>(`SELECT ${stationProjection} FROM location_paths l WHERE l.id=$1 AND l.kind='DESK'`,[id])).rows[0];
 if(!location)throw new AppError(404,'Nie znaleziono stanowiska.');
 const assets=(await query<Asset>(`WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=$1 UNION ALL SELECT l.id FROM locations l JOIN branch b ON l.parent_id=b.id) SELECT ${assetProjection} ${assetFrom} WHERE a.location_id IN (SELECT id FROM branch) ORDER BY a.name,a.asset_id`,[id])).rows;
 return clean({location,assets});
}
export async function listEquipmentDocuments(target:'employee'|'workstation',id:string):Promise<EquipmentDocumentSummary[]>{
 parse(uuidSchema,id);
 return clean((await query<EquipmentDocumentSummary>(`SELECT ${documentProjection} FROM equipment_documents d JOIN users u ON u.id=d.created_by WHERE d.${target==='employee'?'employee_id':'location_id'}=$1 ORDER BY d.created_at DESC,d.id LIMIT 100`,[id])).rows);
}
export async function getEquipmentDocument(id:string):Promise<EquipmentDocument>{
 parse(uuidSchema,id);
 const row=(await query<EquipmentDocument>(`SELECT ${documentProjection},d.snapshot FROM equipment_documents d JOIN users u ON u.id=d.created_by WHERE d.id=$1`,[id])).rows[0];
 if(!row)throw new AppError(404,'Nie znaleziono dokumentu wyposażenia.');
 return clean(row);
}
export async function createEquipmentDocument(target:'employee'|'workstation',id:string,body:unknown,user:User):Promise<EquipmentDocument>{
 requireRole(user,['IT_USER','IT_ADVANCED','ADMIN']);parse(uuidSchema,id);
 const input=parse(z.object({kind:z.enum(['equipment','clearance','workstation']),notes:z.string().trim().max(2000).default(''),requestId:uuidSchema}).strict(),body);
 if((target==='workstation')!==(input.kind==='workstation'))throw new AppError(400,'Typ dokumentu nie pasuje do wybranego profilu.');
 return snapshotTransaction(input.requestId,async client=>{
  const prior=(await client.query(`SELECT d.*,u.name AS author FROM equipment_documents d JOIN users u ON u.id=d.created_by WHERE d.request_id=$1`,[input.requestId])).rows[0];
  if(prior){
   if(prior.created_by!==user.id||prior.kind!==input.kind||prior[target==='employee'?'employee_id':'location_id']!==id||prior.snapshot.notes!==input.notes)throw new AppError(409,'Ten identyfikator operacji został użyty z innymi danymi.');
   return clean({id:prior.id,reference:prior.reference,kind:prior.kind,createdAt:prior.created_at,createdBy:prior.author,itemCount:prior.snapshot.items.length,snapshot:prior.snapshot}) as EquipmentDocument;
  }
  let subject:EquipmentDocument['snapshot']['subject'];
  if(target==='employee'){
   const employee=(await client.query(`SELECT e.name,e.employee_number AS "employeeNumber",e.email,e.department,e.position,l.path AS "locationName" FROM employees e LEFT JOIN location_paths l ON l.id=e.location_id WHERE e.id=$1`,[id])).rows[0];
   if(!employee)throw new AppError(404,'Nie znaleziono pracownika.');subject=employee;
  }else{
   const station=(await client.query("SELECT name,path AS \"locationName\" FROM location_paths WHERE id=$1 AND kind='DESK'",[id])).rows[0];
   if(!station)throw new AppError(404,'Nie znaleziono stanowiska.');subject=station;
  }
  const condition=target==='employee'?'a.employee_id=$1':`a.location_id IN (WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=$1 UNION ALL SELECT l.id FROM locations l JOIN branch b ON l.parent_id=b.id) SELECT id FROM branch)`;
  const assets=(await client.query<Asset>(`SELECT ${assetProjection} ${assetFrom} WHERE ${condition} ORDER BY a.name,a.asset_id LIMIT 3001`,[id])).rows;
  if(assets.length>3000)throw new AppError(400,'Dokument może zawierać najwyżej 3000 urządzeń.');
  const snapshot:EquipmentDocument['snapshot']={subject,notes:input.notes,items:assets.map(a=>({assetId:a.assetId,name:a.name,model:a.model,serialNumber:a.serialNumber,status:a.status,locationName:a.locationName}))};
  const documentId=randomUUID(),reference=`${{equipment:'WYP',clearance:'OBG',workstation:'ST'}[input.kind]}/${new Date().getFullYear()}/${documentId.slice(0,13).replace('-','').toUpperCase()}`;
  const created=(await client.query<{created_at:Date}>('INSERT INTO equipment_documents(id,employee_id,location_id,kind,reference,snapshot,created_by,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at',[documentId,target==='employee'?id:null,target==='workstation'?id:null,input.kind,reference,JSON.stringify(snapshot),user.id,input.requestId])).rows[0];
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'CREATE_EQUIPMENT_DOCUMENT','equipment_document',$2,$3,$4)",[user.id,documentId,`Zapisano dokument ${reference}: ${subject.name}.`,JSON.stringify({reference,kind:input.kind,count:assets.length})]);
  return clean({id:documentId,reference,kind:input.kind,createdAt:created.created_at.toISOString(),createdBy:user.name,itemCount:assets.length,snapshot});
 });
}
