import {quantityUnits} from './quantity';
export function normalizedMoney(value:string):string {
 const trimmed=value.trim().replace(/\s/g,'').replace(',','.');
 if(!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed))throw new Error('Wpisz poprawną kwotę, np. 1250,50.');
 return trimmed;
}
export function moneyCents(value:string):bigint{const [whole,fraction='']=normalizedMoney(value).split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));}
export function purchaseTotal(lines:{quantity:number;unitPrice:string|null|undefined}[]):string|null{if(lines.some(l=>l.unitPrice==null))return null;return invoiceTotal(lines as {quantity:number;unitPrice:string}[]);}
export function invoiceTotal(lines:{quantity:number;unitPrice:string}[]):string{
 let cents=0n;for(const line of lines){const quantity=quantityUnits(line.quantity);if(quantity<=0n)throw new Error('Ilość musi być dodatnia.');cents+=(moneyCents(line.unitPrice)*quantity+500n)/1000n;}
 if(cents>99999999999999n)throw new Error('Wartość faktury przekracza dopuszczalną kwotę.');
 return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
}
