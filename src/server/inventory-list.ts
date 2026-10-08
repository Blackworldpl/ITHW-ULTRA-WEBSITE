import {z} from 'zod';
import type {InventoryItem,PageResult} from '@/shared/types';
import {inventorySortLabels,stockStateLabels,type InventoryCategory,type InventoryPage,type InventorySummary,type InventoryStockState} from '@/shared/inventory';
import {query} from './db';
import {parse,uuidSchema} from './validation';
import {AppError} from './errors';

export const inventoryProjection=`n.id,n.slug,n.sku,n.product_code AS "productCode",n.name,n.category,n.unit,coalesce((SELECT quantity_precision FROM inventory_dictionary_entries d WHERE d.kind='unit' AND d.name=n.unit),0) AS "quantityPrecision",n.stock::float8 AS stock,n.minimal_stock::float8 AS "minimalStock",
 n.location_id AS "locationId",l.path AS "locationName",n.notes,n.updated_at AS "updatedAt",n.version`;
export const inventoryFrom='FROM inventory_items n LEFT JOIN location_paths l ON l.id=n.location_id';
const booleanParam=z.enum(['true','false']).transform(value=>value==='true');
const schema=z.object({
 q:z.string().trim().max(200).default(''),category:z.string().trim().max(120).default(''),locationId:uuidSchema.optional(),
 noLocation:booleanParam.default(false),includeChildren:booleanParam.default(true),overview:booleanParam.default(false),
 stockState:z.enum(Object.keys(stockStateLabels) as [InventoryStockState,...InventoryStockState[]]).default('all'),
 sort:z.enum(Object.keys(inventorySortLabels) as [keyof typeof inventorySortLabels,...(keyof typeof inventorySortLabels)[]]).default('name'),
 direction:z.enum(['asc','desc']).optional(),page:z.coerce.number().int().min(1).max(1000000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(25)
});
const escapeLike=(value:string)=>value.replace(/[\\%_]/g,character=>'\\'+character);
const polishLetters='ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',plainLetters='acelnoszzACELNOSZZ';
const normalized=(value:string)=>value.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g,letter=>plainLetters[polishLetters.indexOf(letter)]);
const searchable=(expression:string)=>`translate(${expression},'${polishLetters}','${plainLetters}')`;
const stockFilters:Record<InventoryStockState,string>={all:'TRUE',low:'n.stock<=n.minimal_stock',out:'n.stock=0',ok:'n.stock>n.minimal_stock',inStock:'n.stock>0'};
const sorts={name:'n.name',sku:'n.sku',category:'n.category',stock:'n.stock',minimum:'n.minimal_stock',shortage:'greatest(n.minimal_stock-n.stock,0)',location:'l.path',updatedAt:'n.updated_at'};
export async function listInventory(params:URLSearchParams):Promise<InventoryPage>{
 const lowStock=params.get('lowStock');if(lowStock!==null&&!['true','false'].includes(lowStock))throw new AppError(400,'Nieprawidłowy filtr stanu.');
 const input=parse(schema,Object.fromEntries(['q','category','locationId','noLocation','includeChildren','overview','stockState','sort','direction','page','pageSize'].filter(key=>params.has(key)).map(key=>[key,params.get(key)])));
 if(!params.has('stockState')&&lowStock==='true')input.stockState='low';
 if(input.noLocation&&input.locationId)throw new AppError(400,'Wybierz lokalizację albo brak lokalizacji.');
 const filters:string[]=[],values:unknown[]=[];
 const add=(value:unknown,expression:(parameter:string)=>string)=>{values.push(value);filters.push(expression('$'+values.length));};
 const search=`(n.name||' '||coalesce(n.sku,'')||' '||coalesce(n.product_code,'')||' '||n.slug||' '||n.category||' '||coalesce(l.path,''))`;
 for(const term of new Set(normalized(input.q).split(/\s+/).filter(Boolean)))add('%'+escapeLike(term)+'%',p=>`${searchable(search)} ILIKE ${p}`);
 if(input.category)add(input.category,p=>`n.category=${p}`);
 if(input.noLocation)filters.push('n.location_id IS NULL');
 if(input.locationId)add(input.locationId,p=>input.includeChildren?`n.location_id IN (WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=${p} UNION ALL SELECT l.id FROM locations l JOIN branch b ON l.parent_id=b.id) SELECT id FROM branch)`:`n.location_id=${p}`);
 const base=filters.length?filters.join(' AND '):'TRUE',stock=stockFilters[input.stockState];
 const direction=input.direction??(['shortage','updatedAt'].includes(input.sort)?'desc':'asc');
 const order=`${sorts[input.sort]} ${direction} NULLS LAST,n.name,n.id`;
 const summary=input.overview?`,count(*)::integer AS products,count(*) FILTER(WHERE n.stock<=n.minimal_stock)::integer AS low,count(*) FILTER(WHERE n.stock=0)::integer AS out,count(*) FILTER(WHERE n.stock>n.minimal_stock)::integer AS ok`:'';
 const [rows,counts]=await Promise.all([
  query<InventoryItem>(`SELECT ${inventoryProjection} ${inventoryFrom} WHERE ${base} AND ${stock} ORDER BY ${order} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,input.pageSize,(input.page-1)*input.pageSize]),
  query<{total:number}&InventorySummary>(`SELECT count(*) FILTER(WHERE ${stock})::integer AS total ${summary} ${inventoryFrom} WHERE ${base}`,values)
 ]);
 const {total,products,low,out,ok}=counts.rows[0];
 return JSON.parse(JSON.stringify({items:rows.rows,total,page:input.page,pageSize:input.pageSize,...(input.overview?{summary:{products,low,out,ok}}:{})}));
}
export async function inventoryCategories(params:URLSearchParams):Promise<PageResult<InventoryCategory>>{
 const {q,page,pageSize}=parse(schema,{q:params.get('q')??'',page:params.get('page')??1,pageSize:params.get('pageSize')??30});
 const pattern='%'+escapeLike(normalized(q))+'%',match=searchable('category');
 const [items,total]=await Promise.all([
  query<InventoryCategory>(`SELECT category AS name,count(*)::integer AS count FROM inventory_items WHERE ${match} ILIKE $1 GROUP BY category ORDER BY category LIMIT $2 OFFSET $3`,[pattern,pageSize,(page-1)*pageSize]),
  query<{total:number}>(`SELECT count(DISTINCT category)::integer AS total FROM inventory_items WHERE ${match} ILIKE $1`,[pattern])
 ]);
 return {items:items.rows,total:total.rows[0].total,page,pageSize};
}
