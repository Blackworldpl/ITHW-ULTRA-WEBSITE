'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Download, MapPin, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { History, Role, User } from '@/shared/types';
import { roles, roleLabels } from '@/shared/types';
import { useApp } from './context';
import { api, Button, EmptyState, ErrorMessage, Field, formatDate, Loading, Modal, PageHeader, SuccessMessage, useResource } from './ui';
import {InventoryDictionaryEditor} from './inventory-dictionary-editor';
import {DictionaryEditor} from './dictionary-editor';
import {LocationTree} from './location-tree';
import {useSearchParams} from 'next/navigation';
import {InvitationModal} from './access-settings';
import {TemporaryPassword} from './temporary-password';
import Link from 'next/link';

type AdminTab = 'users' | 'locations' | 'categories' | 'suppliers' | 'inventory-categories' | 'inventory-units' | 'audit';
const tabs: [AdminTab, string][] = [['users','Użytkownicy'],['locations','Lokalizacje'],['categories','Kategorie sprzętu'],['suppliers','Kontrahenci'],['inventory-categories','Kategorie magazynowe'],['inventory-units','Jednostki'],['audit','Dziennik operacji']];
const roleDescriptions: Record<Role,string> = {
  VIEWER:'Przeglądanie sprzętu, magazynu, faktur i historii.',
  IT_USER:'Przeglądanie, pobrania i zwroty produktów oraz wydawanie i przekazywanie sprzętu.',
  IT_ADVANCED:'Dodatkowo edycja sprzętu, dostawy, RFID i etykiety QR.',
  ADMIN:'Pełny dostęp, zarządzanie kontami i słownikami, dziennik operacji i eksport.',
};

export function AdminScreen({initialTab}:{initialTab?:AdminTab}) {
  const { user,lookups,lookupError,refreshLookups } = useApp();
  const params=useSearchParams();
  const paramTab=params.get('tab') as AdminTab;
  const [tab,setTab] = useState<AdminTab>(initialTab??(tabs.some(([t])=>t===paramTab)?paramTab:'users'));
  const [success,setSuccess] = useState('');
  if (user.role !== 'ADMIN') return <><PageHeader eyebrow="ADMINISTRACJA" title="Dostęp administratora"/><ErrorMessage message="Twoja rola nie pozwala zarządzać kontami i ustawieniami systemu."/></>;
  function saved(message: string) { setSuccess(message); refreshLookups(); }
  return <>
    <PageHeader eyebrow="ADMINISTRACJA SYSTEMU" title="Dostęp i słowniki" description="Konta zespołu, struktura lokalizacji oraz rejestr operacji." actions={<a className="button button-secondary" href="/api/admin/inventory-export" download><Download size={16}/>Eksport historii magazynu</a>}/>
    <SuccessMessage message={success}/>
    <ErrorMessage message={lookupError}/>
    {lookups && (!lookups.locations.length || !lookups.suppliers.length) && <div className="notice notice-info" style={{alignItems:'center',flexWrap:'wrap'}}>
      <MapPin size={17}/><span>Pierwsza konfiguracja: dodaj lokalizację główną i dostawcę, aby przygotować ewidencję oraz przyjęcia dostaw.</span>
      {!lookups.locations.length && <Button variant="secondary" onClick={()=>setTab('locations')}>Dodaj lokalizację</Button>}
      {!lookups.suppliers.length && <Button variant="secondary" onClick={()=>setTab('suppliers')}>Dodaj dostawcę</Button>}
    </div>}
    <div className="admin-layout">
      <nav className="admin-nav" aria-label="Ustawienia administracyjne">{tabs.map(([key,label])=><button key={key} type="button" className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>{setTab(key);setSuccess('');}}>{label}</button>)}</nav>
      <div style={{minWidth:0}}>
        {tab==='users' && <UsersPanel onSaved={saved}/>}
        {tab==='locations' && <LocationTree onSaved={saved}/>}
        {tab==='categories' && <DictionaryEditor key="categories" kind="categories" onSaved={saved}/>}
        {tab==='suppliers' && <DictionaryEditor key="suppliers" kind="suppliers" onSaved={saved}/>}
        {tab==='inventory-categories' && <InventoryDictionaryEditor key="inventory-categories" kind="category" onSaved={saved}/>}
        {tab==='inventory-units' && <InventoryDictionaryEditor key="inventory-units" kind="unit" onSaved={saved}/>}
        {tab==='audit' && <AuditPanel/>}
      </div>
    </div>
  </>;
}

function UsersPanel({onSaved}:{onSaved:(message:string)=>void}) {
  const {user} = useApp();
  const resource = useResource<User[]>('/api/admin/users');
  const [query,setQuery] = useState(new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('q')??'');
  const [creating,setCreating] = useState(false);
  const [editing,setEditing] = useState<User|null>(null);
  const [deleting,setDeleting] = useState<User|null>(null);
  const params=useSearchParams();
  const [inviting,setInviting]=useState(params.get('invite')==='1');
  useEffect(()=>{setQuery(params.get('q')??'');if(params.get('invite')==='1')setInviting(true);},[params]);
  const filtered = resource.data?.filter(account=>`${account.name} ${account.email} ${roleLabels[account.role]}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));
  const changed = (message:string) => { resource.reload(); onSaved(message); };
  return <>
    <div className="toolbar"><div className="toolbar-search"><Search size={17}/><input aria-label="Szukaj użytkowników" placeholder="Imię, e-mail lub rola…" value={query} onChange={event=>setQuery(event.target.value)}/></div><Button variant="secondary" onClick={()=>setInviting(true)}>Zaproś użytkownika</Button><Button onClick={()=>setCreating(true)}><Plus size={16}/>Dodaj konto</Button></div>
    <ErrorMessage message={resource.error}/>
    {resource.error && <Button variant="secondary" onClick={resource.reload}><RefreshCw size={15}/>Ponów pobranie</Button>}
    <section className="panel">
      <div className="panel-heading"><div><h2><Users size={16}/>Konta zespołu <span className="count-pill">{resource.data?.length??'—'}</span></h2><p>Zmiana roli lub aktywności kończy dotychczasowe sesje użytkownika.</p></div></div>
      {resource.loading&&!resource.data ? <Loading/> : filtered?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Użytkownik</th><th>Rola</th><th>Status konta</th><th>Ostatnie logowanie</th><th>Akcje</th></tr></thead><tbody>{filtered.map(account=><tr key={account.id}>
        <td><strong className="table-title">{account.name}{account.id===user.id?' · Ty':''}</strong><small>{account.email}</small></td>
        <td>{account.customRoleId?'Profil własny · ':''}{roleLabels[account.role]}</td>
        <td><span className={`badge ${account.active===false?'':'status-available'}`}>{account.active===false?'Nieaktywne':'Aktywne'}</span>{account.active!==false&&account.mustChangePassword&&<small>Oczekuje na własne hasło</small>}</td>
        <td>{account.lastLoginAt?formatDate(account.lastLoginAt,true):'Nie logował się'}</td>
        <td><div className="row-actions"><Button variant="ghost" aria-label={`Edytuj konto ${account.name}`} onClick={()=>setEditing(account)}><Pencil size={14}/>Edytuj</Button><Button variant="ghost" aria-label={`Usuń konto ${account.name}`} disabled={account.id===user.id} title={account.id===user.id?'Nie możesz usunąć własnego konta.':undefined} onClick={()=>setDeleting(account)}><Trash2 size={14}/>Usuń</Button></div></td>
      </tr>)}</tbody></table></div> : !resource.error && <EmptyState title={query?'Brak pasujących kont':'Brak kont użytkowników'} description={query?'Zmień wyszukiwanie, aby zobaczyć inne konta.':'Dodaj indywidualne konta członków zespołu.'}/>}
      <div className="panel-note"><ShieldCheck size={13}/>Własną rolę i aktywność może zmienić inny administrator. Historia operacji pozostaje w systemie.</div>
    </section>
    {creating && <CreateUserModal onClose={()=>setCreating(false)} onSaved={account=>{setCreating(false);changed(`Utworzono konto ${account.name} (${roleLabels[account.role]}).`);}}/>}
    {inviting&&<InvitationModal onClose={()=>setInviting(false)} onSaved={()=>changed('Przygotowano link zaproszenia.')}/>}
    {editing && <EditUserModal account={editing} onClose={()=>setEditing(null)} onSaved={account=>{setEditing(null);changed(`Zapisano konto ${account.name}. ${account.active===false?'Konto zostało dezaktywowane.':'Konto jest aktywne.'}`);}}/>}
    {deleting && <DeleteEntryModal name={deleting.name} endpoint={`/api/admin/users/${deleting.id}`} description="Usunąć to konto? Konto z historią operacji trzeba dezaktywować w formularzu edycji. Usunięcia nie można cofnąć." onClose={()=>setDeleting(null)} onSaved={()=>{setDeleting(null);changed(`Usunięto konto ${deleting.name}.`);}}/>}
  </>;
}

function CreateUserModal({onClose,onSaved}:{onClose:()=>void;onSaved:(user:User)=>void}) {
  const {user} = useApp();
  const [form,setForm] = useState({name:'',email:'',password:'',role:'IT_USER' as Role,mustChangePassword:true});
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [created,setCreated]=useState<User|null>(null);
  function close(){if(busy)return;if(created)onSaved(created);else onClose();}
  async function submit(event:FormEvent) {
    event.preventDefault(); if(busy||created)return; setBusy(true); setError('');
    try { const account = await api<User>('/api/admin/users',{method:'POST',body:JSON.stringify(form)},user.csrfToken); setCreated(account); }
    catch(error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={created?"Konto gotowe — przekaż dostęp":"Dodaj konto użytkownika"} onClose={close}>{created?<><div className="notice notice-info">Utworzono konto {created.name}.</div><dl className="settings-facts"><dt>Adres do logowania</dt><dd>{typeof window!=='undefined'?window.location.origin+'/login':'/login'}</dd><dt>E-mail</dt><dd>{created.email}</dd><dt>Rola</dt><dd>{roleLabels[created.role]}</dd><dt>Pierwsze logowanie</dt><dd>{created.mustChangePassword?'Użytkownik ustawi własne hasło.':'Bez wymuszonej zmiany hasła.'}</dd></dl><TemporaryPassword value={form.password} onChange={()=>{}} readOnly/><p className="help-note">Przekaż użytkownikowi e-mail, adres logowania i hasło tymczasowe. Hasło jest dostępne w tym oknie do jego zamknięcia. Nie wysyłamy wiadomości automatycznie.</p><div className="form-actions"><Button onClick={close}>Gotowe</Button></div></>:<form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}>
    <p className="required-note">Każdy członek zespołu używa indywidualnego konta.</p><ErrorMessage message={error}/>
    <div className="form-grid">
      <Field label="Imię i nazwisko *"><input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={event=>setForm(previous=>({...previous,name:event.target.value}))}/></Field>
      <Field label="E-mail *"><input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={event=>setForm(previous=>({...previous,email:event.target.value}))}/></Field>
      <TemporaryPassword value={form.password} onChange={password=>setForm(previous=>({...previous,password}))}/>
      <Field label="Rola *"><select value={form.role} onChange={event=>setForm(previous=>({...previous,role:event.target.value as Role}))}>{roles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></Field>
    </div>
    <p className="help-note">{roleDescriptions[form.role]}</p>
    <label className="checkbox-inline"><input type="checkbox" checked={form.mustChangePassword} onChange={event=>setForm(previous=>({...previous,mustChangePassword:event.target.checked}))}/>Wymagaj zmiany hasła przy pierwszym logowaniu</label><p className="help-note">Po zalogowaniu hasłem tymczasowym użytkownik ustawi własne hasło przed wejściem do systemu. Możesz też wybrać „Zaproś użytkownika” na liście kont, aby od razu ustawił hasło przez link aktywacyjny.</p>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy}>{busy?'Tworzenie konta…':'Utwórz konto'}</Button></div>
  </fieldset></form>}</Modal>;
}

function EditUserModal({account,onClose,onSaved}:{account:User;onClose:()=>void;onSaved:(user:User)=>void}) {
  const {user} = useApp();
  const [name,setName] = useState(account.name);
  const [email,setEmail] = useState(account.email);
  const [password,setPassword] = useState('');
  const [role,setRole] = useState<Role>(account.role);
  const [mustChangePassword,setMustChangePassword]=useState(!!account.mustChangePassword);
  const [active,setActive] = useState(account.active!==false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const self = account.id===user.id;
  const changed = name!==account.name || email!==account.email || !!password || role!==account.role || active!==(account.active!==false) || mustChangePassword!==!!account.mustChangePassword;
  async function submit(event:FormEvent) {
    event.preventDefault(); if(busy||!changed)return; setBusy(true); setError('');
    try {
      const saved = await api<User>(`/api/admin/users/${account.id}`,{method:'PATCH',body:JSON.stringify({name,email,role,active,...(password?{password,mustChangePassword}:mustChangePassword!==!!account.mustChangePassword?{mustChangePassword}:{})})},user.csrfToken);
      if (self && (email.trim().toLowerCase()!==account.email || password)) window.location.assign('/login');
      else onSaved(saved);
    }
    catch(error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Edytuj konto: ${account.name}`} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}>
    <ErrorMessage message={error}/>
    <div className="form-grid">
      <Field label="Imię i nazwisko *"><input required minLength={2} maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></Field>
      <Field label="E-mail *"><input required type="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></Field>
      <div className="field-span">{self?<Link className="text-link" href="/change-password">Zmień własne hasło →</Link>:<><TemporaryPassword value={password} required={false} onChange={value=>{setPassword(value);if(value&&!password)setMustChangePassword(true);}}/><p className="help-note">Pozostaw puste, aby zachować hasło. Wpisane hasło zastąpi obecne i zakończy wszystkie sesje konta.</p></>}</div>
      <Field label="Rola"><select disabled={self} value={role} onChange={event=>setRole(event.target.value as Role)}>{roles.map(value=><option key={value} value={value}>{roleLabels[value]}</option>)}</select></Field>
    </div>
    <p className="help-note">{roleDescriptions[role]}</p>
    {!self&&<label className="checkbox-inline"><input type="checkbox" checked={mustChangePassword} disabled={!!account.mustChangePassword&&!password} onChange={event=>setMustChangePassword(event.target.checked)}/>Wymagaj zmiany hasła przy następnym logowaniu</label>}
    <label className="checkbox-field"><input type="checkbox" disabled={self} checked={active} onChange={event=>setActive(event.target.checked)}/>Konto aktywne</label>
    {self && <p className="help-note">Własną rolę i aktywność musi zmienić inny administrator.</p>}
    {!active && <div className="notice notice-info" style={{marginTop:14}}>Po zapisie użytkownik straci dostęp do aplikacji. Jego dotychczasowe operacje i historia zostaną zachowane.</div>}
    <p className="help-note">Zmiana e-maila, hasła, roli lub aktywności kończy sesje tego konta. Użytkownik musi zalogować się ponownie.</p>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy||!changed}>{busy?'Zapisywanie…':'Zapisz zmiany'}</Button></div>
  </fieldset></form></Modal>;
}

export function DeleteEntryModal({name,endpoint,description,onClose,onSaved}:{name:string;endpoint:string;description:string;onClose:()=>void;onSaved:()=>void}) {
  const {user} = useApp();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function submit(event:FormEvent) {
    event.preventDefault(); if(busy)return; setBusy(true); setError('');
    try { await api(endpoint,{method:'DELETE'},user.csrfToken); onSaved(); }
    catch(error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Usuń: ${name}`} onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <p className="help-note">{description}</p><ErrorMessage message={error}/>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button type="submit" variant="danger" disabled={busy}><Trash2 size={15}/>{busy?'Usuwanie…':'Usuń wpis'}</Button></div>
  </form></Modal>;
}

const actionLabels: Record<string,string> = {
  LOGIN:'Logowanie',LOGOUT:'Wylogowanie',CREATE_ADMIN:'Pierwszy administrator',CREATE_USER:'Utworzenie konta',UPDATE_USER:'Zmiana konta',
  CREATE_ASSET:'Dodanie sprzętu',UPDATE_ASSET:'Edycja sprzętu',RECEIVE_ASSET:'Przyjęcie sprzętu',CREATE_INVENTORY:'Dodanie produktu',
  WITHDRAWAL:'Pobranie',RETURN:'Zwrot',DELIVERY:'Przyjęcie produktu',CREATE_INVOICE:'Dodanie faktury',RECEIVE_DELIVERY:'Przyjęcie dostawy',
  CREATE_LOCATION:'Dodanie lokalizacji',CREATE_CATEGORY:'Dodanie kategorii',CREATE_SUPPLIER:'Dodanie dostawcy',
  UPDATE_LOCATION:'Zmiana lokalizacji',DELETE_LOCATION:'Usunięcie lokalizacji',UPDATE_CATEGORY:'Zmiana kategorii',DELETE_CATEGORY:'Usunięcie kategorii',UPDATE_SUPPLIER:'Zmiana dostawcy',DELETE_SUPPLIER:'Usunięcie dostawcy',DELETE_USER:'Usunięcie konta',
  ASSIGN_ASSET:'Wydanie urządzenia',TRANSFER_ASSET:'Przekazanie urządzenia',RETURN_ASSET:'Zwrot urządzenia',MOVE_ASSET:'Przeniesienie urządzenia',CHANGE_ASSET_STATUS:'Zmiana statusu',ASSIGN_RFID:'Zmiana RFID',ASSET_NOTE:'Notatka urządzenia',UPDATE_INVENTORY:'Edycja produktu',ADJUSTMENT:'Korekta stanu',OPENING_BALANCE:'Stan początkowy z importu',
  CREATE_EMPLOYEE:'Dodanie pracownika',UPDATE_EMPLOYEE:'Edycja pracownika',CREATE_EMPLOYEE_ACCOUNT:'Konto pracownika',UPLOAD_INVOICE_PDF:'Dołączenie PDF faktury',
};
function AuditPanel() {
  const resource = useResource<History[]>('/api/admin/audit');
  const [query,setQuery] = useState(new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('q')??'');
  const filtered = resource.data?.filter(event=>`${event.actorName} ${event.action} ${event.description} ${actionLabels[event.action]??''}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));
  return <>
    <div className="toolbar"><div className="toolbar-search"><Search size={17}/><input aria-label="Szukaj w dzienniku operacji" placeholder="Użytkownik, operacja, Asset ID lub opis…" value={query} onChange={event=>setQuery(event.target.value)}/></div><Button variant="secondary" disabled={resource.loading} onClick={resource.reload}><RefreshCw size={15}/>Odśwież</Button></div>
    <ErrorMessage message={resource.error}/>
    <section className="panel"><div className="panel-heading"><div><h2>Dziennik operacji <span className="count-pill">{filtered?.length??'—'}</span></h2><p>Ostatnie 500 zdarzeń. Daty w strefie Europe/Warsaw. Historia jest chroniona przed usuwaniem i edycją.</p></div></div>
      {resource.loading&&!resource.data ? <Loading/> : filtered?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Data i czas</th><th>Użytkownik</th><th>Operacja</th><th>Opis / dane zmiany</th></tr></thead><tbody>{filtered.map(event=><tr key={event.id}>
        <td className="mono">{formatDate(event.createdAt,true)}</td><td>{event.actorName}</td><td>{actionLabels[event.action]??event.action}</td>
        <td style={{whiteSpace:'normal',minWidth:260,maxWidth:550}}>{event.description}{(event.before!=null||event.after!=null)&&<details style={{marginTop:8}}><summary className="text-link" style={{cursor:'pointer'}}>Pokaż dane zmiany</summary><div style={{display:'grid',gap:10,marginTop:10}}>{event.before!=null&&<div><small>Przed zmianą</small><pre className="mono" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'5px 0',maxHeight:250,overflow:'auto'}}>{JSON.stringify(event.before,null,2)}</pre></div>}{event.after!=null&&<div><small>Po zmianie</small><pre className="mono" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'5px 0',maxHeight:250,overflow:'auto'}}>{JSON.stringify(event.after,null,2)}</pre></div>}</div></details>}</td>
      </tr>)}</tbody></table></div> : !resource.error && <EmptyState title={query?'Brak pasujących zdarzeń':'Brak zarejestrowanych operacji'} description={query?'Zmień wyszukiwanie. Widok przeszukuje ostatnie 500 zdarzeń.':'Nowe operacje pojawią się tutaj automatycznie po odświeżeniu.'}/>}
    </section>
  </>;
}
