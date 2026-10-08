import {z} from 'zod';
import {scanTarget} from '@/shared/scan';
import type {User} from '@/shared/types';
import {query,transaction} from './db';
import {AppError} from './errors';
import {parse,uuidSchema} from './validation';
import {requirePermission} from './permissions';
import {idempotent,resolveScan,getAsset} from './services';
export async function observeIdentifier(body:unknown,user:User){
 requirePermission(user,'rfid.scan');const input=parse(z.object({code:z.string().trim().min(1).max(2048),requestId:uuidSchema}).strict(),body);
 const value=input.code,urlLike=value.includes('://')||/^(?:[a-z]+:|\/|\\)/i.test(value),origin=new URL(process.env.APP_URL!).origin;
 const href=urlLike?scanTarget(value,origin):(await resolveScan(value)).href;
 if(!href)throw new AppError(400,'Kod nie prowadzi do rekordu w tym systemie.');
 let title=href,assetId:string|null=null,action='QR_SCANNED';
 if(href.startsWith('/asset/')){requirePermission(user,'asset.view');const asset=await getAsset(href.slice(7));title=asset.name;assetId=asset.id;action=value.toLowerCase()===asset.rfidTag?.toLowerCase()?'RFID_SCANNED':'QR_SCANNED';}
 else if(href.startsWith('/inventory/')){requirePermission(user,'inventory.view');const row=(await query('SELECT name FROM inventory_items WHERE slug=$1',[href.slice(11)])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono produktu.');title=row.name;}
 else{requirePermission(user,'location.view');const id=href.startsWith('/workstations/')?href.slice(14):new URL(href,origin).searchParams.get(href.startsWith('/locations')?'selected':'locationId');const row=(await query('SELECT name FROM locations WHERE id=$1',[id])).rows[0];if(!row)throw new AppError(404,'Nie znaleziono lokalizacji.');title=row.name;}
 return transaction(client=>idempotent(client,user,input.requestId,'OBSERVE_IDENTIFIER',input,async()=>{if(assetId)await client.query('INSERT INTO asset_history(asset_id,actor_id,action,description) VALUES($1,$2,$3,$4)',[assetId,user.id,action,'Odczyt identyfikatora urządzenia.']);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1,$2,'scan',$3,'Odczytano identyfikator w skanerze.')",[user.id,action,assetId]);return {href,title,code:value};}));
}
