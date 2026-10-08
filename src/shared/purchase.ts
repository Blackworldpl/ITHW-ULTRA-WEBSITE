export function deliveryQuantities(delivery:{itemCount:number;quantities?:{unit:string;quantity:number}[]}):string{return delivery.quantities?.length?delivery.quantities.map(q=>q.quantity.toLocaleString('pl-PL')+' '+q.unit).join(' · '):delivery.itemCount.toLocaleString('pl-PL')+' szt.';}
export interface SerialMatch {serialNumber:string;assetId:string;version:number}
export interface SerialPreview {serialNumber:string;state:'new'|'existing'|'linked'|'conflict';assetId:string|null;name:string|null;version:number|null;invoiceNumber:string|null}
export const currencies=[['PLN','złoty polski'],['EUR','euro'],['USD','dolar amerykański'],['GBP','funt brytyjski']] as const;
export function serialList(text:string):string[]{return text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
