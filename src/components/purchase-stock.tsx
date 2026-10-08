'use client';
import {createUuid} from '@/shared/uuid';
import {useRef,useState,type FormEvent} from 'react';
import type {InvoiceDetail,InvoiceLine} from '@/shared/types';
import {quantityValue,subtractQuantity} from '@/shared/quantity';
import {useApp} from './context';
import {api,Button,ErrorMessage,Field,Modal} from './ui';

export function InvoiceStockModal({invoice,line,onClose,onSaved}:{invoice:InvoiceDetail;line:InvoiceLine;onClose:()=>void;onSaved:()=>void}){
 const {user}=useApp(),remaining=subtractQuantity(line.quantity,line.receivedQuantity??0);
 const [quantity,setQuantity]=useState(String(remaining).replace('.',',')),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),request=useRef<{quantity:number;id:string}|null>(null);
 async function submit(event:FormEvent){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const count=quantityValue(quantity,line.quantityPrecision??0,0.001,remaining);if(request.current?.quantity!==count)request.current={quantity:count,id:createUuid()};
  await api(`/api/invoices/${invoice.id}/items/${line.id}/receive`,{method:'POST',body:JSON.stringify({quantity:count,version:invoice.version,requestId:request.current.id})},user.csrfToken);onSaved();
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 return <Modal title={`Przyjmij produkt — pozycja ${line.position}: ${line.name}`} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}><ErrorMessage message={error}/><p className="help-note">{line.inventoryItemName??line.name} · przyjęto {(line.receivedQuantity??0).toLocaleString('pl-PL')} z {line.quantity.toLocaleString('pl-PL')} {line.unit}. Możesz przyjąć pozostałość lub część dostawy.</p><Field label={`Ilość do przyjęcia (${line.unit}) *`}><input autoFocus type="text" required inputMode={line.quantityPrecision?"decimal":"numeric"} value={quantity} disabled={busy} onChange={e=>setQuantity(e.target.value)}/></Field><div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button disabled={busy}>{busy?'Przyjmowanie…':'Przyjmij na stan'}</Button></div></form></Modal>;
}
