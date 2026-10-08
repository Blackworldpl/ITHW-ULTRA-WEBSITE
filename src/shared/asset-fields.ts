import type {Category} from './types';

export const standardFieldGroups = [
  {label:'Dane urządzenia',fields:[['manufacturer','Producent'],['model','Model'],['serialNumber','Numer seryjny'],['rfidTag','RFID']]},
  {label:'Lokalizacja i odbiorca',fields:[['locationId','Lokalizacja'],['owner','Pracownik / właściciel']]},
  {label:'Sieć',fields:[['hostname','Hostname'],['ipAddress','Adres IP'],['macAddress','Adres MAC']]},
  {label:'Zakup i ewidencja',fields:[['purchasedAt','Data zakupu'],['purchasePrice','Cena zakupu'],['invoiceId','Powiązanie faktury'],['warrantyUntil','Gwarancja'],['isFixedAsset','Środek trwały i jego numer']]},
  {label:'Pozostałe',fields:[['sku','SKU'],['productCode','Kod produktu'],['notes','Uwagi']]},
] as const;
export const standardFieldKeys = standardFieldGroups.flatMap(group=>group.fields.map(([key])=>key));
export type StandardFieldKey = typeof standardFieldKeys[number];
export type StandardFields = Partial<Record<StandardFieldKey,boolean>>;
export function assetFieldVisible(category:Pick<Category,'standardFields'>|undefined,key:StandardFieldKey){return category?.standardFields?.[key]!==false;}
export function categoryAssetBody<T extends Record<string,unknown>>(body:T,category:Pick<Category,'standardFields'>|undefined){
  return Object.fromEntries(Object.entries(body).filter(([key])=>{
    if(key==='employeeId')return assetFieldVisible(category,'owner')||body.status==='ASSIGNED';
    if(key==='fixedAssetNumber')return assetFieldVisible(category,'isFixedAsset');
    if(key==='owner'&&body.status==='ASSIGNED')return true;
    return !standardFieldKeys.includes(key as StandardFieldKey)||assetFieldVisible(category,key as StandardFieldKey);
  }));
}
