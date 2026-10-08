import type {SearchResult,User} from '@/shared/types';
import {hasPermission,type Permission} from '@/shared/permissions';
import {searchQuery as query} from './db';
import {AppError} from './errors';
const like=(value:string)=>value.replace(/[\\%_]/g,c=>'\\'+c);
// At most this many search queries per request run at once (audit: up to 10 used
// to start together); queued ones are skipped when the browser cancels the request.
const perRequest=3;
async function limited<T>(tasks:(()=>Promise<T>)[],signal?:AbortSignal):Promise<T[]>{
 const results:T[]=new Array(tasks.length);let next=0;
 async function worker(){while(next<tasks.length){const index=next++;if(signal?.aborted)throw new AppError(499,'Wyszukiwanie zostało przerwane.');results[index]=await tasks[index]();}}
 await Promise.all(Array.from({length:Math.min(perRequest,tasks.length)},worker));
 return results;
}
export async function searchHardware(raw:string,user:User,signal?:AbortSignal):Promise<SearchResult[]>{
 let term=raw.trim();if(term.length<2)return [];if(term.length>200)throw new AppError(400,'Wyszukiwanie może mieć najwyżej 200 znaków.');
 try{const url=new URL(term,process.env.APP_URL);if(url.origin===new URL(process.env.APP_URL!).origin&&/^\/(asset|workstations)\/[^/]+$/.test(url.pathname))term=decodeURIComponent(url.pathname.split('/').at(-1)!);}catch{}
 const values=[`%${like(term)}%`,term.toLowerCase(),`${like(term)}%`];
 // Tasks are thunks: nothing touches the database until limited() runs them.
 const tasks:(()=>Promise<{type:SearchResult['type'];rows:{id:string;title:string;subtitle:string;score:number;href?:string}[]}>)[]=[];
 const add=(permission:Permission,type:SearchResult['type'],sql:string)=>{if(hasPermission(user,permission))tasks.push(()=>query<{id:string;title:string;subtitle:string;score:number}>(sql,values).then(r=>({type,rows:r.rows})));};
 const rank=(title:string,identifiers:string,text:string)=>`CASE WHEN lower(${identifiers})=$2 THEN 1000 WHEN ${title} ILIKE $3 THEN 700 WHEN ${text} ILIKE $1 THEN 500 ELSE (greatest(similarity(lower(${title}),$2),word_similarity($2,lower(${text})))*300)::int END`;
 const text="concat_ws(' ',a.asset_id,a.name,a.serial_number,a.rfid_tag,a.fixed_asset_number,a.manufacturer,a.model,a.hostname,a.mac_address::text,host(a.ip_address),e.name,l.path,i.number)";
 add('asset.view','asset',`WITH candidates AS (
 (SELECT a.id FROM assets a WHERE (coalesce(a.asset_id,'')||' '||coalesce(a.name,'')||' '||coalesce(a.serial_number,'')||' '||coalesce(a.model,'')||' '||coalesce(a.manufacturer,'')||' '||coalesce(a.hostname,'')||' '||coalesce(a.owner,'')||' '||coalesce(a.rfid_tag,'')||' '||coalesce(a.sku,'')||' '||coalesce(a.product_code,'')||' '||coalesce(a.fixed_asset_number,'')) ILIKE $1 OR coalesce(a.mac_address::text,'') ILIKE $1 OR coalesce(host(a.ip_address),'') ILIKE $1 ORDER BY (lower(a.asset_id)=$2 OR lower(a.serial_number)=$2 OR lower(a.rfid_tag)=$2) DESC NULLS LAST,a.asset_id LIMIT 100)
 UNION (SELECT a.id FROM assets a WHERE a.name % $2 OR lower(a.model) % $2 ORDER BY greatest(similarity(lower(a.name),$2),similarity(lower(a.model),$2)) DESC,a.asset_id LIMIT 60)
 UNION (SELECT a.id FROM assets a JOIN employees e ON e.id=a.employee_id WHERE e.name ILIKE $1 OR e.name % $2 ORDER BY a.asset_id LIMIT 30)
 UNION (SELECT a.id FROM assets a JOIN location_paths l ON l.id=a.location_id WHERE l.path ILIKE $1 ORDER BY a.asset_id LIMIT 30)
 UNION (SELECT a.id FROM assets a JOIN invoices i ON i.id=a.invoice_id WHERE i.number ILIKE $1 ORDER BY a.asset_id LIMIT 30)
 UNION SELECT asset_id FROM qr_codes WHERE id::text=$2 AND asset_id IS NOT NULL
) SELECT a.asset_id AS id,a.name AS title,concat_ws(' · ',a.asset_id,a.model,a.serial_number,l.path) AS subtitle,${rank('a.name','a.asset_id',text)}+CASE WHEN lower(a.asset_id)=$2 THEN 1000 WHEN lower(a.serial_number)=$2 OR lower(a.rfid_tag)=$2 THEN 500 ELSE 0 END AS score FROM assets a LEFT JOIN employees e ON e.id=a.employee_id LEFT JOIN location_paths l ON l.id=a.location_id LEFT JOIN invoices i ON i.id=a.invoice_id WHERE a.id IN (SELECT id FROM candidates) ORDER BY score DESC,a.asset_id LIMIT 12`);
 add('inventory.view','inventory',`SELECT slug AS id,name AS title,concat_ws(' · ',sku,slug,category) AS subtitle,${rank('name','slug',"concat_ws(' ',name,sku,product_code,slug,category)")} AS score FROM inventory_items WHERE concat_ws(' ',name,sku,product_code,slug,category) ILIKE $1 OR name % $2 ORDER BY score DESC,name LIMIT 6`);
 add('invoice.view','invoice',`SELECT i.id::text AS id,i.number AS title,s.name AS subtitle,${rank('i.number','i.number',"concat_ws(' ',i.number,s.name)")} AS score FROM invoices i JOIN suppliers s ON s.id=i.supplier_id WHERE concat_ws(' ',i.number,s.name) ILIKE $1 OR i.number % $2 ORDER BY score DESC,i.date DESC LIMIT 6`);
 add('location.manage','location',`SELECT id::text AS id,name AS title,path AS subtitle,${rank('name','name','path')} AS score FROM location_paths WHERE path ILIKE $1 OR name % $2 ORDER BY score DESC,path LIMIT 8`);
 add('employee.view','employee',`SELECT id::text AS id,name AS title,concat_ws(' · ',employee_number,department,email) AS subtitle,${rank('name',"coalesce(employee_number,'')","concat_ws(' ',name,employee_number,department,email)")} AS score FROM employees WHERE concat_ws(' ',name,employee_number,department,email) ILIKE $1 OR name % $2 ORDER BY score DESC,name LIMIT 6`);
 add('incident.view','incident',`SELECT id::text AS id,title,concat_ws(' · ',number,status,external_reference) AS subtitle,${rank('title','number',"concat_ws(' ',number,title,external_reference)")} AS score FROM incidents WHERE concat_ws(' ',number,title,external_reference) ILIKE $1 OR title % $2 ORDER BY score DESC,updated_at DESC LIMIT 6`);
 add('config.view','config',`SELECT id::text AS id,name AS title,concat_ws(' · ',manufacturer,model,'v'||latest_version) AS subtitle,${rank('name','name',"concat_ws(' ',name,manufacturer,model,description)")} AS score FROM configurations WHERE concat_ws(' ',name,manufacturer,model,description) ILIKE $1 OR name % $2 ORDER BY score DESC,updated_at DESC LIMIT 6`);
 add('document.view','document',`SELECT a.id::text AS id,a.original_name AS title,concat_ws(' · ',u.name,a.mime_type) AS subtitle,${rank('a.original_name','a.original_name','a.original_name')} AS score FROM attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.invoice_id IS NULL AND a.content IS NOT NULL AND NOT EXISTS(SELECT 1 FROM configuration_versions v WHERE v.attachment_id=a.id) AND (a.original_name ILIKE $1 OR a.original_name % $2) ORDER BY score DESC,a.created_at DESC LIMIT 6`);
 add('user.view','user',`SELECT id::text AS id,name AS title,concat_ws(' · ',email,role) AS subtitle,${rank('name','email',"(name||' '||email)")} AS score FROM users WHERE name ILIKE $1 OR email ILIKE $1 OR name % $2 ORDER BY score DESC,name LIMIT 6`);
 if(hasPermission(user,'document.view'))tasks.push(()=>query<{id:string;title:string;subtitle:string;score:number;href:string}>(`SELECT id::text AS id,reference AS title,snapshot->'subject'->>'name' AS subtitle,${rank('reference','reference',"(reference||' '||(snapshot->'subject'->>'name'))")} AS score,'/documents?equipmentDocument='||id::text AS href FROM equipment_documents WHERE reference ILIKE $1 OR snapshot->'subject'->>'name' ILIKE $1 ORDER BY score DESC,created_at DESC LIMIT 6`,values).then(r=>({type:'document',rows:r.rows})));
 const href:Record<SearchResult['type'],(id:string)=>string>={asset:id=>`/asset/${encodeURIComponent(id)}`,inventory:id=>`/inventory/${encodeURIComponent(id)}`,invoice:id=>`/invoice/${id}`,location:id=>`/locations?selected=${id}`,employee:id=>`/employees/${id}`,incident:id=>`/incidents/${id}`,config:id=>`/configs/${id}`,document:id=>`/documents?selected=${id}`,user:()=>'/users'};
 return (await limited(tasks,signal)).flatMap(({type,rows})=>rows.map(r=>({...r,type,href:r.href??(type==='user'?'/users?q='+encodeURIComponent(r.subtitle.split(' · ')[0]):type==='document'?'/documents?selected='+r.id+'&q='+encodeURIComponent(r.title):href[type](r.id))}))).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'pl')).slice(0,40);
}
