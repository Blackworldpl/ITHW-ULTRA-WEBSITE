'use client';
import {useEffect,useMemo,useRef,useState,type FormEvent,type PointerEvent as ReactPointerEvent} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {Check,ChevronDown,ChevronRight,FolderOpen,GripVertical,MapPin,Plus,QrCode,Search,Trash2,X} from 'lucide-react';
import type {Location} from '@/shared/types';
import {locationKinds,locationLabels,locationSubtree} from '@/shared/locations';
import {useApp} from './context';
import {api,Button,EmptyState,ErrorMessage,Field,Modal,QRLabel} from './ui';
import {LocationPicker} from './pickers';
import {hasPermission} from '@/shared/permissions';
import {LocationContents} from './locations-screen';
import {DeleteEntryModal} from './admin';
import {ContextMenu} from './context-menu';

export function LocationTree({onSaved,initialSelectedId='',startCreating=false}:{onSaved:(message:string)=>void;initialSelectedId?:string;startCreating?:boolean}){
  const {user,lookups,refreshLookups}=useApp(),locations=lookups?.locations??[];
  const byId=useMemo(()=>new Map(locations.map(l=>[l.id,l])),[locations]),childrenByParent=useMemo(()=>{const m=new Map<string|null,Location[]>();for(const l of locations){const siblings=m.get(l.parentId);if(siblings)siblings.push(l);else m.set(l.parentId,[l]);}return m;},[locations]);
  const editable=user.role==='ADMIN'&&hasPermission(user,'location.edit'),creatable=user.role==='ADMIN'&&hasPermission(user,'location.create');
  const [selectedId,setSelectedId]=useState(initialSelectedId),[search,setSearch]=useState(''),[closed,setClosed]=useState<Set<string>>(new Set());
  useEffect(()=>{if(initialSelectedId)setSelectedId(initialSelectedId);},[initialSelectedId]);
  const [dragged,setDragged]=useState<string|null>(null),[over,setOver]=useState<string|null>(null),[creating,setCreating]=useState<string|null>(startCreating&&creatable?'':null),[createBusy,setCreateBusy]=useState(false);
  useEffect(()=>{if(startCreating&&creatable)setCreating('');},[startCreating,creatable]);
  const [point,setPoint]=useState({x:0,y:0}),[moving,setMoving]=useState(false),[rejected,setRejected]=useState(''),[justDropped,setJustDropped]=useState<string|null>(null),[editRequested,setEditRequested]=useState<string|null>(null);
  useEffect(()=>{if(!justDropped)return;const t=setTimeout(()=>setJustDropped(null),650);return()=>clearTimeout(t);},[justDropped]);
  const held=useRef<{id:string;descendants:Set<string>;startX:number;startY:number;x:number;y:number;active:boolean}|null>(null),scrollArea=useRef<HTMLDivElement>(null),moveLock=useRef(false);
  const [deleting,setDeleting]=useState<Location|null>(null),[qr,setQr]=useState<Location|null>(null),[moveParent,setMoveParent]=useState<string|null>(null),[error,setError]=useState('');
  const selected=byId.get(selectedId)??locations.find(location=>location.path.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')))??locations[0];
  useEffect(()=>{if(editRequested!==selected?.id)return;const editor=document.querySelector<HTMLDetailsElement>('.location-edit-section');if(editor){editor.open=true;editor.querySelector<HTMLElement>('input')?.focus();setEditRequested(null);}},[editRequested,selected?.id]);
  const visible=useMemo(()=>{const query=search.toLocaleLowerCase('pl'),matched=new Set(locations.filter(location=>location.path.toLocaleLowerCase('pl').includes(query)).map(location=>location.id));for(const id of Array.from(matched)){let node=byId.get(id);const seen=new Set<string>();while(node?.parentId&&!seen.has(node.parentId)){seen.add(node.parentId);matched.add(node.parentId);node=byId.get(node.parentId);}}return matched;},[locations,search,byId]);
  function toggle(id:string){setClosed(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;});}
  function add(parentId:string){setCreating(parentId);setClosed(previous=>{const next=new Set(previous);next.delete(parentId);return next;});}
  function targetAt(x:number,y:number){return document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-location-drop]')?.dataset.locationDrop??null;}
  function descendants(sourceId:string){return held.current?.id===sourceId?held.current.descendants:locationSubtree(locations,sourceId);}
  function validTarget(sourceId:string,targetId:string|null){const source=byId.get(sourceId);if(!source||targetId===null)return false;if(targetId==='root')return source.parentId!==null;return byId.has(targetId)&&source.parentId!==targetId&&!descendants(sourceId).has(targetId);}
  function hover(sourceId:string,target:string|null){setOver(validTarget(sourceId,target)?target:null);const source=byId.get(sourceId);setRejected(target===null?'Przesuń na folder lub poziom główny':target===sourceId||target!=='root'&&source&&descendants(sourceId).has(target)?'Nie można przenieść do siebie ani do podfolderu':source?.parentId===(target==='root'?null:target)?'Folder już znajduje się w tym miejscu':'Niedozwolone miejsce upuszczenia');}
  function cancelDrag(){held.current=null;setDragged(null);setOver(null);}
  function grab(event:ReactPointerEvent<HTMLButtonElement>,id:string){if(!editable||event.button!==0||createBusy||moving)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);held.current={id,descendants:locationSubtree(locations,id),startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false};}
  function drag(event:ReactPointerEvent<HTMLButtonElement>){const current=held.current;if(!current)return;current.x=event.clientX;current.y=event.clientY;if(!current.active&&Math.hypot(current.x-current.startX,current.y-current.startY)<5)return;current.active=true;setDragged(current.id);setPoint({x:current.x,y:current.y});const target=targetAt(current.x,current.y);hover(current.id,target);}
  async function release(event:ReactPointerEvent<HTMLButtonElement>){const current=held.current,target=targetAt(event.clientX,event.clientY);cancelDrag();if(!current?.active||!validTarget(current.id,target)||moveLock.current)return;const source=locations.find(l=>l.id===current.id)!;moveLock.current=true;setMoving(true);setError('');try{const moved=await api<Location>(`/api/admin/locations/${source.id}`,{method:'PATCH',body:JSON.stringify({name:source.name,parentId:target==='root'?null:target,version:source.version})},user.csrfToken);setSelectedId(source.id);setJustDropped(source.id);setMoveParent(null);setClosed(previous=>{const next=new Set(previous);if(target&&target!=='root')next.delete(target);return next;});onSaved(`Przeniesiono ${moved.path}.`);}catch(e){setError((e as Error).message);refreshLookups();}finally{moveLock.current=false;setMoving(false);}}
  useEffect(()=>{if(!dragged||!over||over==='root')return;const timer=setTimeout(()=>setClosed(previous=>{const next=new Set(previous);next.delete(over);return next;}),550);return()=>clearTimeout(timer);},[dragged,over]);
  useEffect(()=>{if(!dragged)return;const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancelDrag();}};document.addEventListener('keydown',escape);let frame=0;function scroll(){const current=held.current,area=scrollArea.current;if(current?.active&&area){const box=area.getBoundingClientRect();if(current.y>box.top&&current.y<box.top+48)area.scrollTop-=8;else if(current.y<box.bottom&&current.y>box.bottom-48)area.scrollTop+=8;const target=targetAt(current.x,current.y);hover(current.id,target);}frame=requestAnimationFrame(scroll);}frame=requestAnimationFrame(scroll);return()=>{document.removeEventListener('keydown',escape);cancelAnimationFrame(frame);};},[dragged,locations]);
  function branch(parentId:string|null):React.ReactNode{
    const adding=creating===(parentId??'');
    return <ul role={parentId?'group':'tree'} aria-label={parentId?undefined:'Drzewo lokalizacji'} className="location-branches">
      {(childrenByParent.get(parentId)??[]).filter(location=>visible.has(location.id)).map(location=>{
        const hasChildren=childrenByParent.has(location.id)||creating===location.id;
        const open=!!search||!closed.has(location.id);
        return <li role="treeitem" key={location.id} aria-expanded={hasChildren?open:undefined} aria-selected={selected?.id===location.id}>
          <div data-location-drop={location.id} onContextMenu={e=>{e.preventDefault();e.currentTarget.querySelector<HTMLButtonElement>('[data-row-menu]')?.click();}} className={`location-node ${selected?.id===location.id?'selected':''} ${over===location.id?'drop-target':''} ${dragged===location.id?'is-dragging':''} ${justDropped===location.id?'just-dropped':''} ${dragged&&validTarget(dragged,location.id)?'can-drop':''}`}>
            {editable&&<button type="button" className="tree-grab" disabled={createBusy||moving} aria-label={`Przeciągnij folder ${location.name}`} title="Chwyć i przeciągnij. Alternatywnie zmień folder nadrzędny w panelu." onPointerDown={e=>grab(e,location.id)} onPointerMove={drag} onPointerUp={release} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}><GripVertical size={15}/></button>}
            {hasChildren?<button type="button" className="icon-button" aria-label={`${open?'Zwiń':'Rozwiń'} ${location.name}`} onClick={()=>toggle(location.id)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>:<span className="tree-spacer"/>}
            <button type="button" className="location-node-title" onClick={()=>{setSelectedId(location.id);setMoveParent(null);setError('');}}><FolderOpen size={17}/><span>{location.name}<small>{locationLabels[location.kind]}</small></span></button>
            {hasPermission(user,'asset.view')&&<span className="tree-device-count" title="Urządzenia w całej gałęzi">{location.assetCount??0}</span>}
            <ContextMenu label={'Akcje lokalizacji '+location.name} items={[{label:'Pokaż lokalizację',onClick:()=>setSelectedId(location.id)},...(hasPermission(user,'asset.view')?[{label:'Urządzenia w gałęzi',href:'/assets?locationId='+location.id+'&includeChildren=true'}]:[]),...(creatable?[{label:'Dodaj podfolder',onClick:()=>add(location.id)}]:[]),...(editable?[{label:'Edytuj / przenieś folder',onClick:()=>{setSelectedId(location.id);setEditRequested(location.id);}}]:[]),...(hasPermission(user,'label.print')?[{label:'Etykieta QR',onClick:()=>setQr(location)}]:[]),...(user.role==='ADMIN'&&hasPermission(user,'location.delete')?[{label:'Usuń pusty folder',danger:true,onClick:()=>setDeleting(location)}]:[])]}/>
            {creatable&&<button type="button" className="icon-button" disabled={createBusy} aria-label={`Dodaj folder pod ${location.name}`} onClick={()=>add(location.id)}><Plus size={14}/></button>}
          </div>
          {hasChildren&&open&&branch(location.id)}
        </li>;
      })}
      {adding&&<li className="location-inline-node"><InlineFolder key={parentId??'root'} parentId={parentId} onBusy={setCreateBusy} onClose={()=>setCreating(null)} onSaved={location=>{setCreating(null);setSelectedId(location.id);if(!parentId)setSearch('');onSaved(`Dodano ${location.path}.`);}}/></li>}
    </ul>;
  }
  return <>
    <div className="toolbar"><div className="toolbar-search"><Search size={16}/><input aria-label="Szukaj w drzewie lokalizacji" placeholder="Wpisz nazwę folderu lub strefy…" value={search} onChange={event=>setSearch(event.target.value)}/></div>{creatable&&<Button disabled={createBusy} onClick={()=>add('')}><Plus size={16}/>Dodaj folder główny</Button>}<Button variant="secondary" onClick={()=>setClosed(new Set())}>Rozwiń wszystkie</Button><Button variant="secondary" onClick={()=>setClosed(new Set(locations.map(location=>location.id)))}>Zwiń</Button></div>
    <ErrorMessage message={error}/>
    <div className="location-workbench">
      <section className="panel location-tree-panel"><div className="panel-heading"><div><h2><MapPin size={17}/> Lokalizacje</h2><p>{editable?'Chwyć uchwyt i puść folder na nowym rodzicu. Zmiana zapisuje się automatycznie. Escape anuluje przeciąganie.':'Wybierz folder, aby zobaczyć jego zawartość i urządzenia.'}</p></div></div><div className="panel-body tree-scroll-area" ref={scrollArea}>{editable&&<div data-location-drop="root" className={`tree-root-drop ${over==='root'?'drop-target':''}`}>Poziom główny · upuść tutaj, aby przenieść poza folder</div>}{locations.length||creating!==null?branch(null):<EmptyState title="Dodaj pierwszy folder" description="Zbuduj strukturę magazynu tak, jak wygląda w Twojej firmie."/>}</div><div className="tree-move-status" role="status">{moving?'Zapisywanie przeniesienia…':dragged?over?`Upuść w: ${over==='root'?'poziom główny':locations.find(l=>l.id===over)?.name}`:rejected:editable?'Przenoszenie z klawiatury: wybierz „Edytuj / przenieś folder” w menu.':'Struktura lokalizacji i wyposażenie.'}</div></section>
      {selected&&<section className="panel location-inspector"><div className="panel-heading"><div><h2>{selected.name}</h2><p>{selected.path}</p></div></div><div className="panel-body"><LocationContents key={`${selected.id}:${selected.version}`} location={selected}/>{editable&&<details className="location-edit-section"><summary>Edytuj nazwę / przenieś folder</summary><LocationEditor key={`${selected.id}:${selected.version}:${moveParent}`} location={selected} initialParent={moveParent??selected.parentId??''} onSaved={location=>{setMoveParent(null);onSaved(`Zapisano ${location.path}.`);}}/></details>}<div className="row-actions">{hasPermission(user,'label.print')&&<Button variant="secondary" onClick={()=>setQr(selected)}><QrCode size={15}/>QR</Button>}{creatable&&<Button variant="secondary" onClick={()=>add(selected.id)}><Plus size={15}/>Podfolder</Button>}{user.role==='ADMIN'&&hasPermission(user,'location.delete')&&<Button variant="ghost" onClick={()=>setDeleting(selected)}><Trash2 size={15}/>Usuń</Button>}</div></div></section>}
    </div>
    {deleting&&<DeleteEntryModal name={deleting.path} endpoint={`/api/admin/locations/${deleting.id}`} description="Usunąć ten folder? Foldery z dziećmi, sprzętem, produktami lub pracownikami pozostaną chronione." onClose={()=>setDeleting(null)} onSaved={()=>{setDeleting(null);setSelectedId('');onSaved('Usunięto lokalizację.');}}/>}
    {qr&&<Modal title={`QR: ${qr.name}`} onClose={()=>setQr(null)}><QRLabel type="location" id={qr.id} name={qr.path}/></Modal>}
    {dragged&&createPortal(<div className={`location-drag-preview ${over?'valid':'invalid'}`} aria-hidden="true" style={{left:point.x+12,top:point.y+12}}><FolderOpen size={18}/><div><strong>{locations.find(l=>l.id===dragged)?.name}</strong><small>{over?'Puść, aby przenieść':rejected}</small></div></div>,document.body)}
  </>;
}

function InlineFolder({parentId,onClose,onSaved,onBusy}:{parentId:string|null;onClose:()=>void;onSaved:(location:Location)=>void;onBusy:(busy:boolean)=>void}){
  const {user}=useApp();const [name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;setBusy(true);onBusy(true);setError('');
    try{onSaved(await api<Location>('/api/admin/locations',{method:'POST',body:JSON.stringify({name,parentId})},user.csrfToken));}
    catch(error){setError((error as Error).message);}finally{setBusy(false);onBusy(false);}
  }
  return <form className="location-inline-form" onSubmit={submit}>
    <div><FolderOpen size={17}/><input aria-label="Nazwa nowego folderu" autoFocus required maxLength={160} disabled={busy} placeholder="Nazwa nowego folderu…" value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onClose();}}}/><button type="submit" className="icon-button inline-confirm" disabled={busy||!name.trim()} aria-label="Zapisz nowy folder"><Check size={16}/></button><button type="button" className="icon-button" disabled={busy} aria-label="Anuluj dodawanie folderu" onClick={onClose}><X size={16}/></button></div>
    <ErrorMessage message={error}/>
  </form>;
}
function LocationEditor({location,initialParent,onSaved}:{location:Location;initialParent:string;onSaved:(location:Location)=>void}){
  const {user,lookups}=useApp(),locations=lookups?.locations??[];
  const [name,setName]=useState(location.name),[kind,setKind]=useState(location.kind),[parentId,setParentId]=useState(initialParent),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const excluded=locationSubtree(locations,location.id);
  async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{onSaved(await api<Location>(`/api/admin/locations/${location.id}`,{method:'PATCH',body:JSON.stringify({name,kind,parentId:parentId||null,version:location.version})},user.csrfToken));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <form onSubmit={submit}><ErrorMessage message={error}/><fieldset disabled={busy} className="plain-fieldset"><Field label="Nazwa *"><input required maxLength={160} value={name} onChange={event=>setName(event.target.value)}/></Field><LocationPicker label="Folder nadrzędny" value={parentId} onChange={setParentId} excluded={excluded} emptyLabel="Poziom główny"/><details className="location-type-settings"><summary>Opis typu lokalizacji</summary><Field label="Typ (bez wpływu na strukturę)"><select value={kind} onChange={event=>setKind(event.target.value)}>{locationKinds.map(key=><option key={key} value={key}>{locationLabels[key]}</option>)}</select></Field></details>{parentId!==(location.parentId??'')&&<div className="notice notice-info">Przeniesiesz cały folder razem z jego zawartością. Sprzęt i produkty zachowają przypisanie.</div>}<Button disabled={busy}>{busy?'Zapisywanie…':'Zapisz zmiany'}</Button></fieldset></form>;
}
