'use client';
import {terminalAssetFieldLabels,terminalInventoryFieldLabels,type DeviceReading,type TerminalConfig} from '@/shared/devices';
import {StatusBadge} from './ui';
export const terminalResultLabels={EXPECTED:'Odczyt zapisany',UNEXPECTED:'Urządzenie spoza tej lokalizacji',DUPLICATE:'Powtórzony odczyt',UNKNOWN:'Nieznany kod'} as const;
export function TerminalReadingCard({reading,options}:{reading:DeviceReading;options:TerminalConfig}){
 const fields:{key:string;label:string;value:string}[]=[];
 if(reading.asset)for(const key of options.assetFields){if(key==='status')continue;fields.push({key,label:terminalAssetFieldLabels[key],value:reading.asset[key]||'—'});}
 if(reading.product)for(const key of options.inventoryFields){const value=reading.product[key];fields.push({key,label:terminalInventoryFieldLabels[key],value:typeof value==='number'?value.toLocaleString('pl-PL')+' '+(reading.product.unit??''):value||'—'});}
 return <article className="terminal-result" data-result={reading.event?.result??'EXPECTED'} aria-live="polite"><small>{reading.event?terminalResultLabels[reading.event.result]:reading.product?'Rozpoznano produkt magazynowy':'Rozpoznano rekord'}</small><h2>{reading.title}</h2>{reading.asset?.status&&options.assetFields.includes('status')&&<StatusBadge status={reading.asset.status}/>} {!!fields.length&&<dl>{fields.map(field=><div className="terminal-detail" key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}{reading.product&&options.inventoryFields.includes('stock')&&options.inventoryFields.includes('minimalStock')&&reading.product.stock!==undefined&&reading.product.minimalStock!==undefined&&reading.product.stock<=reading.product.minimalStock&&<p className="text-amber">Stan na minimum lub poniżej.</p>}{options.showCode&&reading.code&&<code>{reading.code}</code>}</article>;
}
