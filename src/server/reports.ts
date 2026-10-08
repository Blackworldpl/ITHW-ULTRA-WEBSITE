import type { Reports,User } from '@/shared/types';
import {hasPermission} from '@/shared/permissions';
import { query } from './db';
import { csv } from './csv';
import { AppError } from './errors';

const today="(now() AT TIME ZONE 'Europe/Warsaw')::date";
const pricedFrom='FROM assets a LEFT JOIN invoices i ON i.id=a.invoice_id';
const currency="COALESCE(i.currency,'PLN')";
const shortageSql=`SELECT n.slug,n.sku,n.name,n.unit,n.stock::float8 AS stock,n.minimal_stock::float8 AS minimum,
  greatest(n.minimal_stock-n.stock,0)::float8 AS missing,l.path AS location
  FROM inventory_items n LEFT JOIN location_paths l ON l.id=n.location_id
  WHERE n.minimal_stock>0 AND n.stock<=n.minimal_stock ORDER BY missing DESC,n.name,n.id`;

export async function getReports(user?:User):Promise<Reports> {
  const [summary,categories,statuses,locations,warranty,values,monthly,suppliers,withdrawals,shortages]=await Promise.all([
    query<{totalAssets:number;fixedAssets:number;unpriced:number}>('SELECT count(*)::int AS "totalAssets",count(*) FILTER(WHERE is_fixed_asset)::int AS "fixedAssets",count(*) FILTER(WHERE purchase_price IS NULL)::int AS unpriced FROM assets'),
    query<Reports['byCategory'][number]>('SELECT c.id,c.name AS label,count(*)::int AS count FROM assets a JOIN asset_categories c ON c.id=a.category_id GROUP BY c.id,c.name ORDER BY count DESC,c.name'),
    query<Reports['byStatus'][number]>('SELECT status AS id,status AS label,count(*)::int AS count FROM assets GROUP BY status ORDER BY count DESC,status'),
    query<Reports['byLocation'][number]>("SELECT l.id,COALESCE(l.path,'Nie przypisano') AS label,count(*)::int AS count FROM assets a LEFT JOIN location_paths l ON l.id=a.location_id GROUP BY l.id,l.path ORDER BY count DESC,label"),
    query<Reports['warranty']>(`SELECT count(*) FILTER(WHERE warranty_until<${today})::int AS expired,
      count(*) FILTER(WHERE warranty_until BETWEEN ${today} AND ${today}+30)::int AS soon,
      count(*) FILTER(WHERE warranty_until>${today}+30)::int AS valid,
      count(*) FILTER(WHERE warranty_until IS NULL)::int AS unknown FROM assets WHERE status<>'RETIRED'`),
    query<Reports['values'][number]>(`SELECT ${currency} AS currency,sum(a.purchase_price)::text AS total,
      COALESCE(sum(a.purchase_price) FILTER(WHERE a.status<>'RETIRED'),0)::text AS active,
      COALESCE(sum(a.purchase_price) FILTER(WHERE a.is_fixed_asset AND a.status<>'RETIRED'),0)::text AS fixed
      ${pricedFrom} WHERE a.purchase_price IS NOT NULL GROUP BY ${currency} ORDER BY currency`),
    query<Reports['monthly'][number]>(`SELECT to_char(a.purchased_at,'YYYY-MM') AS month,${currency} AS currency,count(*)::int AS count,
      sum(a.purchase_price)::text AS value,count(*) FILTER(WHERE a.purchase_price IS NULL)::int AS unpriced ${pricedFrom}
      WHERE a.purchased_at>=date_trunc('month',now() AT TIME ZONE 'Europe/Warsaw')-interval '11 months' AND a.purchased_at<=${today}
      GROUP BY month,${currency} ORDER BY month DESC,currency`),
    query<Reports['bySupplier'][number]>(`SELECT s.id,s.name AS label,i.currency AS currency,count(*)::int AS count,
      sum(a.purchase_price)::text AS value,count(*) FILTER(WHERE a.purchase_price IS NULL)::int AS unpriced FROM assets a JOIN invoices i ON i.id=a.invoice_id JOIN suppliers s ON s.id=i.supplier_id
      GROUP BY s.id,s.name,i.currency ORDER BY count DESC,label,currency`),
    query<Reports['topWithdrawals'][number]>(`SELECT n.slug,n.name AS label,n.unit,(-sum(t.delta))::float8 AS quantity FROM inventory_transactions t
      JOIN inventory_items n ON n.id=t.inventory_item_id WHERE t.action='WITHDRAWAL' AND t.created_at>=now()-interval '90 days'
      GROUP BY n.id,n.slug,n.name,n.unit ORDER BY quantity DESC,n.name LIMIT 15`),
    query<Reports['shortages'][number]>(shortageSql+' LIMIT 50'),
  ]);
  if(user&&!hasPermission(user,'invoice.view')){values.rows=[];monthly.rows=[];suppliers.rows=[];}
  if(user&&!hasPermission(user,'inventory.view')){withdrawals.rows=[];shortages.rows=[];}
  if(user&&!hasPermission(user,'location.view'))locations.rows=[];
  return {...summary.rows[0],byCategory:categories.rows,byStatus:statuses.rows,byLocation:locations.rows,warranty:warranty.rows[0],values:values.rows,monthly:monthly.rows,bySupplier:suppliers.rows,topWithdrawals:withdrawals.rows,shortages:shortages.rows};
}

export async function exportShortages(user:User):Promise<string> {
  // Same rule as the on-screen report: stock data requires inventory.view (F03).
  if(!hasPermission(user,'inventory.view'))throw new AppError(403,'Brak uprawnienia: inventory.view.');
  const rows=await query<Reports['shortages'][number]>(shortageSql+' LIMIT 10001');
  if(rows.rows.length>10000) throw new AppError(413,'Lista obejmuje ponad 10 000 produktów. Skorzystaj z rejestru magazynowego.');
  return csv([['SKU','Produkt','Stan','Minimum','Brakuje do minimum','Jednostka','Lokalizacja'],...rows.rows.map(r=>[r.sku,r.name,r.stock,r.minimum,r.missing,r.unit,r.location])]);
}
