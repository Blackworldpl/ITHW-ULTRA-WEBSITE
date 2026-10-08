'use client';
import {createUuid} from '@/shared/uuid';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {InventoryItem} from '@/shared/types';
import type {InventoryDictionaries} from '@/shared/inventory-dictionaries';
import {quantityValue} from '@/shared/quantity';
import {hasPermission} from '@/shared/permissions';
import {useApp} from './context';
import {LocationPicker,SearchSelect} from './pickers';
import {api,Button,ErrorMessage,Field,Loading,Modal,useResource} from './ui';

export function InventoryForm({item,onClose,onSaved,initialName='',inDocument=false}:{item?:InventoryItem;onClose:()=>void;onSaved:(item:InventoryItem)=>void;initialName?:string;inDocument?:boolean}){
 const {user}=useApp(),dictionary=useResource<InventoryDictionaries>('/api/inventory/dictionaries');
 const suffix=useRef<string|null>(null),locked=useRef(false);
 const nameInput=useRef<HTMLInputElement>(null),initialFocus=useRef(false);
 useEffect(()=>{if(dictionary.data&&nameInput.current&&!initialFocus.current){nameInput.current.focus();initialFocus.current=true;}},[dictionary.data]);
 const [form,setForm]=useState({name:item?.name??initialName,category:item?.category??'',unit:item?.unit??'szt.',minimalStock:String(item?.minimalStock??0),locationId:item?.locationId??'',sku:item?.sku??'',productCode:item?.productCode??'',notes:item?.notes??''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [opening,setOpening]=useState(false),[openingStock,setOpeningStock]=useState(''),[openingNote,setOpeningNote]=useState('');const requestId=useRef<string|null>(null);
 const change=(key:keyof typeof form,value:string)=>setForm(previous=>({...previous,[key]:value}));
 const categories=dictionary.data?.categories.filter(e=>e.active||e.name===item?.category)??[],units=dictionary.data?.units.filter(e=>e.active||e.name===item?.unit)??[];
 const precision=units.find(u=>u.name===form.unit)?.quantityPrecision??0;
 async function submit(event:FormEvent){
  event.preventDefault();if(locked.current||!dictionary.data)return;locked.current=true;setBusy(true);setError('');
  try{
   const minimalStock=quantityValue(form.minimalStock,precision,0,10000000);
   const initial=opening?quantityValue(openingStock,precision,0):undefined;requestId.current??=createUuid();
   if(!categories.some(c=>c.name===form.category)||!units.some(u=>u.name===form.unit))throw new Error('Wybierz kategorię i jednostkę z listy.');
   suffix.current??=createUuid().slice(0,8);
   const slug=form.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[łŁ]/g,'l').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,85)||'produkt';
   const value=await api<InventoryItem>(item?'/api/inventory/'+item.slug:'/api/inventory',{method:item?'PATCH':'POST',body:JSON.stringify({...form,minimalStock,...(item?{version:item.version}:{slug:slug+'-'+suffix.current,requestId:requestId.current,...(opening?{openingStock:initial,openingNote}:{})})})},user.csrfToken);onSaved(value);
  }catch(failure){setError((failure as Error).message);}finally{locked.current=false;setBusy(false);}
 }
 return <Modal title={item?'Edytuj produkt':'Nowy produkt magazynowy'} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
  <p className="help-note">{item?'Zmień dane kartoteki. Stan i historia pozostają dostępne na karcie produktu.':inDocument?'Utwórz kartotekę, aby wybrać ją na fakturze. Ilość zostanie przyjęta po zatwierdzeniu zakupu.':'Utwórz kartotekę ze stanem zero lub wpisz policzony stan początkowy z opisem źródła.'}</p>
  <ErrorMessage message={error||dictionary.error} onRetry={dictionary.error?dictionary.reload:undefined}/>
  {dictionary.loading&&!dictionary.data&&<Loading compact/>}
  <fieldset disabled={busy||!dictionary.data||!!dictionary.error} className="plain-fieldset"><div className="form-grid">
   <div className="field-span"><Field label="Nazwa produktu *"><input ref={nameInput} autoFocus required maxLength={200} placeholder="np. Kabel HDMI 2 m" value={form.name} onChange={e=>change('name',e.target.value)}/></Field></div>
   <SearchSelect label="Kategoria magazynowa *" required value={form.category} onSelect={name=>change('category',name)} options={categories.map(e=>({id:e.name,label:e.name,detail:e.active?undefined:'Wyłączona — zachowana dla tego produktu'}))} placeholder="Wybierz kategorię z listy…"/>
   <Field label="Jednostka *"><select required value={form.unit} onChange={e=>change('unit',e.target.value)}><option value="">Wybierz jednostkę</option>{units.map(e=><option key={e.id} value={e.name}>{e.name} — {e.label}{!e.active?' (wyłączona)':''}</option>)}</select></Field>
   <Field label="Minimalny stan" hint={'Próg uzupełnienia. '+(precision?'Do '+precision+' miejsc po przecinku, np. 2,5.':'Ilość w całych sztukach.')}><input type="text" required inputMode={precision?"decimal":"numeric"} value={form.minimalStock} onChange={e=>change('minimalStock',e.target.value)}/></Field>
   <LocationPicker label="Lokalizacja magazynowa" value={form.locationId} onChange={id=>change('locationId',id)}/>
  </div>
  {!item&&!inDocument&&hasPermission(user,'inventory.move')&&<div className="purchase-receive"><label className="checkbox-inline"><input type="checkbox" checked={opening} onChange={e=>setOpening(e.target.checked)}/>Wprowadź policzony stan początkowy</label>{opening&&<div className="form-grid"><Field label="Stan początkowy *"><input type="text" inputMode={precision?"decimal":"numeric"} required value={openingStock} onChange={e=>setOpeningStock(e.target.value)}/></Field><Field label="Powód / źródło stanu *"><input required minLength={3} maxLength={1000} value={openingNote} onChange={e=>setOpeningNote(e.target.value)} placeholder="np. policzono zapas podczas uruchomienia magazynu"/></Field></div>}</div>}
  <details className="purchase-device-details" style={{marginTop:16}}><summary>Dodatkowe dane i identyfikatory</summary><div className="form-grid"><Field label="SKU (opcjonalnie)"><input maxLength={100} value={form.sku} onChange={e=>change('sku',e.target.value)}/></Field><Field label="Kod producenta (opcjonalnie)"><input maxLength={160} value={form.productCode} onChange={e=>change('productCode',e.target.value)}/></Field><div className="field-span"><Field label="Uwagi"><textarea maxLength={4000} value={form.notes} onChange={e=>change('notes',e.target.value)}/></Field></div>{item&&<p className="help-note field-span">Stały identyfikator / QR: <span className="mono">{item.slug}</span></p>}</div></details>
  </fieldset>
  {user.role==='ADMIN'&&<div className="row-actions" style={{marginTop:16}}><a className="subtle-link" href="/admin?tab=inventory-categories" target="_blank" rel="noopener">Zarządzaj kategoriami i jednostkami</a><Button type="button" variant="ghost" onClick={dictionary.reload}>Odśwież listy</Button></div>}
  <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button disabled={busy||!dictionary.data||!!dictionary.error||!categories.length||!units.length}>{busy?'Zapisywanie…':item?'Zapisz zmiany':'Utwórz produkt'}</Button></div>
 </form></Modal>;
}
