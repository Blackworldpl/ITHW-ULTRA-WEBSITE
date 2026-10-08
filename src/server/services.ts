import {z} from 'zod';
import type {SerialMatch,SerialPreview} from '@/shared/purchase';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Asset, AssetStatus, Dashboard, Delivery, History, InventoryItem, Invoice, InvoiceDetail, InvoiceLine, Location, Lookups, Named, PageResult, User } from '@/shared/types';
import { statuses, statusLabels } from '@/shared/types';
import { csv } from './csv';
import {listCategories,listSuppliers,listEmployees,getEmployee,saveDictionary,supplierProjection} from './directory';
import {categoryFieldError} from '@/shared/category-fields';
import type {Category,Employee,Supplier,SupplierOption} from '@/shared/types';
import { pool, query, transaction } from './db';
import {lookupParts,type LookupPart} from '@/shared/types';
import { AppError } from './errors';
import { assetActionSchema, assetIdSchema, assetPatchSchema, assetSchema, categorySchema, dateSchema, deliverySchema, inventoryPatchSchema, inventorySchema, invoiceSchema, invoicePatchSchema, locationSchema, movementSchema, parse, slugSchema, stockCorrectionSchema, supplierSchema, uuidSchema, quantitySchema } from './validation';
import {invoiceTotal,purchaseTotal,moneyCents} from '@/shared/money';
import {hasPermission,type Permission} from '@/shared/permissions';
import {requirePermission,actionPermission} from './permissions';
import {inventoryProjection,inventoryFrom} from './inventory-list';
import {validateInventoryChoices,inventoryUnitPrecision,requireQuantityPrecision} from './inventory-dictionaries';
import {addQuantity,subtractQuantity} from '@/shared/quantity';
export {listInventory} from './inventory-list';

type Executor = Pool | PoolClient;
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const advancedRoles = ['IT_ADVANCED','ADMIN'];
function requireRole(user: User, allowed: readonly string[]) {
  if (!allowed.includes(user.role)) throw new AppError(403, 'Brak uprawnień do wykonania tej operacji.');
}
function pgError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const code = (error as { code?: string }).code;
  if (code === '23505') throw new AppError(409, 'Rekord z tym numerem seryjnym, RFID, SKU, nazwą lub numerem faktury już istnieje.');
  if (code === '23503') throw new AppError(400, 'Wybrana kategoria, lokalizacja, faktura lub dostawca nie istnieje.');
  if (code === '23514' || code === '22003' || code === '22P02') throw new AppError(400, 'Dane naruszają ograniczenia: sprawdź ilość, kwotę, właściciela i numer środka trwałego.');
  throw error;
}
async function mutate<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  try { return await transaction(fn); } catch (error) { return pgError(error); }
}

export const assetProjection = `a.id,a.asset_id AS "assetId",a.name,a.category_id AS "categoryId",c.name AS "categoryName",
 a.manufacturer,a.model,a.serial_number AS "serialNumber",a.mac_address::text AS "macAddress",host(a.ip_address) AS "ipAddress",a.hostname,
 a.location_id AS "locationId",l.path AS "locationName",a.status,COALESCE(emp.name,a.owner) AS owner,a.employee_id AS "employeeId",a.sku,a.product_code AS "productCode",a.purchased_at::text AS "purchasedAt",a.purchase_price::text AS "purchasePrice",COALESCE(i.currency,'PLN') AS "purchaseCurrency",
 (SELECT it.position FROM invoice_item_assets ia JOIN invoice_items it ON it.id=ia.invoice_item_id WHERE ia.asset_id=a.id) AS "invoiceItemPosition",(SELECT it.name FROM invoice_item_assets ia JOIN invoice_items it ON it.id=ia.invoice_item_id WHERE ia.asset_id=a.id) AS "invoiceItemName",a.invoice_id AS "invoiceId",i.number AS "invoiceNumber",s.name AS "supplierName",a.warranty_until::text AS "warrantyUntil",
 a.received_at AS "receivedAt",a.issued_at AS "issuedAt",a.is_fixed_asset AS "isFixedAsset",a.fixed_asset_number AS "fixedAssetNumber",
 a.rfid_tag AS "rfidTag",a.notes,a.custom_fields AS "customFields",a.created_at AS "createdAt",a.updated_at AS "updatedAt",a.version`;
export const assetFrom = `FROM assets a JOIN asset_categories c ON c.id=a.category_id
 LEFT JOIN location_paths l ON l.id=a.location_id LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN employees emp ON emp.id=a.employee_id`;
// category_id is required and references a category, so that join never changes
// the count; the remaining LEFT JOINs on unique keys are dropped by the planner
// unless a filter uses them.
const assetCountFrom = `FROM assets a
 LEFT JOIN location_paths l ON l.id=a.location_id LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN employees emp ON emp.id=a.employee_id`;
const assetDefaultOrder = 'a.created_at DESC,a.id';
// Microsecond UTC timestamp and id: independent of the session's DateStyle/TimeZone.
const assetCursor = `(to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||a.id::text)`;
const invoiceProjection = `i.id,i.number,i.supplier_id AS "supplierId",s.name AS "supplierName",i.date::text AS date,i.amount::text AS amount,
 i.currency,i.order_number AS "orderNumber",u.name AS "receivedBy",i.created_at AS "createdAt",i.version,i.notes`;
const invoiceFrom = 'FROM invoices i JOIN suppliers s ON s.id=i.supplier_id JOIN users u ON u.id=i.received_by';
const deliveryProjection = `d.id,d.invoice_id AS "invoiceId",i.number AS "invoiceNumber",s.name AS "supplierName",d.received_at AS "receivedAt",
 u.name AS "receivedBy",COALESCE((SELECT sum(di.quantity)::float8 FROM delivery_items di WHERE di.delivery_id=d.id),0) AS "itemCount",COALESCE((SELECT jsonb_agg(jsonb_build_object('unit',q.unit,'quantity',q.quantity) ORDER BY q.unit) FROM (SELECT it.unit,sum(di.quantity) AS quantity FROM delivery_items di JOIN invoice_items it ON it.id=di.invoice_item_id WHERE di.delivery_id=d.id GROUP BY it.unit) q),'[]'::jsonb) AS quantities,d.notes`;
const deliveryFrom = 'FROM deliveries d JOIN invoices i ON i.id=d.invoice_id JOIN suppliers s ON s.id=i.supplier_id JOIN users u ON u.id=d.received_by';
const auditProjection = `e.id,e.action,COALESCE(u.name,'System') AS "actorName",e.created_at AS "createdAt",e.description,e.before_data AS before,e.after_data AS after`;
const assetSearchExpression = `(coalesce(a.asset_id,'') || ' ' || coalesce(a.name,'') || ' ' || coalesce(a.serial_number,'') || ' ' ||
 coalesce(a.model,'') || ' ' || coalesce(a.manufacturer,'') || ' ' || coalesce(a.hostname,'') || ' ' || coalesce(emp.name,a.owner,'') || ' ' || coalesce(a.rfid_tag,'') || ' ' || coalesce(a.sku,'') || ' ' || coalesce(a.product_code,''))`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, character => `\\${character}`);
// Same expression as assets_extended_search_idx (migration 010), so it is indexed.
const indexedAssetText = `(coalesce(a.asset_id,'')||' '||coalesce(a.name,'')||' '||coalesce(a.serial_number,'')||' '||coalesce(a.model,'')||' '||coalesce(a.manufacturer,'')||' '||coalesce(a.hostname,'')||' '||coalesce(a.owner,'')||' '||coalesce(a.rfid_tag,'')||' '||coalesce(a.sku,'')||' '||coalesce(a.product_code,'')||' '||coalesce(a.fixed_asset_number,''))`;
// Indexed conditions that every asset matching the list search satisfies. The
// original predicate is still applied, so results and order do not change; the
// planner can now pick indexes instead of computing the text for every row.
// A term without a space can only match inside one field: the indexed text covers
// every field except the current employee name, which has its own condition.
// A term with a space may span fields; it differs from the indexed text only where
// the stored owner differs from the current employee name (a renamed employee),
// so those few assets are always included.
function assetCandidates(p: string, term: string) {
  const arms = [
    `${indexedAssetText} ILIKE ${p}`,
    `coalesce(a.mac_address::text,'') ILIKE ${p}`,
    `coalesce(host(a.ip_address),'') ILIKE ${p}`,
    `a.employee_id = ANY(ARRAY(SELECT id FROM employees WHERE name ILIKE ${p}))`,
    `a.invoice_id = ANY(ARRAY(SELECT id FROM invoices WHERE number ILIKE ${p}))`,
  ];
  if (term.includes(' ')) arms.push(`a.id = ANY(ARRAY(SELECT ca.id FROM assets ca JOIN employees ce ON ce.id=ca.employee_id WHERE ca.owner IS DISTINCT FROM ce.name))`);
  return `(${arms.join(' OR ')})`;
}

async function assetById(assetId: string, executor: Executor = pool): Promise<Asset> {
  const result = await executor.query<Asset>(`SELECT ${assetProjection} ${assetFrom} WHERE a.asset_id=$1`, [assetId]);
  if (!result.rows[0]) throw new AppError(404, 'Nie znaleziono urządzenia.');
  return clean(result.rows[0]);
}
async function inventoryBySlug(slug: string, executor: Executor = pool): Promise<InventoryItem> {
  const result = await executor.query<InventoryItem>(`SELECT ${inventoryProjection} ${inventoryFrom} WHERE n.slug=$1`, [slug]);
  if (!result.rows[0]) throw new AppError(404, 'Nie znaleziono produktu magazynowego.');
  return clean(result.rows[0]);
}
async function deliveryById(id: string, executor: Executor = pool): Promise<Delivery> {
  const result = await executor.query<Delivery>(`SELECT ${deliveryProjection} ${deliveryFrom} WHERE d.id=$1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'Nie znaleziono dostawy.');
  return clean(result.rows[0]);
}

async function audit(client: PoolClient, user: User, action: string, entityType: string, entityId: string, description: string, before: unknown = null, after: unknown = null) {
  await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [user.id,action,entityType,entityId,description,before === null ? null : JSON.stringify(before),after === null ? null : JSON.stringify(after)]);
}
async function assetEvent(client: PoolClient, user: User, action: string, asset: Asset, description: string, before: Asset | null = null) {
  await client.query(`INSERT INTO asset_history(asset_id,actor_id,action,description,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)`,
    [asset.id,user.id,action,description,before ? JSON.stringify(before) : null,JSON.stringify(asset)]);
  await audit(client,user,action,'asset',asset.assetId,description,before,asset);
}
async function ensureRfid(client: PoolClient, user: User, asset: Asset) {
  await client.query('UPDATE rfid_tags SET asset_id=NULL,assigned_by=NULL,assigned_at=NULL WHERE asset_id=$1 AND lower(tag_uid) IS DISTINCT FROM lower($2::text)', [asset.id,asset.rfidTag]);
  if (!asset.rfidTag) return;
  const result = await client.query(`INSERT INTO rfid_tags(tag_uid,asset_id,assigned_by,assigned_at) VALUES(lower($1),$2,$3,now())
    ON CONFLICT(tag_uid) DO UPDATE SET asset_id=EXCLUDED.asset_id,assigned_by=EXCLUDED.assigned_by,assigned_at=EXCLUDED.assigned_at
    WHERE rfid_tags.asset_id IS NULL OR rfid_tags.asset_id=EXCLUDED.asset_id RETURNING id`, [asset.rfidTag,asset.id,user.id]);
  if (!result.rowCount) throw new AppError(409, 'Tag RFID jest już przypisany do innego urządzenia.');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export async function idempotent<T>(client: PoolClient, user: User, requestId: string, operation: string, payload: unknown, apply: () => Promise<T>): Promise<T> {
  const hash = createHash('sha256').update(canonical(payload)).digest('hex');
  const inserted = await client.query(`INSERT INTO idempotency_requests(request_id,actor_id,operation,payload_hash)
    VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING RETURNING request_id`, [requestId,user.id,operation,hash]);
  if (!inserted.rowCount) {
    const previous = await client.query<{ actor_id: string; operation: string; payload_hash: string; response: T | null }>(
      'SELECT actor_id,operation,payload_hash,response FROM idempotency_requests WHERE request_id=$1 FOR UPDATE', [requestId]);
    const record = previous.rows[0];
    if (!record || record.actor_id !== user.id || record.operation !== operation || record.payload_hash !== hash) {
      throw new AppError(409, 'Identyfikator tej operacji został już użyty z innymi danymi lub przez inną osobę.');
    }
    if (record.response === null) throw new AppError(409, 'Operacja jest jeszcze przetwarzana. Spróbuj ponownie.');
    return record.response;
  }
  const response = await apply();
  await client.query('UPDATE idempotency_requests SET response=$2 WHERE request_id=$1', [requestId,JSON.stringify(response)]);
  return response;
}

function paging(params: URLSearchParams) {
  const page = Number(params.get('page') ?? 1), pageSize = Number(params.get('pageSize') ?? 25);
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new AppError(400, 'Nieprawidłowa strona lub rozmiar strony (1–100).');
  }
  return { page,pageSize,offset:(page-1)*pageSize };
}
type PageOptions = {
  /** Row identity used to page over narrow rows before building the projection. */
  key: string;
  /** Count without joins that cannot change the row count (defaults to `from`). */
  countFrom?: string;
  /** SQL for an opaque position of a row; the last row's value is returned as nextCursor. */
  cursor?: string;
  /** Keyset continuation (rows after a cursor): replaces OFFSET, not used for the count. */
  after?: {filter: string; values: unknown[]};
};
async function paginated<T extends QueryResultRow>(projection: string, from: string, filters: string[], values: unknown[], order: string, params: URLSearchParams, options: PageOptions): Promise<PageResult<T>> {
  const {page,pageSize} = paging(params);
  const offset = options.after ? 0 : (page-1)*pageSize;
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rowFilters = options.after ? [...filters,options.after.filter] : filters, rowValues = options.after ? [...values,...options.after.values] : values;
  const rowWhere = rowFilters.length ? `WHERE ${rowFilters.join(' AND ')}` : '';
  // Sort and page narrow rows first, then build the full projection (joins and
  // correlated subqueries) for this page only instead of for every matching row.
  const pageIds = `SELECT ${options.key} ${from} ${rowWhere} ORDER BY ${order} LIMIT $${rowValues.length+1} OFFSET $${rowValues.length+2}`;
  const cursorColumn = options.cursor ? `,${options.cursor} AS "pageCursor"` : '';
  const [rows,total] = await Promise.all([
    query<T & {pageCursor?: string}>(`SELECT ${projection}${cursorColumn} ${from} WHERE ${options.key} IN (${pageIds}) ORDER BY ${order}`, [...rowValues,pageSize,offset]),
    query<{ total: number }>(`SELECT count(*)::integer AS total ${options.countFrom ?? from} ${where}`, values),
  ]);
  const items = rows.rows;
  const nextCursor = options.cursor && items.length === pageSize ? items[items.length-1].pageCursor ?? null : null;
  for (const item of items) delete item.pageCursor;
  return {items,total:total.rows[0].total,page,pageSize,...(options.cursor ? {nextCursor} : {})};
}
function searchTerm(params: URLSearchParams): string | null {
  const term = params.get('q')?.trim();
  if (!term) return null;
  if (term.length > 200) throw new AppError(400, 'Wyszukiwanie może mieć najwyżej 200 znaków.');
  return `%${escapeLike(term)}%`;
}

// Shared dictionaries loaded at start and after edits. Employees and invoices are
// no longer included (they were most of the payload): the pickers search them on
// demand. `only` returns just the parts a screen changed.
export async function getLookups(user: User, only?: string | null): Promise<Partial<Lookups>> {
  const parts = new Set<LookupPart>(only ? only.split(',').map(part => parse(z.enum(lookupParts), part.trim())) : lookupParts);
  const result: Partial<Lookups> = {};
  await Promise.all([
    parts.has('categories') && listCategories().then(rows => { result.categories = rows; }),
    parts.has('locations') && (hasPermission(user,'location.view') ? query<Location>('SELECT id,name,path,kind,parent_id AS "parentId",version,asset_count AS "assetCount",child_count AS "childCount" FROM location_summary ORDER BY path').then(r => r.rows) : Promise.resolve([] as Location[])).then(rows => {
      if(!hasPermission(user,'asset.view')) for(const l of rows) delete l.assetCount;
      result.locations = rows;
    }),
    // Bank account, contacts and notes require purchase access (F02). Asset viewers
    // only need id and name for the supplier filter; names are already on assets.
    parts.has('suppliers') && (hasPermission(user,'invoice.view') ? listSuppliers() : hasPermission(user,'asset.view') ? query<SupplierOption>('SELECT id,name FROM suppliers ORDER BY name').then(r=>r.rows) : Promise.resolve([] as SupplierOption[])).then(rows => { result.suppliers = rows; }),
    parts.has('users') && (user.role === 'ADMIN' ? query<User>('SELECT id,name,email,role,active FROM users ORDER BY name').then(r => r.rows) : Promise.resolve([] as User[])).then(rows => { result.users = rows; }),
    parts.has('settings') && import('./product-operations').then(module => module.getSystemSettings()).then(settings => { result.serviceNowUrl = settings.serviceNowUrl; }),
  ]);
  return result;
}

export async function getDashboard(user: User): Promise<Dashboard> {
  const visibleEntities=([['asset','asset.history'],['inventory','inventory.view'],['invoice','invoice.view'],['delivery','invoice.view'],['location','location.view'],['employee','employee.view'],['configuration','config.view'],['document','document.view'],['incident','incident.view']] as [string,Permission][]).filter(([,p])=>hasPermission(user,p)).map(([t])=>t);
  const monthStart = `(date_trunc('month',now() AT TIME ZONE 'Europe/Warsaw') AT TIME ZONE 'Europe/Warsaw')`;
  const [assetCounts,inventoryCounts,lowStock,deliveryCounts,recentDeliveries,recentAssets,activity] = await Promise.all([
    query<{status:AssetStatus; count:number}>('SELECT status,count(*)::integer AS count FROM assets GROUP BY status'),
    query<{total:number; low:number}>('SELECT count(*)::integer AS total,count(*) FILTER(WHERE stock<=minimal_stock)::integer AS low FROM inventory_items'),
    query<InventoryItem>(`SELECT ${inventoryProjection} ${inventoryFrom} WHERE n.stock<=n.minimal_stock ORDER BY (n.stock-n.minimal_stock),n.name LIMIT 10`),
    query<{deliveries:number; assets:number}>(`SELECT (SELECT count(*)::integer FROM deliveries WHERE received_at>=${monthStart}) AS deliveries,
      (SELECT count(*)::integer FROM assets WHERE received_at>=${monthStart}) AS assets`),
    query<Delivery>(`SELECT ${deliveryProjection} ${deliveryFrom} ORDER BY d.received_at DESC,d.id LIMIT 5`),
    query<Asset>(`SELECT ${assetProjection} ${assetFrom} ORDER BY a.created_at DESC,a.id LIMIT 5`),
    query<History>(`SELECT ${auditProjection} FROM audit_logs e LEFT JOIN users u ON u.id=e.actor_id WHERE e.entity_type=ANY($1::text[]) ORDER BY e.created_at DESC,e.id LIMIT 12`,[visibleEntities]),
  ]);
  const statusCounts = Object.fromEntries(statuses.map(status => [status,0])) as Record<AssetStatus,number>;
  for (const row of assetCounts.rows) statusCounts[row.status] = row.count;
  if(!hasPermission(user,'asset.view')) {for(const status of statuses)statusCounts[status]=0;recentAssets.rows=[];deliveryCounts.rows[0].assets=0;}
  if(!hasPermission(user,'inventory.view')){inventoryCounts.rows[0]={total:0,low:0};lowStock.rows=[];}
  if(!hasPermission(user,'invoice.view')){deliveryCounts.rows[0].deliveries=0;recentDeliveries.rows=[];}
  const totalAssets = Object.values(statusCounts).reduce((sum,count) => sum+count,0);
  return clean({totalAssets,activeAssets:totalAssets-statusCounts.RETIRED,statusCounts,
    inventoryCount:inventoryCounts.rows[0].total,lowStockCount:inventoryCounts.rows[0].low,lowStock:lowStock.rows,
    monthDeliveries:deliveryCounts.rows[0].deliveries,monthReceivedAssets:deliveryCounts.rows[0].assets,
    recentDeliveries:recentDeliveries.rows,recentAssets:recentAssets.rows,activity:activity.rows});
}

function assetFilters(params: URLSearchParams) {
  const filters: string[] = [], values: unknown[] = [];
  const add = (expression: string, value: unknown) => { values.push(value); filters.push(expression.replace('?', `$${values.length}`)); };
  const term = searchTerm(params);
  if (term) {
    values.push(term);
    const p = `$${values.length}`;
    filters.push(assetCandidates(p,params.get('q')!.trim()));
    filters.push(`(${assetSearchExpression} ILIKE ${p} OR a.mac_address::text ILIKE ${p} OR host(a.ip_address) ILIKE ${p} OR i.number ILIKE ${p} OR a.fixed_asset_number ILIKE ${p})`);
  }
  for (const [key,column] of [['categoryId','a.category_id'],['invoiceId','a.invoice_id'],['supplierId','i.supplier_id']] as const) {
    if (params.get(key)) add(`${column}=?`, parse(uuidSchema,params.get(key)));
  }
  if(params.get('employeeId'))add('a.employee_id=?',parse(uuidSchema,params.get('employeeId')));
  if(params.get('includeChildren') && !['true','false'].includes(params.get('includeChildren')!)) throw new AppError(400,'Nieprawidłowy filtr podlokalizacji.');
  if(params.get('locationId')) {
    const id=parse(uuidSchema,params.get('locationId'));
    if(params.get('includeChildren')==='true') add(`a.location_id IN (WITH RECURSIVE subtree AS (SELECT id FROM locations WHERE id=? UNION ALL SELECT l.id FROM locations l JOIN subtree s ON l.parent_id=s.id) SELECT id FROM subtree)`,id);
    else add('a.location_id=?',id);
  }
  for(const key of ['noLocation','active']) if(params.get(key) && !['true','false'].includes(params.get(key)!)) throw new AppError(400,'Nieprawidłowy filtr logiczny.');
  if(params.get('noLocation')==='true') filters.push('a.location_id IS NULL');
  if(params.get('active')==='true') filters.push("a.status<>'RETIRED'");
  if(params.get('fixed')) {
    if(!['true','false'].includes(params.get('fixed')!)) throw new AppError(400,'Nieprawidłowy filtr środka trwałego.');
    add('a.is_fixed_asset=?',params.get('fixed')==='true');
  }
  if (params.get('status')) {
    const status = params.get('status')!;
    if (!statuses.includes(status as AssetStatus)) throw new AppError(400, 'Nieprawidłowy status.');
    add('a.status=?',status);
  }
  for (const key of ['manufacturer','model','owner'] as const) {
    const value = params.get(key)?.trim();
    if (value) {
      if (value.length > 200) throw new AppError(400, 'Filtr jest zbyt długi.');
      add(`${key==='owner'?'COALESCE(emp.name,a.owner)':`a.${key}`} ILIKE ?`,`%${escapeLike(value)}%`);
    }
  }
  if (params.get('purchasedFrom')) add('a.purchased_at>=?',parse(dateSchema,params.get('purchasedFrom')));
  if (params.get('purchasedTo')) add('a.purchased_at<=?',parse(dateSchema,params.get('purchasedTo')));
  const warranty = params.get('warranty');
  if (warranty === 'expired') filters.push("a.warranty_until<(now() AT TIME ZONE 'Europe/Warsaw')::date");
  else if (warranty === 'soon') filters.push("a.warranty_until BETWEEN (now() AT TIME ZONE 'Europe/Warsaw')::date AND (now() AT TIME ZONE 'Europe/Warsaw')::date+30");
  else if (warranty === 'valid') filters.push("a.warranty_until>(now() AT TIME ZONE 'Europe/Warsaw')::date+30");
  else if (warranty === 'none') filters.push('a.warranty_until IS NULL');
  else if (warranty) throw new AppError(400,'Nieprawidłowy filtr gwarancji.');
  const sorts:Record<string,string>={newest:assetDefaultOrder,oldest:'a.created_at,a.id',name:'a.name,a.id','name-desc':'a.name DESC,a.id',assetId:'a.asset_id,a.id',warranty:'a.warranty_until ASC NULLS LAST,a.id',serial:'a.serial_number ASC NULLS LAST,a.id','serial-desc':'a.serial_number DESC NULLS LAST,a.id',location:'l.path ASC NULLS LAST,a.id','location-desc':'l.path DESC NULLS LAST,a.id',owner:'COALESCE(emp.name,a.owner) ASC NULLS LAST,a.id','owner-desc':'COALESCE(emp.name,a.owner) DESC NULLS LAST,a.id',updated:'a.updated_at DESC,a.id'};
  const sort=params.get('sort')||'newest';
  if(!Object.hasOwn(sorts,sort)) throw new AppError(400,'Nieprawidłowe sortowanie.');
  return {filters,values,order:sorts[sort]};
}
export async function listAssets(params: URLSearchParams): Promise<PageResult<Asset>> {
  const {filters,values,order}=assetFilters(params);
  // Default order: the client continues with the cursor of the previous page, so a
  // deep page reads from the index instead of skipping every earlier row (OFFSET).
  const defaultOrder = order === assetDefaultOrder, cursor = params.get('after');
  let after: PageOptions['after'];
  if (cursor && defaultOrder) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|([0-9a-f-]{36})$/.exec(cursor);
    if (!match) throw new AppError(400,'Nieprawidłowy kursor strony.');
    const at = `$${values.length+1}::timestamptz`, id = `$${values.length+2}::uuid`;
    // created_at DESC, id ASC: the first condition lets the index range-scan.
    after = {filter:`a.created_at<=${at} AND (a.created_at<${at} OR a.id>${id})`,values:[match[1],parse(uuidSchema,match[2])]};
  }
  return paginated<Asset>(assetProjection,assetFrom,filters,values,order,params,{key:'a.id',countFrom:assetCountFrom,...(defaultOrder?{cursor:assetCursor,after}:{})});
}
export async function exportAssets(params:URLSearchParams,user:User):Promise<string> {
  requireRole(user,advancedRoles);
  const {filters,values,order}=assetFilters(params);
  const where=filters.length?`WHERE ${filters.join(' AND ')}`:'';
  const result=await query<Asset>(`SELECT ${assetProjection} ${assetFrom} ${where} ORDER BY ${order} LIMIT 10001`,values);
  if(result.rows.length>10000) throw new AppError(413,'Eksport obejmuje ponad 10 000 urządzeń. Zawęź filtry.');
  return csv([
    ['Asset ID','Nazwa','Kategoria','Status','Lokalizacja','Użytkownik','Numer seryjny','Producent','Model','Środek trwały','Numer środka trwałego','Cena zakupu','Waluta','Data zakupu','Gwarancja do','Faktura','RFID'],
    ...result.rows.map(a=>[a.assetId,a.name,a.categoryName,statusLabels[a.status],a.locationName,a.owner,a.serialNumber,a.manufacturer,a.model,a.isFixedAsset?'Tak':'Nie',a.fixedAssetNumber,a.purchasePrice,a.purchaseCurrency,a.purchasedAt,a.warrantyUntil,a.invoiceNumber,a.rfidTag]),
  ]);
}
export async function resolveScan(code:string):Promise<{href:string}> {
  const value=code.trim();
  if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)){const qr=(await query<{href:string}>('SELECT target_path AS href FROM qr_codes WHERE id=$1',[value])).rows[0];if(qr)return qr;}
  if(!value || value.length>200) throw new AppError(400,'Wpisz identyfikator o długości 1–200 znaków.');
  const rows=await query<{href:string}>(`SELECT '/asset/'||asset_id AS href FROM assets
    WHERE lower(asset_id)=lower($1) OR lower(serial_number)=lower($1) OR lower(rfid_tag)=lower($1) OR lower(fixed_asset_number)=lower($1) OR lower(sku)=lower($1) OR lower(product_code)=lower($1)
    UNION SELECT '/inventory/'||slug FROM inventory_items WHERE lower(slug)=lower($1) OR lower(sku)=lower($1) OR lower(product_code)=lower($1) LIMIT 3`,[value]);
  if(!rows.rowCount) throw new AppError(404,'Nie znaleziono urządzenia ani produktu z tym kodem.');
  if(rows.rowCount>1) throw new AppError(409,'Kod pasuje do kilku rekordów. Użyj Asset ID lub wyszukiwarki, aby wybrać właściwy.');
  return rows.rows[0];
}

export function getAsset(assetId: string): Promise<Asset> { return assetById(parse(assetIdSchema,assetId)); }

const assetColumns: Record<string,string> = {
  name:'name',categoryId:'category_id',manufacturer:'manufacturer',model:'model',serialNumber:'serial_number',macAddress:'mac_address',ipAddress:'ip_address',hostname:'hostname',
  locationId:'location_id',status:'status',owner:'owner',purchasedAt:'purchased_at',purchasePrice:'purchase_price',invoiceId:'invoice_id',warrantyUntil:'warranty_until',
  isFixedAsset:'is_fixed_asset',fixedAssetNumber:'fixed_asset_number',rfidTag:'rfid_tag',notes:'notes',customFields:'custom_fields',
  employeeId:'employee_id',sku:'sku',productCode:'product_code',
};
async function resolveEmployee(client:PoolClient,id:string){const row=(await client.query<{name:string;active:boolean}>('SELECT name,active FROM employees WHERE id=$1 FOR SHARE',[id])).rows[0];if(!row?.active)throw new AppError(400,'Wybierz aktywnego pracownika.');return row.name;}
async function validateCategory(client:PoolClient,categoryId:string,values:Record<string,string>,context=''){const row=(await client.query<Category>('SELECT field_definitions AS "fieldDefinitions" FROM asset_categories WHERE id=$1 FOR SHARE',[categoryId])).rows[0];if(!row)throw new AppError(400,'Nie znaleziono kategorii.');const error=categoryFieldError(row.fieldDefinitions,values??{});if(error)throw new AppError(400,context+error);}
function checkAssetRules(asset: { status: string; owner?: string | null; isFixedAsset: boolean; fixedAssetNumber?: string | null; purchasedAt?: string | null; warrantyUntil?: string | null }) {
  if (asset.status === 'ASSIGNED' && !asset.owner) throw new AppError(400,'Urządzenie wydane musi mieć użytkownika.');
  if (asset.isFixedAsset && !asset.fixedAssetNumber) throw new AppError(400,'Podaj numer środka trwałego.');
  if (asset.purchasedAt && asset.warrantyUntil && asset.warrantyUntil < asset.purchasedAt) throw new AppError(400,'Gwarancja nie może kończyć się przed datą zakupu.');
}
export async function createAsset(body: unknown, user: User, existingClient?: PoolClient): Promise<Asset> {
  requireRole(user,advancedRoles);
  requirePermission(user,'asset.create');
  const input = parse(assetSchema,body);
  if(input.employeeId||input.owner)requirePermission(user,'asset.assign');
  if(input.rfidTag)requirePermission(user,'rfid.edit');
  const create = async (client: PoolClient) => {
    if(input.employeeId)input.owner=await resolveEmployee(client,input.employeeId);
    checkAssetRules(input);await validateCategory(client,input.categoryId,input.customFields);
    const entries = Object.entries(input).filter(([,value]) => value !== undefined);
    const columns = entries.map(([key]) => assetColumns[key]);
    const values = entries.map(([key,value]) => key === 'customFields' ? JSON.stringify(value) : value);
    const result = await client.query<{asset_id:string}>(`INSERT INTO assets(${columns.join(',')}${input.status === 'ASSIGNED' ? ',issued_at' : ''})
      VALUES(${values.map((_,i) => `$${i+1}`).join(',')}${input.status === 'ASSIGNED' ? ',now()' : ''}) RETURNING asset_id`, values);
    const asset = await assetById(result.rows[0].asset_id,client);
    await ensureRfid(client,user,asset);
    await client.query('INSERT INTO qr_codes(asset_id,target_path,created_by) VALUES($1,$2,$3)', [asset.id,`/asset/${asset.assetId}`,user.id]);
    await assetEvent(client,user,'CREATE_ASSET',asset,`Dodano urządzenie ${asset.name} (${asset.assetId}).`);
    return asset;
  };
  return existingClient ? create(existingClient) : mutate(create);
}

export async function updateAsset(assetId: string, body: unknown, user: User): Promise<Asset> {
  requireRole(user,advancedRoles);
  requirePermission(user,'asset.edit');
  parse(assetIdSchema,assetId);
  const input = parse(assetPatchSchema,body);
  return mutate(client=>applyAssetUpdate(client,assetId,input,user));
}
async function applyAssetUpdate(client:PoolClient,assetId:string,input:ReturnType<typeof assetPatchSchema.parse>,user:User,action='UPDATE_ASSET',description?:string):Promise<Asset> {
    // Serialize edits on this asset, then enforce the caller's version.
    const lock = await client.query('SELECT id FROM assets WHERE asset_id=$1 FOR UPDATE',[assetId]);
    if (!lock.rowCount) throw new AppError(404,'Nie znaleziono urządzenia.');
    const before = await assetById(assetId,client);
    if (before.version !== input.version) throw new AppError(409,'Ktoś zmienił ten rekord. Odśwież urządzenie przed zapisem.');
    if(input.employeeId)input.owner=await resolveEmployee(client,input.employeeId);
    else if(input.owner!==undefined && input.employeeId===undefined)input.employeeId=null;
    const merged = {...before,...input};
    if(action==='UPDATE_ASSET'){
    if(input.locationId!==undefined&&input.locationId!==before.locationId)requirePermission(user,'asset.move');
    if(input.status!==undefined&&input.status!==before.status)requirePermission(user,'asset.status');
    if(input.owner!==undefined&&input.owner!==before.owner||input.employeeId!==undefined&&input.employeeId!==before.employeeId)requirePermission(user,'asset.assign');
    if(input.rfidTag!==undefined&&input.rfidTag!==before.rfidTag)requirePermission(user,'rfid.edit');
    if(input.invoiceId!==undefined&&input.invoiceId!==before.invoiceId)requirePermission(user,'invoice.edit');
    }
    // Equipment received from a purchase may lack category fields (it starts in
    // PREPARATION); issuing it to a person requires the required fields (F05).
    const issuing=merged.status==='ASSIGNED'&&(before.status!=='ASSIGNED'||merged.owner!==before.owner||merged.employeeId!==before.employeeId);
    if(issuing||input.categoryId!==undefined||input.customFields!==undefined)await validateCategory(client,merged.categoryId,merged.customFields,issuing?'Przed wydaniem uzupełnij dane urządzenia. ':'');
    checkAssetRules(merged);
    const entries = Object.entries(input).filter(([key,value]) => key !== 'version' && value !== undefined);
    const values: unknown[] = entries.map(([key,value]) => key === 'customFields' ? JSON.stringify(value) : value);
    const assignments = entries.map(([key],i) => `${assetColumns[key]}=$${i+1}`);
    if (input.status === 'ASSIGNED' && (before.status !== 'ASSIGNED' || input.owner!==undefined && input.owner!==before.owner)) assignments.push('issued_at=now()');
    if (input.owner===null || input.status && input.status !== 'ASSIGNED' && before.status === 'ASSIGNED') assignments.push('issued_at=NULL');
    values.push(assetId,input.version);
    const updated = await client.query(`UPDATE assets SET ${assignments.join(',')},version=version+1,updated_at=now()
      WHERE asset_id=$${values.length-1} AND version=$${values.length}`,values);
    if (!updated.rowCount) throw new AppError(409,'Rekord został zmieniony. Odśwież dane.');
    if(input.invoiceId!==undefined && input.invoiceId!==before.invoiceId) {
      // Remove the old line association when correcting the purchase document.
      // Original invoice lines and all historical snapshots remain unchanged.
      await client.query('DELETE FROM invoice_item_assets WHERE asset_id=$1',[before.id]);
    }
    const asset = await assetById(assetId,client);
    await ensureRfid(client,user,asset);
    await assetEvent(client,user,action,asset,description??`Zaktualizowano urządzenie ${asset.name} (${asset.assetId}).`,before);
    return asset;
}
export async function performAssetAction(assetId:string,body:unknown,user:User,existingClient?:PoolClient):Promise<Asset> {
  parse(assetIdSchema,assetId);
  const input=parse(assetActionSchema,body);
  requirePermission(user,actionPermission[input.action]);
  requireRole(user,['assign','return','note'].includes(input.action)?['IT_USER',...advancedRoles]:advancedRoles);
  const apply=async (client:PoolClient)=>{
    await client.query('SELECT id FROM assets WHERE asset_id=$1 FOR UPDATE',[assetId]);
    const before=await assetById(assetId,client);
    if(before.version!==input.version) throw new AppError(409,'Ktoś zmienił ten rekord. Odśwież urządzenie przed zapisem.');
    const suffix=input.note?` ${input.note}`:'';
    let patch:Record<string,unknown>={version:input.version}, action:string, description:string;
    switch(input.action) {
      case 'assign':
        if(!['AVAILABLE','PREPARATION','ASSIGNED'].includes(before.status)) throw new AppError(409,'Do wydania wybierz sprzęt dostępny lub przygotowywany.');
        const owner=input.employeeId?await resolveEmployee(client,input.employeeId):input.owner!;
        if((input.employeeId&&input.employeeId===before.employeeId)||(!input.employeeId&&before.owner?.toLocaleLowerCase('pl')===owner.toLocaleLowerCase('pl'))) throw new AppError(400,'Urządzenie jest już przypisane do tej osoby. Wybierz nowego odbiorcę.');
        patch={...patch,status:'ASSIGNED',owner,employeeId:input.employeeId??null};action=before.owner?'TRANSFER_ASSET':'ASSIGN_ASSET';description=`${before.owner?'Przekazano':'Wydano'} ${assetId}: ${before.owner?`${before.owner} → `:''}${owner}.${suffix}`;break;
      case 'return':
        if(!before.owner && before.status!=='ASSIGNED') throw new AppError(409,'Urządzenie nie jest przypisane do użytkownika.');
        patch={...patch,status:input.status,owner:null,...(input.locationId?{locationId:input.locationId}:{})};action='RETURN_ASSET';description=`Przyjęto zwrot ${assetId} od ${before.owner??'użytkownika'}. Status: ${statusLabels[input.status]}.${suffix}`;break;
      case 'move':
        if(input.locationId===before.locationId) throw new AppError(400,'Wybierz inną lokalizację.');
        patch={...patch,locationId:input.locationId};action='MOVE_ASSET';description=`Przeniesiono ${assetId} do innej lokalizacji.${suffix}`;break;
      case 'status':
        if(input.status==='ASSIGNED' && !before.owner) throw new AppError(400,'Użyj akcji Wydaj i wskaż użytkownika.');
        if(input.status===before.status) throw new AppError(400,'Urządzenie ma już ten status.');
        patch={...patch,status:input.status,...(input.status!=='ASSIGNED'&&input.status!=='REPAIR'?{owner:null}:{})};action='CHANGE_ASSET_STATUS';description=`Zmieniono status ${assetId}: ${statusLabels[before.status]} → ${statusLabels[input.status]}.${suffix}`;break;
      case 'rfid':
        patch={...patch,rfidTag:input.rfidTag??null};action='ASSIGN_RFID';description=`${input.rfidTag?'Przypisano':'Odpięto'} RFID urządzenia ${assetId}.${suffix}`;break;
      case 'note':
        await client.query('UPDATE assets SET version=version+1,updated_at=now() WHERE id=$1',[before.id]);
        const after=await assetById(assetId,client);
        await assetEvent(client,user,'ASSET_NOTE',after,input.note,before);return after;
    }
    return applyAssetUpdate(client,assetId,parse(assetPatchSchema,patch),user,action,description);
  };
  return existingClient?apply(existingClient):mutate(apply);
}

export async function getAssetHistory(assetId: string): Promise<History[]> {
  const asset = await getAsset(assetId);
  const result = await query<History>(`SELECT e.id,e.action,u.name AS "actorName",e.created_at AS "createdAt",e.description,e.before_data AS before,e.after_data AS after
    FROM asset_history e JOIN users u ON u.id=e.actor_id WHERE e.asset_id=$1 ORDER BY e.created_at DESC,e.id`,[asset.id]);
  return clean(result.rows);
}

export function getInventory(slug: string): Promise<InventoryItem> { return inventoryBySlug(parse(slugSchema,slug)); }
export async function updateInventory(slug:string,body:unknown,user:User):Promise<InventoryItem> {
  requireRole(user,advancedRoles);parse(slugSchema,slug);
  const input=parse(inventoryPatchSchema,body);
  return mutate(async client=>{
    const observed=await inventoryBySlug(slug,client);
    await validateInventoryChoices(client,input.category,input.unit,observed);
    await client.query('SELECT id FROM inventory_items WHERE slug=$1 FOR UPDATE',[slug]);
    const before=await inventoryBySlug(slug,client);
    if(before.version!==input.version) throw new AppError(409,'Produkt lub stan zmienił się. Odśwież kartę przed zapisem.');
    if(input.unit!==undefined&&input.unit!==before.unit&&(before.stock!==0||(await client.query('SELECT id FROM inventory_transactions WHERE inventory_item_id=$1 UNION ALL SELECT id FROM invoice_items WHERE inventory_item_id=$1 LIMIT 1',[before.id])).rowCount))throw new AppError(409,'Produkt ma stan, dokumenty lub historię ruchów. Zachowaj jego jednostkę, aby nie zmienić znaczenia zapisanych ilości.');
    requireQuantityPrecision(input.minimalStock??before.minimalStock,await inventoryUnitPrecision(client,input.unit??before.unit));
    const columns:Record<string,string>={name:'name',sku:'sku',productCode:'product_code',category:'category',unit:'unit',minimalStock:'minimal_stock',locationId:'location_id',notes:'notes'};
    const entries=Object.entries(input).filter(([key,value])=>key!=='version'&&value!==undefined);
    await client.query(`UPDATE inventory_items SET ${entries.map(([key],i)=>`${columns[key]}=$${i+2}`).join(',')},updated_at=now() WHERE id=$1`,[before.id,...entries.map(([,value])=>value)]);
    const after=await inventoryBySlug(slug,client);
    await audit(client,user,'UPDATE_INVENTORY','inventory',slug,`Zmieniono produkt ${after.name}.`,before,after);
    return after;
  });
}
export async function correctStock(slug:string,body:unknown,user:User):Promise<InventoryItem> {
  requireRole(user,advancedRoles);parse(slugSchema,slug);
  const input=parse(stockCorrectionSchema,body);
  return mutate(client=>idempotent(client,user,input.requestId,`correction:${slug}`,input,async()=>{
    await client.query('SELECT id FROM inventory_items WHERE slug=$1 FOR UPDATE',[slug]);
    const before=await inventoryBySlug(slug,client);
    if(before.stock!==input.expectedStock) throw new AppError(409,'Stan zmienił się podczas korekty. Odśwież produkt i potwierdź nowy stan.');
    requireQuantityPrecision(input.stock,before.quantityPrecision);
    const delta=subtractQuantity(input.stock,before.stock);
    if(!delta) throw new AppError(400,'Stan się nie zmienił.');
    return stockMovement(client,user,before.id,delta,'ADJUSTMENT',`Korekta stanu ${before.name}: ${before.stock} → ${input.stock} ${before.unit}. ${input.note}`);
  }));
}
export async function createInventory(body: unknown, user: User, existingClient?: PoolClient): Promise<InventoryItem> {
  requireRole(user,advancedRoles);
  const input = parse(inventorySchema,body);
  if(input.openingStock){requirePermission(user,'inventory.move');if(!input.requestId||!input.openingNote||input.openingNote.length<3)throw new AppError(400,'Podaj powód stanu początkowego i identyfikator zapisu.');}
  const create = async (client: PoolClient) => {
    await validateInventoryChoices(client,input.category,input.unit);
    const precision=await inventoryUnitPrecision(client,input.unit);requireQuantityPrecision(input.minimalStock,precision);if(input.openingStock!==undefined)requireQuantityPrecision(input.openingStock,precision);
    const result = await client.query<{id:string}>(`INSERT INTO inventory_items(name,sku,slug,category,unit,minimal_stock,location_id,notes,product_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.name,input.sku??null,input.slug,input.category,input.unit,input.minimalStock,input.locationId ?? null,input.notes ?? null,input.productCode??null]);
    const item = await inventoryBySlug(input.slug,client);
    await client.query('INSERT INTO qr_codes(inventory_item_id,target_path,created_by) VALUES($1,$2,$3)',[result.rows[0].id,`/inventory/${input.slug}`,user.id]);
    await audit(client,user,'CREATE_INVENTORY','inventory',item.slug,`Dodano produkt ${item.name}. Stan początkowy: 0.`,null,item);
    if(input.openingStock)return stockMovement(client,user,item.id,input.openingStock,'ADJUSTMENT',`Stan początkowy ${item.name}: ${input.openingStock} ${item.unit}. ${input.openingNote}`);
    return item;
  };
  const apply=(client:PoolClient)=>input.requestId?idempotent(client,user,input.requestId,'INVENTORY_CREATE',input,()=>create(client)):create(client);
  return existingClient ? apply(existingClient) : mutate(apply);
}

export async function stockMovement(client: PoolClient, user: User, itemId: string, delta: number, action: string, description: string, invoiceId: string | null = null, deliveryId: string | null = null): Promise<InventoryItem> {
  const observed=(await client.query<{unit:string}>('SELECT unit FROM inventory_items WHERE id=$1',[itemId])).rows[0];
  if(!observed)throw new AppError(404,'Nie znaleziono produktu magazynowego.');
  requireQuantityPrecision(delta,await inventoryUnitPrecision(client,observed.unit));
  // PostgreSQL locks the row. The condition is rechecked after concurrent updates.
  const result = await client.query<{slug:string; stock:number}>(`UPDATE inventory_items SET stock=stock+$2,updated_at=now()
    WHERE id=$1 AND stock+$2 BETWEEN 0 AND 10000000 RETURNING slug,stock`,[itemId,delta]);
  if (!result.rowCount) {
    const exists = await client.query('SELECT id FROM inventory_items WHERE id=$1',[itemId]);
    throw new AppError(exists.rowCount ? 409 : 404,exists.rowCount ? 'Niewystarczający stan lub przekroczony limit stanu magazynowego.' : 'Nie znaleziono produktu magazynowego.');
  }
  const item = await inventoryBySlug(result.rows[0].slug,client);
  await client.query(`INSERT INTO inventory_transactions(inventory_item_id,actor_id,delta,balance_after,action,description,invoice_id,delivery_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[itemId,user.id,delta,item.stock,action,description,invoiceId,deliveryId]);
  await audit(client,user,action,'inventory',item.slug,description,{stock:subtractQuantity(item.stock,delta)},{stock:item.stock,delta,invoiceId,deliveryId});
  return item;
}
export async function moveInventory(slug: string, body: unknown, user: User): Promise<InventoryItem> {
  requireRole(user,['IT_USER',...advancedRoles]);
  parse(slugSchema,slug);
  const input = parse(movementSchema,body);
  return mutate(client => idempotent(client,user,input.requestId,`inventory:${slug}`,input,async () => {
    const item = await inventoryBySlug(slug,client);
    const action = input.delta < 0 ? 'WITHDRAWAL' : 'RETURN';
    const description = `${input.delta < 0 ? 'Pobrano' : 'Zwrócono'} ${Math.abs(input.delta)} ${item.unit} ${item.name}${input.note ? `. ${input.note}` : '.'}`;
    return stockMovement(client,user,item.id,input.delta,action,description);
  }));
}
export async function getInventoryHistory(slug: string): Promise<History[]> {
  const item = await getInventory(slug);
  const result = await query<History>(`SELECT e.id,e.action,u.name AS "actorName",e.created_at AS "createdAt",e.description,e.delta::float8 AS delta,e.balance_after::float8 AS "balanceAfter",i.number AS "invoiceNumber"
    FROM inventory_transactions e JOIN users u ON u.id=e.actor_id LEFT JOIN invoices i ON i.id=e.invoice_id WHERE e.inventory_item_id=$1 ORDER BY e.created_at DESC,e.id`,[item.id]);
  return clean(result.rows);
}

const serialPreviewSchema=z.object({serialNumbers:z.array(z.string().trim().min(1).max(160)).min(1).max(1000),invoiceId:uuidSchema.optional(),lineId:uuidSchema.optional()}).strict();
async function resolveSerials(executor:Executor,serials:string[],invoiceId?:string,lineId?:string,lock=false):Promise<SerialPreview[]>{
 const keys=serials.map(s=>s.toLowerCase());if(new Set(keys).size!==keys.length)throw new AppError(400,'Numer seryjny powtarza się w dokumencie.');
 if(lock)for(const key of [...keys].sort())await executor.query('SELECT pg_advisory_xact_lock(hashtextextended($1,731420))',[key]);
 // Lock asset rows separately: joins may contain nullable invoice/line records.
 if(lock)await executor.query('SELECT id FROM assets WHERE lower(serial_number)=ANY($1::text[]) ORDER BY id FOR UPDATE',[keys]);
 const rows=(await executor.query<{serialNumber:string;assetId:string;name:string;version:number;invoiceId:string|null;invoiceNumber:string|null;lineId:string|null}>('SELECT a.serial_number AS "serialNumber",a.asset_id AS "assetId",a.name,a.version,a.invoice_id AS "invoiceId",i.number AS "invoiceNumber",ia.invoice_item_id AS "lineId" FROM assets a LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN invoice_item_assets ia ON ia.asset_id=a.id WHERE lower(a.serial_number)=ANY($1::text[])',[keys])).rows;
 return serials.map(serialNumber=>{const a=rows.find(a=>a.serialNumber.toLowerCase()===serialNumber.toLowerCase());return a?{serialNumber,assetId:a.assetId,name:a.name,version:a.version,invoiceNumber:a.invoiceNumber,state:a.invoiceId&&a.invoiceId!==invoiceId||a.lineId&&a.lineId!==lineId?'conflict':a.lineId===lineId&&lineId?'linked':'existing'}:{serialNumber,state:'new',assetId:null,name:null,version:null,invoiceNumber:null};});
}
export async function previewInvoiceSerials(body:unknown,user:User){requireRole(user,advancedRoles);requirePermission(user,'asset.view');requirePermission(user,'invoice.view');const input=parse(serialPreviewSchema,body);return resolveSerials(pool,input.serialNumbers,input.invoiceId,input.lineId);}
type PurchaseLine=ReturnType<typeof invoiceSchema.parse>['items'] extends (infer T)[]|undefined?T:never;
async function insertPurchaseLine(client:PoolClient,invoiceId:string,line:PurchaseLine,position:number,unit:string,precision=0){
 return (await client.query<{id:string}>('INSERT INTO invoice_items(invoice_id,name,quantity,unit_price,inventory_item_id,category_id,position,unit,serial_numbers,manufacturer,model,location_id,quantity_precision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',[invoiceId,line.name,line.quantity,line.unitPrice,line.kind==='inventory'?line.inventoryItemId:null,line.kind==='asset'?line.categoryId:null,position,unit,JSON.stringify(line.serialNumbers??[]),line.manufacturer??null,line.model??null,line.locationId??null,precision])).rows[0].id;
}
// Every purchase path (invoice entry, line completion, legacy delivery) creates
// equipment through this one function, so permission rules cannot diverge.
// Purchased equipment starts in PREPARATION; required category fields are
// enforced when it is issued (see requireIssueReady), not at receipt.
async function createPurchasedAsset(client:PoolClient,user:User,data:{name:string;categoryId:string;manufacturer?:string|null;model?:string|null;locationId?:string|null;serialNumber?:string|null;purchasedAt:string;unitPrice:string|null;invoiceId:string;invoiceNumber:string},invoiceItemId:string):Promise<Asset>{
 requirePermission(user,'asset.create');
 const created=(await client.query<{asset_id:string}>('INSERT INTO assets(name,category_id,manufacturer,model,location_id,serial_number,purchased_at,purchase_price,invoice_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING asset_id',[data.name,data.categoryId,data.manufacturer??null,data.model??null,data.locationId??null,data.serialNumber??null,data.purchasedAt,data.unitPrice,data.invoiceId])).rows[0];
 const asset=await assetById(created.asset_id,client);
 await client.query('INSERT INTO invoice_item_assets(invoice_item_id,asset_id) VALUES($1,$2)',[invoiceItemId,asset.id]);
 await client.query('INSERT INTO qr_codes(asset_id,target_path,created_by) VALUES($1,$2,$3)',[asset.id,`/asset/${asset.assetId}`,user.id]);
 await assetEvent(client,user,'RECEIVE_ASSET',asset,`Przyjęto ${asset.name} (${asset.assetId}). Faktura ${data.invoiceNumber}.`);
 return asset;
}
async function attachPurchaseAssets(client:PoolClient,user:User,invoice:{id:string;number:string;date:string;currency:string},lineId:string,line:PurchaseLine,createMissing:boolean,fillQuantity=false){
 const preview=await resolveSerials(client,line.serialNumbers??[],invoice.id,lineId,true);
 let createdCount=0;
 // A partial serial list receives only identified units. A receipt without any
 // serials retains the existing workflow of unnumbered cards for later editing.
 for(let index=0;index<(fillQuantity&&!preview.length?line.quantity:preview.length);index++){
  const match=preview[index];if(match?.state==='conflict')throw new AppError(409,`SN ${match.serialNumber} jest już powiązany z inną pozycją lub fakturą ${match.invoiceNumber??''}.`);
  if(match?.state==='linked')continue;
  if(match?.state==='existing'){
   requirePermission(user,'asset.edit');const confirmed=line.matches?.find(m=>m.serialNumber.toLowerCase()===match.serialNumber.toLowerCase());
   if(!confirmed||confirmed.assetId!==match.assetId||confirmed.version!==match.version)throw new AppError(409,`Sprawdź i potwierdź aktualne dopasowanie SN ${match.serialNumber}.`);
   const before=await assetById(match.assetId!,client);
   if(before.purchasePrice!==null&&before.purchaseCurrency!==invoice.currency)throw new AppError(409,`SN ${match.serialNumber}: zapisana cena jest w ${before.purchaseCurrency}, a faktura w ${invoice.currency}. Zweryfikuj walutę przed powiązaniem.`);
   await client.query('UPDATE assets SET invoice_id=$2,version=version+1,updated_at=now() WHERE id=$1',[before.id,invoice.id]);
   await client.query('INSERT INTO invoice_item_assets(invoice_item_id,asset_id) VALUES($1,$2)',[lineId,before.id]);
   const after=await assetById(before.assetId,client);await assetEvent(client,user,'LINK_INVOICE_ITEM',after,`Powiązano SN ${match.serialNumber} z pozycją faktury ${invoice.number}.`,before);
  }else if(createMissing){
   requirePermission(user,'asset.create');
   if(line.matches?.some(m=>m.serialNumber.toLowerCase()===match?.serialNumber.toLowerCase()))throw new AppError(409,'Dopasowanie zmieniło się. Sprawdź numery ponownie.');
   await createPurchasedAsset(client,user,{name:line.name!,categoryId:line.categoryId!,manufacturer:line.manufacturer,model:line.model,locationId:line.locationId,serialNumber:match?.serialNumber??null,purchasedAt:invoice.date,unitPrice:line.unitPrice??null,invoiceId:invoice.id,invoiceNumber:invoice.number},lineId);createdCount++;
  }
 }
 return createdCount;
}
async function recordAssetReceipt(client:PoolClient,user:User,invoiceId:string,lineId:string,count:number){
 if(!count)return;const deliveryId=(await client.query<{id:string}>('INSERT INTO deliveries(invoice_id,received_by,notes) VALUES($1,$2,$3) ON CONFLICT(invoice_id) DO UPDATE SET invoice_id=EXCLUDED.invoice_id RETURNING id',[invoiceId,user.id,'Przyjęcie nowych urządzeń z pozycji faktury.'])).rows[0].id;
 await client.query('INSERT INTO delivery_items(delivery_id,invoice_item_id,quantity) VALUES($1,$2,$3) ON CONFLICT(invoice_item_id) DO UPDATE SET quantity=delivery_items.quantity+EXCLUDED.quantity',[deliveryId,lineId,count]);
 await audit(client,user,'RECEIVE_DELIVERY','delivery',deliveryId,`Przyjęto ${count} nowych urządzeń z faktury.`,null,{invoiceId,lineId,count});
}
export async function createInvoice(body:unknown,user:User):Promise<Invoice>{
 requireRole(user,advancedRoles);requirePermission(user,'invoice.edit');const input=parse(invoiceSchema,body),total=input.items?purchaseTotal(input.items):null;
 if(input.items&&input.amount!==null&&total!==null&&moneyCents(input.amount)!==moneyCents(total))throw new AppError(400,'Kwota faktury musi odpowiadać sumie pozycji.');
 if(input.receive&&!input.items?.some(l=>l.kind!=='other'))throw new AppError(400,'Dodaj urządzenie lub produkt, aby przyjąć zakup.');
 if((input.items?.filter(l=>l.kind==='asset').reduce((s,l)=>s+l.quantity,0)??0)>1000)throw new AppError(400,'Najwyżej 1000 urządzeń na fakturze.');
 const serials=input.items?.flatMap(l=>l.serialNumbers??[])??[];
 return mutate(client=>{const apply=async()=>{
  if(serials.length)requirePermission(user,'asset.view');await resolveSerials(client,serials,undefined,undefined,true);
  const invoiceId=(await client.query<{id:string}>('INSERT INTO invoices(number,supplier_id,date,amount,currency,order_number,notes,received_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[input.number,input.supplierId,input.date,input.amount??total,input.currency,input.orderNumber??null,input.notes??null,user.id])).rows[0].id;
  // Acquire inventory locks in a stable order, while retaining document position.
  const products=new Map<string,{name:string;unit:string;precision:number}>();
  for(const id of [...new Set(input.items?.filter(l=>l.kind==='inventory').map(l=>l.inventoryItemId!)??[])].sort()){
   const p=(await client.query<{name:string;unit:string;precision:number}>('SELECT n.name,n.unit,d.quantity_precision AS precision FROM inventory_items n JOIN inventory_dictionary_entries d ON d.kind=\'unit\' AND d.name=n.unit WHERE n.id=$1 FOR UPDATE OF n',[id])).rows[0];if(!p)throw new AppError(400,'Produkt nie istnieje.');products.set(id,p);
  }
  for(const [index,line] of (input.items??[]).entries()){
   const product=products.get(line.inventoryItemId??''),savedLine={...line,name:line.name||product?.name};if(product)requireQuantityPrecision(line.quantity,product.precision);const lineId=await insertPurchaseLine(client,invoiceId,savedLine,index+1,product?.unit??'szt.',product?.precision??0);
   if(line.kind==='asset'){const count=await attachPurchaseAssets(client,user,{id:invoiceId,number:input.number,date:input.date,currency:input.currency},lineId,savedLine,input.receive,input.receive);await recordAssetReceipt(client,user,invoiceId,lineId,count);}
   if(line.kind==='inventory'&&input.receive){requirePermission(user,'inventory.move');const deliveryId=(await client.query<{id:string}>('INSERT INTO deliveries(invoice_id,received_by,notes) VALUES($1,$2,$3) ON CONFLICT(invoice_id) DO UPDATE SET invoice_id=EXCLUDED.invoice_id RETURNING id',[invoiceId,user.id,input.notes??null])).rows[0].id;await client.query('INSERT INTO delivery_items(delivery_id,invoice_item_id,quantity) VALUES($1,$2,$3)',[deliveryId,lineId,line.quantity]);await stockMovement(client,user,line.inventoryItemId!,line.quantity,'DELIVERY',`Przyjęto ${line.quantity} × ${product!.name}. Faktura ${input.number}.`,invoiceId,deliveryId);}
  }
  const invoice=(await client.query<Invoice>(`SELECT ${invoiceProjection} ${invoiceFrom} WHERE i.id=$1`,[invoiceId])).rows[0];await audit(client,user,'CREATE_INVOICE','invoice',invoiceId,`Dodano fakturę ${invoice.number}.`,null,invoice);return clean(invoice);
 };return input.requestId?idempotent(client,user,input.requestId,'CREATE_INVOICE',input,apply):apply();});
}
export async function completeInvoiceLine(invoiceId:string,lineId:string,body:unknown,user:User){
 requireRole(user,advancedRoles);requirePermission(user,'invoice.edit');requirePermission(user,'asset.view');parse(uuidSchema,invoiceId);parse(uuidSchema,lineId);
 const input=parse(serialPreviewSchema.omit({invoiceId:true,lineId:true}).extend({matches:z.array(z.object({serialNumber:z.string().trim().min(1).max(160),assetId:assetIdSchema,version:z.number().int().positive()}).strict()).max(1000).default([]),createMissing:z.boolean().default(false),version:z.number().int().positive(),requestId:uuidSchema}).strict(),body);
 return mutate(client=>idempotent(client,user,input.requestId,'INVOICE_SERIALS:'+lineId,input,async()=>{
  const invoice=(await client.query<Invoice>(`SELECT ${invoiceProjection} ${invoiceFrom} WHERE i.id=$1 FOR UPDATE OF i`,[invoiceId])).rows[0];if(!invoice)throw new AppError(404,'Nie znaleziono faktury.');if(invoice.version!==input.version)throw new AppError(409,'Faktura zmieniła się. Odśwież dane.');
  const row=(await client.query<InvoiceLine>('SELECT id,name,quantity::float8 AS quantity,unit_price::text AS "unitPrice",category_id AS "categoryId",manufacturer,model,location_id AS "locationId",serial_numbers AS "serialNumbers" FROM invoice_items WHERE id=$1 AND invoice_id=$2 FOR UPDATE',[lineId,invoiceId])).rows[0];if(!row?.categoryId)throw new AppError(400,'Wybierz pozycję urządzeń.');
  const serials=Array.from(new Map([...(row.serialNumbers??[]),...input.serialNumbers].map(s=>[s.toLowerCase(),s])).values());if(serials.length>row.quantity)throw new AppError(400,'Liczba numerów przekracza ilość pozycji.');
  const count=await attachPurchaseAssets(client,user,invoice,lineId,{...row,kind:'asset',serialNumbers:input.serialNumbers,matches:input.matches},input.createMissing);
  const linked=(await client.query<{count:number}>('SELECT count(*)::int AS count FROM invoice_item_assets WHERE invoice_item_id=$1',[lineId])).rows[0].count;if(linked>row.quantity)throw new AppError(409,'Pozycja ma już komplet urządzeń.');
  await client.query('UPDATE invoice_items SET serial_numbers=$2 WHERE id=$1',[lineId,JSON.stringify(serials)]);await recordAssetReceipt(client,user,invoiceId,lineId,count);await client.query('UPDATE invoices SET version=version+1 WHERE id=$1',[invoiceId]);await audit(client,user,'LINK_INVOICE_SERIALS','invoice',invoiceId,`Uzupełniono numery seryjne pozycji ${row.name}.`,null,{lineId,serials,created:count});return {linked,created:count};
 }));
}

export async function receiveInvoiceStock(invoiceId:string,lineId:string,body:unknown,user:User){
 requireRole(user,advancedRoles);requirePermission(user,'invoice.edit');requirePermission(user,'inventory.move');parse(uuidSchema,invoiceId);parse(uuidSchema,lineId);
 const input=parse(z.object({quantity:quantitySchema(),version:z.number().int().positive(),requestId:uuidSchema}).strict(),body);
 return mutate(client=>idempotent(client,user,input.requestId,'INVOICE_STOCK:'+lineId,input,async()=>{
  const invoice=(await client.query<{version:number;number:string}>('SELECT version,number FROM invoices WHERE id=$1 FOR UPDATE',[invoiceId])).rows[0];if(!invoice)throw new AppError(404,'Nie znaleziono faktury.');if(invoice.version!==input.version)throw new AppError(409,'Faktura zmieniła się. Odśwież dane.');
  const line=(await client.query<InvoiceLine>('SELECT id,name,quantity::float8 AS quantity,quantity_precision AS "quantityPrecision",inventory_item_id AS "inventoryItemId" FROM invoice_items WHERE id=$1 AND invoice_id=$2 FOR UPDATE',[lineId,invoiceId])).rows[0];if(!line?.inventoryItemId)throw new AppError(400,'Wybierz pozycję produktu magazynowego.');
  const received=(await client.query<{quantity:number}>('SELECT COALESCE(sum(quantity),0)::float8 AS quantity FROM delivery_items WHERE invoice_item_id=$1',[lineId])).rows[0].quantity;
  requireQuantityPrecision(input.quantity,line.quantityPrecision??0);
  if(input.quantity>subtractQuantity(line.quantity,received))throw new AppError(409,'Ilość przekracza pozostałą część pozycji. Odśwież fakturę.');
  const product=(await client.query<{name:string}>('SELECT name FROM inventory_items WHERE id=$1 FOR UPDATE',[line.inventoryItemId])).rows[0];
  const deliveryId=(await client.query<{id:string}>('INSERT INTO deliveries(invoice_id,received_by,notes) VALUES($1,$2,$3) ON CONFLICT(invoice_id) DO UPDATE SET invoice_id=EXCLUDED.invoice_id RETURNING id',[invoiceId,user.id,'Przyjęcie zapisanej pozycji faktury.'])).rows[0].id;
  await client.query('INSERT INTO delivery_items(delivery_id,invoice_item_id,quantity) VALUES($1,$2,$3) ON CONFLICT(invoice_item_id) DO UPDATE SET quantity=delivery_items.quantity+EXCLUDED.quantity',[deliveryId,lineId,input.quantity]);
  await stockMovement(client,user,line.inventoryItemId,input.quantity,'DELIVERY',`Przyjęto ${input.quantity} × ${product.name}. Faktura ${invoice.number}.`,invoiceId,deliveryId);
  await client.query('UPDATE invoices SET version=version+1 WHERE id=$1',[invoiceId]);await audit(client,user,'RECEIVE_DELIVERY','delivery',deliveryId,`Przyjęto ${input.quantity} z pozycji ${line.name}.`,null,{invoiceId,lineId,quantity:input.quantity});
  return {received:addQuantity(received,input.quantity),remaining:subtractQuantity(subtractQuantity(line.quantity,received),input.quantity)};
 }));
}

export async function updateInvoice(id:string,body:unknown,user:User):Promise<Invoice>{
 requireRole(user,advancedRoles);requirePermission(user,'invoice.edit');parse(uuidSchema,id);const input=parse(invoicePatchSchema,body);
 if(input.items&&input.amount!==null&&purchaseTotal(input.items)!==null&&moneyCents(input.amount)!==moneyCents(purchaseTotal(input.items)!))throw new AppError(400,'Kwota faktury musi odpowiadać sumie pozycji.');
 return mutate(async client=>{
  const before=(await client.query<Invoice>(`SELECT ${invoiceProjection} ${invoiceFrom} WHERE i.id=$1 FOR UPDATE OF i`,[id])).rows[0];
  if(!before)throw new AppError(404,'Nie znaleziono faktury.');if(before.version!==input.version)throw new AppError(409,'Faktura zmieniła się. Otwórz ponownie formularz.');
  let priceChanges:{before:InvoiceLine[];after:NonNullable<typeof input.itemPrices>}|undefined,totalAfter:string|null=null;
  if(input.itemPrices){
   const rows=(await client.query<InvoiceLine>('SELECT id,quantity::float8 AS quantity,unit_price::text AS "unitPrice" FROM invoice_items WHERE invoice_id=$1 ORDER BY id FOR UPDATE',[id])).rows;
   if(new Set(input.itemPrices.map(p=>p.id)).size!==input.itemPrices.length||input.itemPrices.some(p=>!rows.some(r=>r.id===p.id)))throw new AppError(400,'Wybierz różne pozycje należące do tej faktury.');
   priceChanges={before:rows,after:input.itemPrices};
   for(const price of input.itemPrices)await client.query('UPDATE invoice_items SET unit_price=$2 WHERE id=$1',[price.id,price.unitPrice]);
   const prices=new Map(input.itemPrices.map(p=>[p.id,p.unitPrice]));
   const pricedTotal=purchaseTotal(rows.map(r=>({quantity:r.quantity,unitPrice:prices.has(r.id)?prices.get(r.id)!:r.unitPrice})));
   if(input.amount!==null&&pricedTotal!==null&&moneyCents(input.amount)!==moneyCents(pricedTotal))throw new AppError(400,'Kwota faktury musi odpowiadać sumie pozycji.');
  }
  if(input.items){
   const serials=input.items.flatMap(l=>l.serialNumbers??[]);if(serials.length)requirePermission(user,'asset.view');await resolveSerials(client,serials,id,undefined,true);
   if((await client.query('SELECT id FROM deliveries WHERE invoice_id=$1',[id])).rowCount)throw new AppError(409,'Pozycje przyjętej dostawy pozostają historyczne. Zmień dane dokumentu bez edycji pozycji.');
   if((await client.query('SELECT 1 FROM invoice_item_assets ia JOIN invoice_items it ON it.id=ia.invoice_item_id WHERE it.invoice_id=$1 LIMIT 1',[id])).rowCount)throw new AppError(409,'Pozycje z powiązanym sprzętem pozostają historyczne. Zmień nagłówek dokumentu.');
   for(const productId of Array.from(new Set(input.items.filter(line=>line.kind==='inventory').map(line=>line.inventoryItemId!))).sort())await client.query('SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE',[productId]);
   await client.query('DELETE FROM invoice_items WHERE invoice_id=$1',[id]);
   for(const [index,line] of input.items.entries()){
    let name=line.name,unit='szt.',precision=0;
    if(line.kind==='inventory'){const row=(await client.query<{name:string;unit:string}>('SELECT name,unit FROM inventory_items WHERE id=$1',[line.inventoryItemId])).rows[0];if(!row)throw new AppError(400,'Nie znaleziono produktu.');name=line.name||row.name;unit=row.unit;precision=await inventoryUnitPrecision(client,unit);requireQuantityPrecision(line.quantity,precision);}
    const lineId=await insertPurchaseLine(client,id,{...line,name},index+1,unit,precision);
    if(line.kind==='asset')await attachPurchaseAssets(client,user,before,lineId,{...line,name},false);
   }
  }
  if(input.currency!==before.currency&&(await client.query('SELECT id FROM assets WHERE invoice_id=$1 LIMIT 1',[id])).rowCount)throw new AppError(409,'Nie można zmienić waluty faktury z powiązanym sprzętem. Wymaga to sprawdzenia wartości zakupu.');
  // As in createInvoice: a missing amount means the sum of the (current) lines.
  // A line without a price keeps the total unknown (null), never zero.
  if(input.amount===null){const lines=(await client.query<{quantity:number;unitPrice:string|null}>('SELECT quantity::float8 AS quantity,unit_price::text AS "unitPrice" FROM invoice_items WHERE invoice_id=$1',[id])).rows;totalAfter=lines.length?purchaseTotal(lines):null;}
  await client.query('UPDATE invoices SET number=$2,supplier_id=$3,date=$4,amount=$5,currency=$6,order_number=$7,notes=$8,version=version+1 WHERE id=$1',[id,input.number,input.supplierId,input.date,input.amount??totalAfter,input.currency,input.orderNumber??null,input.notes??null]);
  const after=(await client.query<Invoice>(`SELECT ${invoiceProjection} ${invoiceFrom} WHERE i.id=$1`,[id])).rows[0];
  await audit(client,user,'UPDATE_INVOICE','invoice',id,`Zmieniono fakturę ${after.number}.`,priceChanges?{...before,itemPrices:priceChanges.before}:before,priceChanges?{...after,itemPrices:priceChanges.after}:after);return clean(after);
 });
}
export async function listInvoices(params: URLSearchParams): Promise<PageResult<Invoice>> {
  const term = searchTerm(params);
  return paginated<Invoice>(invoiceProjection,invoiceFrom,term ? ['(i.number ILIKE $1 OR s.name ILIKE $1)'] : [],term ? [term] : [],'i.date DESC,i.created_at DESC,i.id',params,{key:'i.id'});
}
export async function getInvoice(id: string): Promise<InvoiceDetail> {
  parse(uuidSchema,id);
  const invoice = await query<Invoice>(`SELECT ${invoiceProjection} ${invoiceFrom} WHERE i.id=$1`,[id]);
  if (!invoice.rows[0]) throw new AppError(404,'Nie znaleziono faktury.');
  const [items,assets,deliveries] = await Promise.all([
    query<InvoiceLine>(`SELECT it.id,it.name,it.position,it.unit,it.quantity_precision AS "quantityPrecision",it.serial_numbers AS "serialNumbers",it.manufacturer,it.model,it.location_id AS "locationId",(SELECT name FROM inventory_items n WHERE n.id=it.inventory_item_id) AS "inventoryItemName",(SELECT slug FROM inventory_items n WHERE n.id=it.inventory_item_id) AS "inventoryItemSlug",COALESCE((SELECT sum(di.quantity)::float8 FROM delivery_items di WHERE di.invoice_item_id=it.id),0) AS "receivedQuantity",it.quantity::float8 AS quantity,it.unit_price::text AS "unitPrice",it.inventory_item_id AS "inventoryItemId",it.category_id AS "categoryId",
      COALESCE((SELECT array_agg(a.asset_id ORDER BY a.asset_id) FROM invoice_item_assets ia JOIN assets a ON a.id=ia.asset_id WHERE ia.invoice_item_id=it.id),'{}'::text[]) AS "assetIds"
      FROM invoice_items it WHERE it.invoice_id=$1 ORDER BY it.position,it.id`,[id]),
    query<Asset>(`SELECT ${assetProjection} ${assetFrom} WHERE a.invoice_id=$1 ORDER BY a.asset_id`,[id]),
    query<Delivery>(`SELECT ${deliveryProjection} ${deliveryFrom} WHERE d.invoice_id=$1 ORDER BY d.received_at DESC`,[id]),
  ]);
  const supplier=(await query<Supplier>(`SELECT ${supplierProjection} FROM suppliers WHERE id=$1`,[invoice.rows[0].supplierId])).rows[0];
  return clean({...invoice.rows[0],items:items.rows,assets:assets.rows,deliveries:deliveries.rows,supplier});
}
export async function listDeliveries(params: URLSearchParams): Promise<PageResult<Delivery>> {
  const term = searchTerm(params);
  return paginated<Delivery>(deliveryProjection,deliveryFrom,term ? ['(i.number ILIKE $1 OR s.name ILIKE $1)'] : [],term ? [term] : [],'d.received_at DESC,d.id',params,{key:'d.id'});
}
export async function receiveDelivery(body: unknown, user: User): Promise<Delivery> {
  requireRole(user,advancedRoles);
  requirePermission(user,'invoice.edit');
  const input = parse(deliverySchema,body);
  // Legacy receipt: every product line moves stock and every device line creates
  // equipment, so check both before any write (the transaction also rolls back).
  if(input.items.some(line=>line.kind==='inventory'))requirePermission(user,'inventory.move');
  if(input.items.some(line=>line.kind==='asset'))requirePermission(user,'asset.create');
  return mutate(client => idempotent(client,user,input.requestId,'delivery:receive',input,async () => {
    const invoice = await client.query<{id:string}>(`INSERT INTO invoices(number,supplier_id,date,currency,order_number,received_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[input.invoiceNumber,input.supplierId,input.date,input.currency,input.orderNumber ?? null,user.id]);
    const invoiceId = invoice.rows[0].id;
    const delivery = await client.query<{id:string}>('INSERT INTO deliveries(invoice_id,received_by,notes) VALUES($1,$2,$3) RETURNING id',[invoiceId,user.id,input.notes ?? null]);
    const deliveryId = delivery.rows[0].id;
    // Keep stock-row locking order consistent across multi-product deliveries.
    for(const productId of [...new Set(input.items.filter(l=>l.kind==='inventory').map(l=>l.inventoryItemId))].sort())await client.query('SELECT id FROM inventory_items WHERE id=$1 FOR UPDATE',[productId]);
    for (const [position,line] of input.items.entries()) {
      if (line.kind === 'inventory') {
        const product = await client.query<{name:string;unit:string}>('SELECT name,unit FROM inventory_items WHERE id=$1',[line.inventoryItemId]);
        if (!product.rows[0]) throw new AppError(400,'Produkt z dostawy nie istnieje.');
        const precision=await inventoryUnitPrecision(client,product.rows[0].unit);requireQuantityPrecision(line.quantity,precision);
        const invoiceLine = await client.query<{id:string}>(`INSERT INTO invoice_items(invoice_id,name,quantity,unit_price,inventory_item_id,position,unit,quantity_precision)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[invoiceId,product.rows[0].name,line.quantity,line.unitPrice,line.inventoryItemId,position+1,product.rows[0].unit,precision]);
        await client.query('INSERT INTO delivery_items(delivery_id,invoice_item_id,quantity) VALUES($1,$2,$3)',[deliveryId,invoiceLine.rows[0].id,line.quantity]);
        await stockMovement(client,user,line.inventoryItemId,line.quantity,'DELIVERY',`Przyjęto ${line.quantity} × ${product.rows[0].name}. Faktura ${input.invoiceNumber}.`,invoiceId,deliveryId);
      } else {
        const invoiceLine = await client.query<{id:string}>(`INSERT INTO invoice_items(invoice_id,name,quantity,unit_price,category_id,position,serial_numbers,manufacturer,model,location_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[invoiceId,line.name,line.quantity,line.unitPrice,line.categoryId,position+1,JSON.stringify(line.serialNumbers??[]),line.manufacturer??null,line.model??null,line.locationId??null]);
        await client.query('INSERT INTO delivery_items(delivery_id,invoice_item_id,quantity) VALUES($1,$2,$3)',[deliveryId,invoiceLine.rows[0].id,line.quantity]);
        for (let index=0; index<line.quantity; index++) {
          await createPurchasedAsset(client,user,{name:line.name,categoryId:line.categoryId,manufacturer:line.manufacturer,model:line.model,locationId:line.locationId,serialNumber:line.serialNumbers?.[index] ?? null,purchasedAt:input.date,unitPrice:line.unitPrice,invoiceId,invoiceNumber:input.invoiceNumber},invoiceLine.rows[0].id);
        }
      }
    }
    // Decimal multiplication and aggregation happen in PostgreSQL, never in floating point JS.
    await client.query('UPDATE invoices SET amount=(SELECT sum(round(quantity*unit_price,2)) FROM invoice_items WHERE invoice_id=$1) WHERE id=$1',[invoiceId]);
    const result = await deliveryById(deliveryId,client);
    await audit(client,user,'CREATE_INVOICE','invoice',invoiceId,`Dodano fakturę ${input.invoiceNumber}.`,null,{number:input.invoiceNumber,supplierId:input.supplierId});
    await audit(client,user,'RECEIVE_DELIVERY','delivery',deliveryId,`Przyjęto dostawę ${input.invoiceNumber}: ${result.itemCount} szt.`,null,result);
    return result;
  }));
}

export async function listAudit(): Promise<History[]> {
  const result = await query<History>(`SELECT ${auditProjection} FROM audit_logs e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.created_at DESC,e.id LIMIT 500`);
  return clean(result.rows);
}
export async function exportInventoryHistory(slug?:string): Promise<string> {
  const item=slug?await getInventory(slug):null;
  const result = await query<{createdAt:Date; actorName:string; sku:string; product:string; action:string; delta:number; balanceAfter:number; invoiceNumber:string | null; description:string}>(
    `SELECT t.created_at AS "createdAt",u.name AS "actorName",n.sku,n.name AS product,t.action,t.delta,t.balance_after AS "balanceAfter",i.number AS "invoiceNumber",t.description
     FROM inventory_transactions t JOIN users u ON u.id=t.actor_id JOIN inventory_items n ON n.id=t.inventory_item_id LEFT JOIN invoices i ON i.id=t.invoice_id
     ${item?'WHERE t.inventory_item_id=$1':''} ORDER BY t.created_at DESC,t.id LIMIT 10001`,item?[item.id]:[]);
  if(result.rows.length>10000)throw new AppError(413,'Historia przekracza limit 10 000 zdarzeń.');
  const cell = (value: unknown) => {
    let text = value instanceof Date ? value.toISOString() : String(value ?? '');
    // Defend spreadsheet consumers from formula injection in user-controlled text.
    if (/^[\s]*[=+@-]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  const header = ['Data UTC','Użytkownik','SKU','Produkt','Operacja','Zmiana','Stan po','Faktura','Opis'];
  const rows = result.rows.map(row => [row.createdAt,row.actorName,row.sku,row.product,row.action,row.delta,row.balanceAfter,row.invoiceNumber,row.description].map(cell).join(';'));
  return '\uFEFF' + [header.map(cell).join(';'),...rows].join('\r\n');
}

export async function createLocation(body: unknown, user: User): Promise<Location> {
  requireRole(user,['ADMIN']);
  const input = parse(locationSchema,body);
  return mutate(async client => {
    await client.query('LOCK TABLE locations IN SHARE ROW EXCLUSIVE MODE');
    if (input.parentId) {
      const parent = await client.query<{kind:string}>('SELECT kind FROM locations WHERE id=$1',[input.parentId]);
      if (!parent.rows[0]) throw new AppError(400,'Lokalizacja nadrzędna nie istnieje.');
    }
    const created = await client.query<{id:string}>('INSERT INTO locations(name,kind,parent_id) VALUES($1,$2,$3) RETURNING id',[input.name,input.kind??'FOLDER',input.parentId ?? null]);
    const location = await client.query<Location>('SELECT id,name,path,kind,parent_id AS "parentId",version FROM location_paths WHERE id=$1',[created.rows[0].id]);
    await client.query('INSERT INTO qr_codes(location_id,target_path,created_by) VALUES($1,$2,$3)',[created.rows[0].id,`/assets?locationId=${created.rows[0].id}`,user.id]);
    await audit(client,user,'CREATE_LOCATION','location',created.rows[0].id,`Dodano lokalizację ${location.rows[0].path}.`,null,location.rows[0]);
    return clean(location.rows[0]);
  });
}
export async function updateLocation(id: string, body: unknown, user: User): Promise<Location> {
  requireRole(user,['ADMIN']);
  parse(uuidSchema,id);
  const input = parse(locationSchema,body);
  return mutate(async client => {
    // Serialize hierarchy edits, including concurrent moves and child creation.
    await client.query('LOCK TABLE locations IN SHARE ROW EXCLUSIVE MODE');
    const before = (await client.query<Location>('SELECT id,name,path,kind,parent_id AS "parentId",version FROM location_paths WHERE id=$1',[id])).rows[0];
    if (!before) throw new AppError(404,'Nie znaleziono lokalizacji.');
    if(input.version!==undefined&&before.version!==input.version)throw new AppError(409,'Lokalizacja zmieniła się. Odśwież drzewo.');
    const parentId=input.parentId===undefined?before.parentId:input.parentId;
    if (parentId) {
      const descendants = await client.query(`WITH RECURSIVE subtree AS (
        SELECT id FROM locations WHERE id=$1 UNION ALL SELECT l.id FROM locations l JOIN subtree s ON l.parent_id=s.id
      ) SELECT id FROM subtree WHERE id=$2`,[id,parentId]);
      if (descendants.rowCount) throw new AppError(400,'Lokalizacja nie może być nadrzędna dla siebie ani znajdować się pod własnym poziomem podrzędnym.');
      const parent = (await client.query<{kind:string}>('SELECT kind FROM locations WHERE id=$1',[parentId])).rows[0];
      if (!parent) throw new AppError(400,'Lokalizacja nadrzędna nie istnieje.');
    }
    await client.query('UPDATE locations SET name=$2,kind=$3,parent_id=$4,version=version+1 WHERE id=$1',[id,input.name,input.kind??before.kind,parentId??null]);
    const after = (await client.query<Location>('SELECT id,name,path,kind,parent_id AS "parentId",version FROM location_paths WHERE id=$1',[id])).rows[0];
    await audit(client,user,'UPDATE_LOCATION','location',id,`Zmieniono lokalizację ${before.path} na ${after.path}.`,before,after);
    return clean(after);
  });
}

export async function updateDictionary(kind: 'categories'|'suppliers', id: string, body: unknown, user: User): Promise<Named> {
  return saveDictionary(kind,id,body,user);
}

export async function deleteAdminEntry(kind: 'locations'|'categories'|'suppliers', id: string, user: User): Promise<Named> {
  requireRole(user,['ADMIN']);
  parse(uuidSchema,id);
  const table = kind==='locations'?'locations':kind==='categories'?'asset_categories':'suppliers';
  const entity = kind==='locations'?'location':kind==='categories'?'category':'supplier';
  try {
    return await transaction(async client => {
      if (kind==='locations') await client.query('LOCK TABLE locations IN SHARE ROW EXCLUSIVE MODE');
      const before = (await client.query<Named>(`SELECT id,name FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if (!before) throw new AppError(404,'Nie znaleziono wpisu.');
      // The generated label belongs to the location; all business references stay protected by foreign keys.
      if (kind==='locations') await client.query('DELETE FROM qr_codes WHERE location_id=$1',[id]);
      await client.query(`DELETE FROM ${table} WHERE id=$1`,[id]);
      await audit(client,user,kind==='locations'?'DELETE_LOCATION':kind==='categories'?'DELETE_CATEGORY':'DELETE_SUPPLIER',entity,id,`Usunięto wpis: ${before.name}.`,before);
      return before;
    });
  } catch (error) {
    if (['23503','23001'].includes((error as {code?:string}).code??'')) {
      throw new AppError(409,kind==='locations'?'Nie można usunąć lokalizacji z poziomami podrzędnymi lub powiązanymi rekordami. Najpierw przenieś je do innej lokalizacji.':kind==='categories'?'Nie można usunąć kategorii używanej przez sprzęt, pozycje faktur lub konfiguracje. Najpierw zmień ich kategorię.':'Nie można usunąć dostawcy powiązanego z fakturami. Możesz edytować jego nazwę.');
    }
    return pgError(error);
  }
}
export async function createCategory(body: unknown, user: User): Promise<Named> {
  return saveDictionary('categories',null,body,user);
}
export async function createSupplier(body: unknown, user: User): Promise<Named> {
  return saveDictionary('suppliers',null,body,user);
}
export async function exportAssetHistory(assetId:string){
 const asset=await getAsset(assetId),history=await getAssetHistory(assetId);if(history.length>10000)throw new AppError(413,'Historia przekracza limit 10 000 zdarzeń.');
 return csv([['Asset ID','Urządzenie','Data UTC','Wykonawca','Operacja','Poprzedni odbiorca','Nowy odbiorca','Opis'],...history.map(h=>[asset.assetId,asset.name,h.createdAt,h.actorName,h.action,(h.before as Asset|null)?.owner,(h.after as Asset|null)?.owner,h.description])]);
}
export async function getEmployeeEquipment(employeeId:string){
 parse(uuidSchema,employeeId);
 const employee=await getEmployee(employeeId);
 const assets=(await query<Asset>(`SELECT ${assetProjection} ${assetFrom} WHERE a.employee_id=$1 ORDER BY a.name,a.asset_id`,[employeeId])).rows;
 const history=(await query<History>(`SELECT h.id,h.action,u.name AS "actorName",h.created_at AS "createdAt",h.description,h.before_data AS before,h.after_data AS after FROM asset_history h JOIN users u ON u.id=h.actor_id WHERE h.before_data->>'employeeId'=$1 OR h.after_data->>'employeeId'=$1 ORDER BY h.created_at DESC,h.id LIMIT 500`,[employeeId])).rows;
 return clean({employee,assets,history});
}
export async function getMyEquipment(user:User){const employee=(await query<{id:string}>('SELECT id FROM employees WHERE user_id=$1 AND active',[user.id])).rows[0];return employee?getEmployeeEquipment(employee.id):{employee:null,assets:[],history:[]};}
