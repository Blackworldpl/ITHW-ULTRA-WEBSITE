'use client';
import {createUuid} from '@/shared/uuid';
import {useRef,useState,type FormEvent} from 'react';
import {quantityOrNaN,addQuantity} from '@/shared/quantity';
import type {InventoryItem} from '@/shared/types';
import {useApp} from './context';
import {api,ApiFailure,Button,ErrorMessage,Field,Loading,Modal,useResource} from './ui';

export function InventoryMovementModal({item,direction,onClose,onSaved}:{item:InventoryItem;direction:1|-1;onClose:()=>void;onSaved:(item:InventoryItem,message:string)=>void}){
 const {user}=useApp(),resource=useResource<InventoryItem>('/api/inventory/'+item.slug);
 const current=resource.data,[quantityText,setQuantityText]=useState('1'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false),pending=useRef<{delta:number;note:string;requestId:string}|null>(null);
 const quantity=quantityOrNaN(quantityText,current?.quantityPrecision??item.quantityPrecision);
 const invalid=!Number.isFinite(quantity);
 const insufficient=!!current&&direction<0&&quantity>current.stock,overflow=!!current&&direction>0&&Number.isFinite(quantity)&&addQuantity(current.stock,quantity)>10000000;
 async function submit(event:FormEvent){
  event.preventDefault();if(locked.current||invalid||insufficient||overflow||!current)return;
  locked.current=true;setBusy(true);setError('');const delta=quantity*direction;
  if(pending.current?.delta!==delta||pending.current?.note!==note)pending.current={delta,note,requestId:createUuid()};
  try{const saved=await api<InventoryItem>('/api/inventory/'+item.slug+'/movements',{method:'POST',body:JSON.stringify(pending.current)},user.csrfToken);pending.current=null;onSaved(saved,`${direction<0?'Pobrano':'Zwrócono'} ${quantity.toLocaleString('pl-PL')} ${saved.unit} · ${saved.name}`);}
  catch(failure){setError((failure as Error).message);if((failure as ApiFailure).status===409)resource.reload();}
  finally{locked.current=false;setBusy(false);}
 }
 return <Modal title={direction<0?'Pobierz z magazynu':'Przyjmij zwrot'} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
  <div className="warehouse-movement-product"><strong>{item.name}</strong><span className="mono">{item.sku||item.productCode||item.slug}</span></div>
  <ErrorMessage message={error||resource.error} onRetry={resource.error?resource.reload:undefined}/>
  {resource.loading&&!current?<Loading compact/>:<p className="warehouse-movement-balance">Aktualnie: <strong>{current?.stock.toLocaleString('pl-PL')??'—'} {item.unit}</strong><span>{current?.locationName||'Bez lokalizacji'}</span></p>}
  <fieldset disabled={busy||resource.loading||!current||!!resource.error} className="plain-fieldset">
   <Field label={'Ilość ('+item.unit+')'} hint={current?.quantityPrecision?'Do '+current.quantityPrecision+' miejsc po przecinku; możesz wpisać przecinek.':'Ilość w całych sztukach.'}><input required type="text" inputMode={current?.quantityPrecision?"decimal":"numeric"} value={quantityText} onChange={event=>setQuantityText(event.target.value)} data-autofocus/></Field>
   <div className="warehouse-quantity-shortcuts">{(current?.quantityPrecision?[0.1,0.5,1,5]:[1,5,10,25]).map(value=><Button key={value} type="button" variant="ghost" disabled={direction<0&&value>(current?.stock??0)} onClick={()=>setQuantityText(String(value))} aria-pressed={quantity===value}>{value.toLocaleString('pl-PL')}</Button>)}</div>
   <Field label="Notatka do ruchu (opcjonalnie)"><textarea maxLength={1000} rows={2} value={note} onChange={event=>setNote(event.target.value)} placeholder="Np. stanowisko, cel pobrania lub powód zwrotu"/></Field>
   {insufficient&&<p className="notice notice-error">Możesz pobrać najwyżej {current?.stock.toLocaleString('pl-PL')} {item.unit}</p>}
   {overflow&&<p className="notice notice-error">Ta ilość przekracza maksymalny stan produktu.</p>}
   {current&&!invalid&&!insufficient&&!overflow&&<p className="warehouse-movement-preview">Stan po operacji: <strong>{(addQuantity(current.stock,quantity*direction)).toLocaleString('pl-PL')} {current.unit}</strong></p>}
   <p className="help-note">Ruch zapisze się w historii produktu wraz z użytkownikiem i datą. Nowe zakupy przyjmuj przez dostawę.</p>
  </fieldset>
  <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button disabled={busy||resource.loading||!current||!!resource.error||invalid||insufficient||overflow}>{busy?'Zapisywanie…':direction<0?'Potwierdź pobranie':'Potwierdź zwrot'}</Button></div>
 </form></Modal>;
}
