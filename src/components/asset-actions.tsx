'use client';
import { useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, MapPin, MessageSquare, Radio, RefreshCw } from 'lucide-react';
import type { Asset, AssetStatus } from '@/shared/types';
import { statuses, statusLabels } from '@/shared/types';
import { canEdit, useApp } from './context';
import { api, Button, ErrorMessage, Field, Modal } from './ui';
import {EmployeePicker,LocationPicker} from './pickers';
import {hasPermission} from '@/shared/permissions';

type Action='assign'|'return'|'move'|'status'|'rfid'|'note';
const titles:Record<Action,string>={assign:'Wydaj urządzenie',return:'Przyjmij zwrot',move:'Zmień lokalizację',status:'Zmień status',rfid:'Przypisz lub odłącz RFID',note:'Dodaj notatkę do historii'};

export function AssetActions({asset,onSaved}:{asset:Asset;onSaved:()=>void}) {
  const {user}=useApp();
  const [action,setAction]=useState<Action|null>(null);
  return <><div className="quick-asset-actions">
    {hasPermission(user,'asset.assign')&&<Button variant="secondary" disabled={!['AVAILABLE','PREPARATION','ASSIGNED'].includes(asset.status)} title="Wydanie sprzętu dostępnego, przygotowywanego lub przekazanie wydanego" onClick={()=>setAction('assign')}><ArrowUpRight size={16}/>{asset.status==='ASSIGNED'?'Przekaż':'Wydaj'}</Button>}
    {hasPermission(user,'asset.assign')&&(asset.owner||asset.status==='ASSIGNED')&&<Button variant="secondary" onClick={()=>setAction('return')}><ArrowDownLeft size={16}/>Przyjmij zwrot</Button>}
    {hasPermission(user,'asset.move')&&<Button variant="secondary" onClick={()=>setAction('move')}><MapPin size={16}/>Lokalizacja</Button>}{hasPermission(user,'asset.status')&&<Button variant="secondary" onClick={()=>setAction('status')}><RefreshCw size={16}/>Status</Button>}{hasPermission(user,'rfid.edit')&&<Button variant="secondary" onClick={()=>setAction('rfid')}><Radio size={16}/>RFID</Button>}{hasPermission(user,'asset.assign')&&<Button variant="secondary" onClick={()=>setAction('note')}><MessageSquare size={16}/>Notatka</Button>}
  </div>{action&&<ActionModal asset={asset} action={action} onClose={()=>setAction(null)} onSaved={()=>{setAction(null);onSaved();}}/>}</>;
}

export function ActionModal({asset,action,onClose,onSaved}:{asset:Asset;action:Action;onClose:()=>void;onSaved:()=>void}) {
  const {user}=useApp();
  const [owner,setOwner]=useState('');
  const [employeeId,setEmployeeId]=useState('');
  const [status,setStatus]=useState<AssetStatus>(action==='return'?'AVAILABLE':asset.status);
  const [locationId,setLocationId]=useState(asset.locationId??'');
  const [rfidTag,setRfidTag]=useState(asset.rfidTag??'');
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    const fields=action==='assign'?{owner:employeeId?null:owner,employeeId:employeeId||null}:action==='return'?{status,locationId:locationId||null}:action==='move'?{locationId}:action==='status'?{status}:action==='rfid'?{rfidTag:rfidTag||null}:{};
    try {await api(`/api/assets/${asset.assetId}/actions`,{method:'POST',body:JSON.stringify({action,version:asset.version,note,...fields})},user.csrfToken);onSaved();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  return <Modal title={action==='assign'&&asset.owner?'Przekaż urządzenie':titles[action]} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <p className="help-note">{asset.assetId} · {asset.name}</p><ErrorMessage message={error}/>
    {action==='assign'&&<>{asset.owner&&<p className="help-note">Obecnie u: <strong>{asset.owner}</strong></p>}<EmployeePicker label="Nowy odbiorca / osoba odpowiedzialna *" employeeId={employeeId} owner={owner} required excludeId={asset.employeeId??undefined} onChange={(id,name)=>{setEmployeeId(id);setOwner(name);}}/></>}
    {(action==='status'||action==='return')&&<Field label={action==='return'?'Stan po zwrocie *':'Nowy status *'}><select value={status} onChange={e=>setStatus(e.target.value as AssetStatus)}>{statuses.filter(s=>action!=='return'||['AVAILABLE','PREPARATION','DAMAGED','REPAIR','DISPOSAL'].includes(s)).map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}</select></Field>}
    {(action==='move'||action==='return')&&<LocationPicker label={action==='move'?'Nowa lokalizacja *':'Lokalizacja po zwrocie'} required={action==='move'} value={locationId} onChange={setLocationId} emptyLabel={action==='return'?'Zachowaj obecną lokalizację':'Wybierz lokalizację'}/>}
    {action==='rfid'&&<Field label="Identyfikator RFID" hint="Wpisz lub użyj czytnika klawiaturowego. Puste pole odłącza obecny tag."><input maxLength={200} autoComplete="off" value={rfidTag} onChange={e=>setRfidTag(e.target.value)}/></Field>}
    <Field label={action==='note'?'Notatka *':'Powód / uwagi'}><textarea required={action==='note'} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></Field>
    {action==='return'&&<p className="help-note">Zwrot usuwa przypisanie do {asset.owner??'użytkownika'} i zapisuje stan po zwrocie w historii.</p>}
    {action==='status'&&asset.owner&&!['ASSIGNED','REPAIR'].includes(status)&&<div className="notice notice-info">Zmiana na ten status usunie przypisanie do {asset.owner}.</div>}
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy}>{busy?'Zapisywanie…':'Zapisz'}</Button></div>
  </form></Modal>;
}
