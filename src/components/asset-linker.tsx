'use client';
import {useCallback,useEffect,useState} from 'react';
import type {Asset,PageResult} from '@/shared/types';
import {useApp} from './context';
import {SearchSelect} from './pickers';
import {api,Button,ErrorMessage,formatDate} from './ui';
export function AssetLinker({mode,targetId,targetName,onSaved}:{mode:'invoice'|'location'|'employee';targetId:string;targetName:string;onSaved:()=>void}){
 const {user}=useApp(),[assetId,setAssetId]=useState(''),[asset,setAsset]=useState<Asset|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const search=useCallback(async(text:string,signal:AbortSignal)=>(await api<PageResult<Asset>>(`/api/assets?q=${encodeURIComponent(text)}&pageSize=25`,{signal})).items.map(a=>({id:a.assetId,label:a.name,detail:`${a.assetId} · SN ${a.serialNumber||'—'}`})),[]);
 useEffect(()=>{setAsset(null);setError('');if(!assetId)return;const controller=new AbortController();api<Asset>(`/api/assets/${assetId}`,{signal:controller.signal}).then(a=>{if(!controller.signal.aborted)setAsset(a);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[assetId]);
 async function save(){if(!asset||busy)return;setBusy(true);setError('');try{
  if(mode==='invoice')await api(`/api/assets/${asset.assetId}`,{method:'PATCH',body:JSON.stringify({version:asset.version,invoiceId:targetId})},user.csrfToken);
  else await api(`/api/assets/${asset.assetId}/actions`,{method:'POST',body:JSON.stringify({version:asset.version,...(mode==='location'?{action:'move',locationId:targetId}:{action:'assign',employeeId:targetId})})},user.csrfToken);
  setAssetId('');setAsset(null);onSaved();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const same=asset&&(mode==='invoice'?asset.invoiceId===targetId:mode==='location'?asset.locationId===targetId:asset.employeeId===targetId);
 return <div className="asset-linker"><ErrorMessage message={error}/><SearchSelect label={mode==='invoice'?'Powiąż istniejące urządzenie z fakturą':mode==='location'?'Dodaj istniejące urządzenie do stanowiska':'Wydaj / przekaż urządzenie pracownikowi'} value={assetId} onSelect={setAssetId} options={[]} search={search} disabled={busy} placeholder="Nazwa, Asset ID lub numer seryjny…"/>{asset&&<div className="asset-link-preview"><div><strong>{asset.name}</strong><p>SN: {asset.serialNumber||'—'} · {asset.assetId}</p><p>{mode==='invoice'?`Obecna FV: ${asset.invoiceNumber||'brak'}`:mode==='location'?`Obecna lokalizacja: ${asset.locationName||'brak'}`:`Obecny odbiorca: ${asset.owner||'brak'}`}</p>{mode==='location'&&asset.employeeId&&<p>Sprzęt jest wydany pracownikowi. Zmiana miejsca nie usuwa osobistego przypisania.</p>}</div><Button type="button" disabled={busy||!!same} onClick={save}>{busy?'Zapisywanie…':same?'Już przypisane':mode==='invoice'?'Przypisz do tej FV':mode==='location'?`Przenieś na ${targetName}`:asset.owner?'Przekaż pracownikowi':'Wydaj pracownikowi'}</Button></div>}</div>;
}
