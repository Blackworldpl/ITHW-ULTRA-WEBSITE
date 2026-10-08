import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import type { User } from '@/shared/types';
import type { ImportPayload, ImportPreview, ImportResult } from '@/shared/import';
import { transaction } from './db';
import { requireRole } from './auth';
import { AppError } from './errors';
import { parse, uuidSchema } from './validation';
import { createAsset, createInventory, stockMovement } from './services';
import {addQuantity,validQuantity} from '@/shared/quantity';
import {validateInventoryChoices,inventoryUnitPrecision} from './inventory-dictionaries';

const rowSchema=z.object({row:z.number().int().positive(),name:z.string().trim().max(200),quantity:z.number().finite(),serialNumber:z.string().trim().max(160).optional(),sku:z.string().trim().max(100).optional(),manufacturer:z.string().trim().max(120).optional(),model:z.string().trim().max(160).optional(),notes:z.string().trim().max(3500).optional(),fixedAssetNumber:z.string().trim().max(120).optional()}).strict();
const schema=z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/),sheet:z.string().min(1).max(200),mode:z.enum(['assets','inventory']),unit:z.string().trim().min(1).max(30).default('szt.'),categoryId:uuidSchema.optional(),category:z.string().trim().min(1).max(120),locationId:uuidSchema.optional(),fixedAssets:z.boolean(),rows:z.array(rowSchema).min(1).max(1000)}).strict().superRefine((p,ctx)=>{
 if(new Set(p.rows.map(r=>r.row)).size!==p.rows.length)ctx.addIssue({code:'custom',message:'Numery wierszy muszą być unikalne.'});
 if(p.mode==='assets'&&!p.categoryId)ctx.addIssue({code:'custom',message:'Wybierz kategorię urządzeń.'});
 if(p.rows.reduce((n,r)=>n+Math.max(0,r.quantity),0)>1000&&p.mode==='assets')ctx.addIssue({code:'custom',message:'Jedna partia może zawierać najwyżej 1000 urządzeń.'});
});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function inspect(client:PoolClient,p:ImportPayload):Promise<ImportPreview> {
 if(p.mode==='inventory')await validateInventoryChoices(client,p.category,p.unit??'szt.');
 const precision=p.mode==='inventory'?await inventoryUnitPrecision(client,p.unit??'szt.'):0;
 if(p.categoryId&&!(await client.query('SELECT 1 FROM asset_categories WHERE id=$1',[p.categoryId])).rowCount)throw new AppError(400,'Wybrana kategoria nie istnieje.');
 if(p.locationId&&!(await client.query('SELECT 1 FROM locations WHERE id=$1',[p.locationId])).rowCount)throw new AppError(400,'Wybrana lokalizacja nie istnieje.');
 const imported=await client.query<{source_row:number}>('SELECT source_row FROM inventory_import_rows WHERE source_hash=$1 AND sheet=$2',[p.sourceHash,p.sheet]);
 const done=new Set(imported.rows.map(r=>r.source_row));
 const keys=new Map<string,number>();
 for(const row of p.rows)for(const [field,value] of [['serial',row.serialNumber],['fixed',row.fixedAssetNumber],['sku',p.mode==='inventory'?row.sku:undefined]])if(value){const key=`${field}:${value.toLowerCase()}`;keys.set(key,(keys.get(key)||0)+1);}
 const rows:ImportPreview['rows']=[];
 for(const r of p.rows){
  let status:'new'|'duplicate'|'error'='new',reason='Nowa pozycja; wymaga fizycznej weryfikacji.';
  if(!r.name){status='error';reason='Brak nazwy.';}
  else if(!validQuantity(r.quantity,precision)||r.quantity<(p.mode==='assets'?1:0)||r.quantity>1_000_000){status='error';reason='Ilość jest niepoprawna lub niezgodna z precyzją wybranej jednostki.';}
  else if(p.mode==='assets'&&r.quantity!==1&&(r.serialNumber||r.fixedAssetNumber)){status='error';reason='Numer seryjny lub numer ST identyfikuje jedną sztukę. Ustaw ilość 1.';}
  else if(p.mode==='inventory'&&(r.serialNumber||r.fixedAssetNumber)){status='error';reason='Pozycję z numerem seryjnym lub ST importuj jako urządzenie.';}
  else if(p.mode==='inventory'&&p.fixedAssets){status='error';reason='Środki trwałe importuj do urządzeń.';}
  else if([['serial',r.serialNumber],['fixed',r.fixedAssetNumber],['sku',p.mode==='inventory'?r.sku:undefined]].some(([k,v])=>v&&(keys.get(`${k}:${v.toLowerCase()}`)||0)>1)){status='error';reason='Identyfikator powtarza się w wybranej partii. Sprawdź wiersze.';}
  else if(done.has(r.row)){status='duplicate';reason='Ten wiersz tego pliku został już zaimportowany.';}
  else if(p.mode==='assets'&&(r.serialNumber||r.fixedAssetNumber)){
   const found=await client.query('SELECT 1 FROM assets WHERE ($1::text IS NOT NULL AND lower(serial_number)=lower($1)) OR ($2::text IS NOT NULL AND lower(fixed_asset_number)=lower($2))',[r.serialNumber||null,r.fixedAssetNumber||null]);
   if(found.rowCount){status='duplicate';reason='Numer seryjny lub ST już istnieje. Rekord pozostanie bez zmian.';}
  }else if(p.mode==='inventory'&&r.sku){
   if((await client.query('SELECT 1 FROM inventory_items WHERE lower(sku)=lower($1)',[r.sku])).rowCount){status='duplicate';reason='SKU już istnieje. Stan magazynowy pozostanie bez zmian.';}
  }
  rows.push({row:r.row,name:r.name,quantity:r.quantity,status,reason});
 }
 return {rows,newRows:rows.filter(r=>r.status==='new').length,newUnits:rows.filter(r=>r.status==='new').reduce((n,r)=>addQuantity(n,r.quantity),0),duplicates:rows.filter(r=>r.status==='duplicate').length,errors:rows.filter(r=>r.status==='error').length};
}
export async function previewImport(body:unknown,user:User){
 requireRole(user,['ADMIN','IT_ADVANCED']); const p=parse(schema,body);
 return transaction(async client=>{const preview=await inspect(client,p);return {...preview,token:hash({p,preview})};});
}
export async function commitImport(body:unknown,user:User):Promise<ImportResult>{
 requireRole(user,['ADMIN','IT_ADVANCED']);
 const input=parse(z.object({payload:schema,requestId:uuidSchema,previewToken:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),body);
 const p=input.payload,payloadHash=hash(p);
 return transaction(async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext('it-hardware-opening-import'))");
  const previous=await client.query<{actor_id:string;payload_hash:string;result:ImportResult}>('SELECT actor_id,payload_hash,result FROM inventory_import_batches WHERE request_id=$1',[input.requestId]);
  if(previous.rowCount){const old=previous.rows[0];if(old.actor_id!==user.id||old.payload_hash!==payloadHash)throw new AppError(409,'Identyfikator operacji jest już używany dla innych danych.');return old.result;}
  const preview=await inspect(client,p);
  if(preview.errors)throw new AppError(400,'Popraw wszystkie błędy przed zapisem.');
  if(hash({p,preview})!==input.previewToken)throw new AppError(409,'Dane zmieniły się od podglądu. Wykonaj ponownie kontrolę.');
  if(!preview.newRows)throw new AppError(400,'Brak nowych pozycji do zapisania.');
  const batch=await client.query<{id:string}>('INSERT INTO inventory_import_batches(actor_id,source_hash,sheet,mode,request_id,payload_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[user.id,p.sourceHash,p.sheet,p.mode,input.requestId,payloadHash]);
  const batchId=batch.rows[0].id;
  const newRows=new Set(preview.rows.filter(r=>r.status==='new').map(r=>r.row));
  for(const r of p.rows){if(!newRows.has(r.row))continue;
   const notes=[r.notes,'Stan początkowy z częściowego eksportu. Wymaga fizycznej weryfikacji.',`Import: ${batchId}, wiersz ${r.row}.`].filter(Boolean).join('\n');
   const assetIds:string[]=[];let inventoryId:string|null=null;
   if(p.mode==='assets')for(let i=0;i<r.quantity;i++){
    let fixed=r.fixedAssetNumber||undefined;
    if(p.fixedAssets&&!fixed){do{const seq=await client.query<{number:string}>("SELECT 'ST-'||lpad(nextval('import_fixed_number_seq')::text,8,'0') AS number");fixed=seq.rows[0].number;}while((await client.query('SELECT 1 FROM assets WHERE lower(fixed_asset_number)=lower($1)',[fixed])).rowCount);}
    const asset=await createAsset({name:r.name,categoryId:p.categoryId,manufacturer:r.manufacturer||null,model:r.model||null,serialNumber:r.serialNumber||null,locationId:p.locationId||null,status:'AVAILABLE',isFixedAsset:p.fixedAssets,fixedAssetNumber:fixed||null,notes,customFields:{importVerification:'UNVERIFIED',importBatch:batchId}},user,client);
    assetIds.push(asset.id);
   }else{
    const key=hash([p.sourceHash,p.sheet,r.row]).slice(0,24);
    const item=await createInventory({name:r.name,sku:r.sku||`IMP-${key}`,slug:`import-${key}`,category:p.category,unit:p.unit??'szt.',locationId:p.locationId||null,notes},user,client);
    inventoryId=item.id;
    if(r.quantity)await stockMovement(client,user,item.id,r.quantity,'OPENING_BALANCE','Częściowy stan początkowy z importu; wymaga fizycznej weryfikacji.');
   }
   await client.query('INSERT INTO inventory_import_rows(batch_id,source_hash,sheet,source_row,mode,asset_ids,inventory_item_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[batchId,p.sourceHash,p.sheet,r.row,p.mode,assetIds,inventoryId]);
  }
  const result={batchId,createdRows:preview.newRows,createdUnits:preview.newUnits,skipped:preview.duplicates};
  await client.query('UPDATE inventory_import_batches SET result=$2 WHERE id=$1',[batchId,JSON.stringify(result)]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'IMPORT_OPENING_BALANCE','import',$2,'Import częściowego stanu początkowego bez potwierdzenia spisu fizycznego.',$3)",[user.id,batchId,JSON.stringify(result)]);
  return result;
 });
}
