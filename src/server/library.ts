import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {User} from '@/shared/types';
import type {Configuration,ConfigurationDetail,ConfigurationVersion,LibraryDocument} from '@/shared/product';
import {query,transaction} from './db';
import {requirePermission} from './permissions';
import {parse,uuidSchema} from './validation';
import {AppError} from './errors';
import {validateInvoicePdf} from './invoice-documents';
import {idempotent} from './services';
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const projection=`c.id,c.name,c.category_id AS "categoryId",ac.name AS "categoryName",c.manufacturer,c.model,c.description,c.latest_version AS "latestVersion",c.updated_at AS "updatedAt",u.name AS author`;
const from='FROM configurations c LEFT JOIN asset_categories ac ON ac.id=c.category_id JOIN users u ON u.id=c.created_by';
export async function listConfigurations(q:string,assetId?:string){
 if(q.length>200)throw new AppError(400,'Wyszukiwanie może mieć najwyżej 200 znaków.');
 if(assetId)parse(uuidSchema,assetId);
 return clean((await query<Configuration>(`SELECT ${projection} ${from} WHERE ($1='' OR concat_ws(' ',c.name,c.manufacturer,c.model,c.description,ac.name) ILIKE '%'||$1||'%') ${assetId?'AND c.id IN (SELECT v.configuration_id FROM asset_configurations a JOIN configuration_versions v ON v.id=a.configuration_version_id WHERE a.asset_id=$2)':''} ORDER BY c.updated_at DESC,c.id LIMIT 200`,assetId?[q,assetId]:[q])).rows);
}
export async function getConfiguration(id:string,versionId?:string):Promise<ConfigurationDetail>{
 parse(uuidSchema,id);if(versionId)parse(uuidSchema,versionId);
 const config=(await query<Configuration>(`SELECT ${projection} ${from} WHERE c.id=$1`,[id])).rows[0];if(!config)throw new AppError(404,'Nie znaleziono konfiguracji.');
 const versions=(await query<ConfigurationVersion>(`SELECT v.id,v.version,v.release_notes AS "releaseNotes",v.created_at AS "createdAt",u.name AS author,v.attachment_id AS "attachmentId" FROM configuration_versions v JOIN users u ON u.id=v.created_by WHERE v.configuration_id=$1 ORDER BY v.created_at DESC,v.id DESC`,[id])).rows;
 const selected=versionId?versions.find(v=>v.id===versionId):versions[0];if(versionId&&!selected)throw new AppError(404,'Wersja nie należy do tej konfiguracji.');
 const content=selected?(await query<{content:Buffer}>('SELECT content FROM attachments WHERE id=$1',[selected.attachmentId])).rows[0]?.content:null;
 return clean({...config,versions,content:content?.toString('utf8')??''});
}
const configurationSchema=z.object({name:z.string().trim().min(2).max(200),categoryId:uuidSchema.nullable().optional(),manufacturer:z.string().trim().max(120).default(''),model:z.string().trim().max(160).default(''),description:z.string().trim().max(2000).default(''),content:z.string().min(1).max(262144),releaseNotes:z.string().trim().max(2000).default(''),version:z.number().int().nonnegative().optional(),requestId:uuidSchema}).strict();
export async function saveConfiguration(id:string|null,body:unknown,user:User):Promise<ConfigurationDetail>{
 requirePermission(user,'config.edit');if(id)parse(uuidSchema,id);const input=parse(configurationSchema,body),bytes=Buffer.from(input.content,'utf8');if(bytes.length>262144||bytes.includes(0))throw new AppError(400,'Konfiguracja tekstowa może mieć najwyżej 256 KB i nie może zawierać bajtów NUL.');
 const configId=await transaction(client=>idempotent(client,user,input.requestId,'SAVE_CONFIGURATION',{id,input},async()=>{
  let configId=id,version=1;
  if(id){const before=(await client.query('SELECT latest_version FROM configurations WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)throw new AppError(404,'Nie znaleziono konfiguracji.');if(before.latest_version!==input.version)throw new AppError(409,'Konfiguracja zmieniła się. Otwórz ponownie formularz.');version=before.latest_version+1;await client.query('UPDATE configurations SET name=$2,category_id=$3,manufacturer=$4,model=$5,description=$6,latest_version=$7,updated_at=now() WHERE id=$1',[id,input.name,input.categoryId??null,input.manufacturer||null,input.model||null,input.description,version]);}
  else configId=(await client.query<{id:string}>('INSERT INTO configurations(name,category_id,manufacturer,model,description,latest_version,created_by) VALUES($1,$2,$3,$4,$5,1,$6) RETURNING id',[input.name,input.categoryId??null,input.manufacturer||null,input.model||null,input.description,user.id])).rows[0].id;
  const attachmentId=randomUUID();await client.query("INSERT INTO attachments(id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by,content) VALUES($1,$2,$3,'text/plain',$4,$5,$6,$7)",[attachmentId,`postgresql:configuration/${attachmentId}`,`config-v${version}.txt`,bytes.length,createHash('sha256').update(bytes).digest('hex'),user.id,bytes]);
  await client.query('INSERT INTO configuration_versions(configuration_id,version,attachment_id,release_notes,created_by) VALUES($1,$2,$3,$4,$5)',[configId,String(version),attachmentId,input.releaseNotes,user.id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'CONFIG_UPDATED','configuration',$2,$3,$4)",[user.id,configId,`Zapisano konfigurację ${input.name}, wersja ${version}.`,JSON.stringify({name:input.name,version})]);return configId!;
 }));return getConfiguration(configId);
}
export async function applyConfiguration(id:string,body:unknown,user:User){
 requirePermission(user,'config.edit');requirePermission(user,'asset.edit');parse(uuidSchema,id);const {assetId,versionId,assetVersion}=parse(z.object({assetId:uuidSchema,versionId:uuidSchema,assetVersion:z.number().int().positive()}).strict(),body);
 return transaction(async client=>{const asset=(await client.query('SELECT id,asset_id,version FROM assets WHERE id=$1 FOR UPDATE',[assetId])).rows[0];if(!asset)throw new AppError(404,'Nie znaleziono urządzenia.');if(asset.version!==assetVersion)throw new AppError(409,'Urządzenie zmieniło się. Odśwież dane.');if(!(await client.query('SELECT id FROM configuration_versions WHERE id=$1 AND configuration_id=$2',[versionId,id])).rowCount)throw new AppError(404,'Wersja nie należy do konfiguracji.');await client.query('INSERT INTO asset_configurations(asset_id,configuration_version_id,applied_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[assetId,versionId,user.id]);await client.query('UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1',[assetId]);await client.query("INSERT INTO asset_history(asset_id,actor_id,action,description,after_data) VALUES($1,$2,'CONFIG_UPDATED','Zapisano przypisanie wersji konfiguracji.',$3)",[assetId,user.id,JSON.stringify({configurationId:id,versionId})]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'APPLY_CONFIGURATION','asset',$2,'Przypisano wersję konfiguracji.',$3)",[user.id,asset.asset_id,JSON.stringify({configurationId:id,versionId})]);return {saved:true};});
}
export async function listDocuments(user:User,q='',assetId?:string):Promise<LibraryDocument[]>{
 if(assetId)parse(uuidSchema,assetId);if(q.length>200)throw new AppError(400,'Wyszukiwanie może mieć najwyżej 200 znaków.');
 const {hasPermission}=await import('@/shared/permissions');
 const files=clean((await query<LibraryDocument>(`SELECT a.id,a.original_name AS name,a.mime_type AS "mimeType",a.size_bytes::int AS size,a.created_at AS "createdAt",u.name AS author,a.asset_id AS "assetId",a.invoice_id AS "invoiceId" FROM attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.content IS NOT NULL AND NOT EXISTS(SELECT 1 FROM configuration_versions v WHERE v.attachment_id=a.id) AND ($1='' OR a.original_name ILIKE '%'||$1||'%') AND ($2 OR a.invoice_id IS NULL) ${assetId?'AND (a.asset_id=$3 OR a.invoice_id=(SELECT invoice_id FROM assets WHERE id=$3))':''} ORDER BY a.created_at DESC LIMIT 200`,assetId?[q,hasPermission(user,'invoice.view'),assetId]:[q,hasPermission(user,'invoice.view')])).rows);
 if(assetId)return files;
 const archived=(await query<LibraryDocument>("SELECT d.id,concat_ws(' · ',d.reference,d.snapshot->'subject'->>'name') AS name,'text/html' AS \"mimeType\",0 AS size,d.created_at AS \"createdAt\",u.name AS author,NULL::uuid AS \"assetId\",NULL::uuid AS \"invoiceId\",true AS \"equipmentDocument\" FROM equipment_documents d JOIN users u ON u.id=d.created_by WHERE ($1='' OR concat_ws(' ',d.reference,d.snapshot->'subject'->>'name') ILIKE '%'||$1||'%') ORDER BY d.created_at DESC LIMIT 200",[q])).rows;
 return clean([...files,...archived]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);
}
export async function uploadDocument(name:string,content:Buffer,assetId:string|null,requestId:string,user:User){
 requirePermission(user,'document.upload');parse(uuidSchema,requestId);if(assetId)parse(uuidSchema,assetId);
 if(!name||name.length>180||/[\\/\x00-\x1f\x7f]/.test(name)||!content.length||content.length>10485760)throw new AppError(400,'Wybierz plik PDF lub tekstowy do 10 MB z poprawną nazwą.');
 const pdf=/\.pdf$/i.test(name);if(pdf)validateInvoicePdf(name,content);else if(!/\.(txt|md|json|cfg|conf|xml|yaml|yml|log)$/i.test(name)||content.length>262144||content.includes(0))throw new AppError(400,'Dokument tekstowy może mieć do 256 KB. Obsługiwane formaty: TXT, MD, JSON, CFG, CONF, XML, YAML, LOG.');
 if(!pdf)try{new TextDecoder('utf-8',{fatal:true}).decode(content);}catch{throw new AppError(400,'Dokument tekstowy musi używać UTF-8.');}
 const sha=createHash('sha256').update(content).digest('hex');
 return transaction(client=>idempotent(client,user,requestId,'UPLOAD_DOCUMENT',{name,assetId,sha},async()=>{const id=randomUUID();await client.query('INSERT INTO attachments(id,asset_id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,assetId,`postgresql:document/${id}`,name,pdf?'application/pdf':'text/plain',content.length,sha,user.id,content]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'UPLOAD_DOCUMENT','document',$2,$3,$4)",[user.id,id,`Dodano dokument ${name}.`,JSON.stringify({name,size:content.length,assetId})]);return {id,name};}));
}
export async function getDocument(id:string){parse(uuidSchema,id);const row=(await query<{name:string;content:Buffer;mimeType:string}>('SELECT original_name AS name,content,mime_type AS "mimeType" FROM attachments a WHERE id=$1 AND invoice_id IS NULL AND content IS NOT NULL AND NOT EXISTS(SELECT 1 FROM configuration_versions v WHERE v.attachment_id=a.id)',[id])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono dokumentu.');return row;}
export async function assetConfigurations(assetId:string){return clean((await query('SELECT v.id,c.id AS "configurationId",c.name,v.version,ac.applied_at AS "appliedAt",u.name AS author FROM asset_configurations ac JOIN configuration_versions v ON v.id=ac.configuration_version_id JOIN configurations c ON c.id=v.configuration_id JOIN users u ON u.id=ac.applied_by JOIN assets a ON a.id=ac.asset_id WHERE a.asset_id=$1 ORDER BY ac.applied_at DESC',[assetId])).rows);}
