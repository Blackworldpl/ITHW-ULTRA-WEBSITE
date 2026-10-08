import type {AssetStatus,InventoryItem} from '@/shared/types';
import type {InventoryScan} from '@/shared/product';
import {terminalConfig,type DeviceConfig,type DeviceInventory,type DeviceReading} from '@/shared/devices';
import {query} from './db';
import {inventoryFrom,inventoryProjection} from './inventory-list';

export function terminalInventory(scan:InventoryScan,config:DeviceConfig):DeviceInventory {
 const result:DeviceInventory={id:scan.id,locationName:scan.locationName,status:scan.status};
 for(const key of terminalConfig(config).counters)result[key]=scan[key];
 return result;
}
export async function terminalReading(href:string,title:string,code:string,config:DeviceConfig):Promise<DeviceReading>{
 const options=terminalConfig(config),result:DeviceReading={code:options.showCode?code:'',title,asset:null};
 if(href.startsWith('/asset/')){
  const asset=(await query<{assetId:string;name:string;serialNumber:string|null;model:string|null;status:AssetStatus;locationName:string|null}>(`SELECT a.asset_id AS "assetId",a.name,a.serial_number AS "serialNumber",a.model,a.status,l.path AS "locationName" FROM assets a LEFT JOIN location_paths l ON l.id=a.location_id WHERE a.asset_id=$1`,[href.slice(7)])).rows[0];
  if(asset){result.asset={name:asset.name};for(const key of options.assetFields)Object.assign(result.asset,{[key]:asset[key]});}
 }else if(href.startsWith('/inventory/')){
  const product=(await query<InventoryItem>(`SELECT ${inventoryProjection} ${inventoryFrom} WHERE n.slug=$1`,[href.slice(11)])).rows[0];
  if(product){result.product={name:product.name};for(const key of options.inventoryFields)Object.assign(result.product,{[key]:product[key]});if(options.inventoryFields.some(key=>key==='stock'||key==='minimalStock'))result.product.unit=product.unit;}
 }
 return result;
}
