import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {User} from '@/shared/types';
import type {InventoryDictionaries,InventoryDictionaryEntry} from '@/shared/inventory-dictionaries';
import {query,transaction} from './db';
import {parse,uuidSchema} from './validation';
import {AppError} from './errors';
import {requireRole} from './auth';
import {requirePermission} from './permissions';
import {validQuantity} from '@/shared/quantity';

const projection=`d.id,d.kind,d.name,d.label,d.active,d.version,d.quantity_precision AS "quantityPrecision",(SELECT count(*)::integer FROM inventory_items n WHERE CASE WHEN d.kind='category' THEN n.category ELSE n.unit END=d.name) AS used`;
async function lockedEntry(client:PoolClient,id:string){
 const entry=(await client.query<InventoryDictionaryEntry>('SELECT id,kind,name,label,active,version,quantity_precision AS "quantityPrecision" FROM inventory_dictionary_entries WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(entry)entry.used=(await client.query<{used:number}>('SELECT count(*)::integer AS used FROM inventory_items WHERE CASE WHEN $1=\'category\' THEN category ELSE unit END=$2',[entry.kind,entry.name])).rows[0].used;
 return entry;
}
export async function getInventoryDictionaries():Promise<InventoryDictionaries>{
 const entries=(await query<InventoryDictionaryEntry>(`WITH counts AS (SELECT 'category' AS kind,category AS name,count(*)::integer AS used FROM inventory_items GROUP BY category UNION ALL SELECT 'unit',unit,count(*)::integer FROM inventory_items GROUP BY unit) SELECT d.id,d.kind,d.name,d.label,d.active,d.version,d.quantity_precision AS "quantityPrecision",coalesce(c.used,0) AS used FROM inventory_dictionary_entries d LEFT JOIN counts c ON c.kind=d.kind AND c.name=d.name ORDER BY d.name,d.id`)).rows;
 return {categories:entries.filter(e=>e.kind==='category'),units:entries.filter(e=>e.kind==='unit')};
}
export async function validateInventoryChoices(client:PoolClient,category:string|undefined,unit:string|undefined,before?:{category:string;unit:string}){
 for(const [kind,name] of [['category',category],['unit',unit]] as const){
  if(name===undefined)continue;
  const entry=(await client.query<{active:boolean}>('SELECT active FROM inventory_dictionary_entries WHERE kind=$1 AND name=$2 FOR SHARE',[kind,name])).rows[0];
  if(!entry||!entry.active&&name!==before?.[kind==='category'?'category':'unit'])throw new AppError(400,`Wybierz ${kind==='category'?'aktywną kategorię':'aktywną jednostkę'} z listy.`);
 }
}
export async function inventoryUnitPrecision(client:PoolClient,unit:string):Promise<number>{
 const entry=(await client.query<{precision:number}>('SELECT quantity_precision AS precision FROM inventory_dictionary_entries WHERE kind=\'unit\' AND name=$1 FOR SHARE',[unit])).rows[0];
 if(!entry)throw new AppError(400,'Nie znaleziono jednostki produktu.');
 return entry.precision;
}
export function requireQuantityPrecision(value:number,precision:number){
 if(!validQuantity(value,precision))throw new AppError(400,precision===0?'Ta jednostka wymaga ilości całkowitej.':`Ta jednostka dopuszcza ${precision} miejsca po przecinku.`);
}
export async function saveInventoryDictionary(id:string|null,body:unknown,user:User):Promise<InventoryDictionaryEntry>{
 requireRole(user,['ADMIN']);requirePermission(user,'settings.manage');
 const input=parse(z.object({kind:z.enum(['category','unit']),name:z.string().trim().min(1).max(120),label:z.string().trim().min(1).max(160),active:z.boolean().default(true),quantityPrecision:z.number().int().min(0).max(3).optional(),version:z.number().int().positive().optional()}).strict(),body);
 if(input.kind==='unit'&&input.name.length>30)throw new AppError(400,'Symbol jednostki ma najwyżej 30 znaków.');
 if(id)parse(uuidSchema,id);
 try{return await transaction(async client=>{
  // Serializes name changes against deletion and duplicate administrator writes.
  await client.query('SELECT pg_advisory_xact_lock(734902118)');
  const before=id?await lockedEntry(client,id):null;
  if(id&&!before)throw new AppError(404,'Nie znaleziono wpisu.');
  if(before&&(input.version!==before.version||input.kind!==before.kind))throw new AppError(409,'Lista zmieniła się. Otwórz wpis ponownie.');
  if((await client.query('SELECT id FROM inventory_dictionary_entries WHERE kind=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3)',[input.kind,input.name,id])).rowCount)throw new AppError(409,'Taki wpis już istnieje na liście.');
  if(before?.kind==='unit'&&before.used&&input.name!==before.name)throw new AppError(409,'Używana jednostka zachowuje symbol. Możesz zmienić jej opis lub ją wyłączyć.');
  const precision=input.kind==='unit'?(input.quantityPrecision??before?.quantityPrecision??0):0;
  if(input.kind==='category'&&input.quantityPrecision)throw new AppError(400,'Precyzja dotyczy jednostek.');
  if(before?.kind==='unit'&&precision<before.quantityPrecision&&(before.used||(await client.query('SELECT 1 FROM invoice_items WHERE unit=$1 AND inventory_item_id IS NOT NULL LIMIT 1',[before.name])).rowCount))throw new AppError(409,'Precyzji używanej jednostki nie można zmniejszyć. Dodaj nową jednostkę.');
  const row=(id?await client.query('UPDATE inventory_dictionary_entries SET name=$2,label=$3,active=$4,quantity_precision=$5,version=version+1 WHERE id=$1 RETURNING id',[id,input.name,input.label,input.active,precision]):await client.query('INSERT INTO inventory_dictionary_entries(kind,name,label,active,quantity_precision) VALUES($1,$2,$3,$4,$5) RETURNING id',[input.kind,input.name,input.label,input.active,precision])).rows[0];
  if(before?.kind==='category'&&before.name!==input.name)await client.query('UPDATE inventory_items SET category=$2,updated_at=now() WHERE category=$1',[before.name,input.name]);
  const after=(await client.query<InventoryDictionaryEntry>(`SELECT ${projection} FROM inventory_dictionary_entries d WHERE d.id=$1`,[row.id])).rows[0];
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'SAVE_INVENTORY_DICTIONARY','inventory_dictionary',$2,$3,$4,$5)",[user.id,after.id,`Zapisano ${input.kind==='category'?'kategorię magazynową':'jednostkę'} ${input.name}.`,before?JSON.stringify(before):null,JSON.stringify(after)]);
  return after;
 });}catch(error){if((error as {code?:string}).code==='23505')throw new AppError(409,'Taki wpis już istnieje na liście.');throw error;}
}
export async function deleteInventoryDictionary(id:string,body:unknown,user:User){
 requireRole(user,['ADMIN']);requirePermission(user,'settings.manage');parse(uuidSchema,id);
 const {version}=parse(z.object({version:z.number().int().positive()}).strict(),body);
 return transaction(async client=>{
  await client.query('SELECT pg_advisory_xact_lock(734902118)');
  const before=await lockedEntry(client,id);
  if(!before)throw new AppError(404,'Nie znaleziono wpisu.');if(before.version!==version)throw new AppError(409,'Lista zmieniła się. Otwórz wpis ponownie.');
  if(before.used)throw new AppError(409,'Wpis jest używany przez produkty. Wyłącz go zamiast usuwać.');
  await client.query('DELETE FROM inventory_dictionary_entries WHERE id=$1',[id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data) VALUES($1,'DELETE_INVENTORY_DICTIONARY','inventory_dictionary',$2,$3,$4)",[user.id,id,`Usunięto nieużywany wpis ${before.name}.`,JSON.stringify(before)]);return before;
 });
}
