'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Cpu,MapPin,Package,ReceiptText,Search,Users,Wrench,FileText,SlidersHorizontal,Command} from 'lucide-react';
import type {SearchResult} from '@/shared/types';
import {hasPermission,type Permission} from '@/shared/permissions';
import {useApp} from './context';
import {api,EmptyState,ErrorMessage,Loading,Modal} from './ui';
const icons={asset:Cpu,inventory:Package,invoice:ReceiptText,location:MapPin,employee:Users,incident:Wrench,config:SlidersHorizontal,document:FileText,user:Users};
const labels={asset:'Sprzęt',inventory:'Magazyn',invoice:'Faktury',location:'Lokalizacje',employee:'Pracownicy',incident:'Zgłoszenia',config:'Konfiguracje',document:'Dokumenty',user:'Użytkownicy'};
export const commands:{title:string;href:string;permission:Permission}[]=[
 {title:'Dodaj urządzenie',href:'/assets?create=1',permission:'asset.create'},
 {title:'Dodaj fakturę',href:'/invoices?create=1',permission:'invoice.edit'},
 {title:'Rozpocznij inwentaryzację',href:'/stocktakes?start=1',permission:'inventory.run'},
 {title:'Skanuj QR / RFID',href:'/scan',permission:'rfid.scan'},
 {title:'Dodaj lokalizację',href:'/locations?create=1',permission:'location.create'},
 {title:'Dodaj konfigurację',href:'/configs?create=1',permission:'config.edit'},
 {title:'Dodaj zgłoszenie',href:'/incidents?create=1',permission:'incident.edit'},
 {title:'Dodaj pracownika',href:'/employees?create=1',permission:'employee.edit'},
 {title:'Dodaj stanowisko / stół',href:'/workstations?create=1',permission:'employee.edit'},
 {title:'Zaproś użytkownika',href:'/users?invite=1',permission:'user.create'},
];
export function GlobalSearch(){
 const {user}=useApp(),router=useRouter();const [open,setOpen]=useState(false),[q,setQ]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(0),[revision,setRevision]=useState(0),[recent,setRecent]=useState<string[]>([]);
 const storageKey='ith-search:'+user.id;
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(v))setRecent(v.filter(x=>typeof x==='string').slice(0,6));}catch{}},[storageKey]);
 const close=()=>{setOpen(false);setQ('');};
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setOpen(v=>!v);}};document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);},[]);
 useEffect(()=>{setSelected(0);setResults([]);setError('');if(!open||q.trim().length<2||q.startsWith('>')){setLoading(false);return;}const controller=new AbortController();setLoading(true);const timer=setTimeout(()=>api<SearchResult[]>('/api/search?q='+encodeURIComponent(q.trim()),{signal:controller.signal}).then(v=>{if(!controller.signal.aborted)setResults(v);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),200);return()=>{clearTimeout(timer);controller.abort();};},[open,q,revision]);
 const matches=commands.filter(c=>hasPermission(user,c.permission)&&(!q.trim()||q.startsWith('>')&&c.title.toLocaleLowerCase('pl').includes(q.slice(1).trim().toLocaleLowerCase('pl'))));
 const groupOrder=[...new Set(results.map(r=>r.type))];
 const entries=q.trim()&&!q.startsWith('>')?groupOrder.flatMap(type=>results.filter(r=>r.type===type).map(r=>({...r,group:labels[r.type],Icon:icons[r.type]}))):matches.map(c=>({id:c.href,title:c.title,subtitle:'Polecenie',href:c.href,group:'Szybkie akcje',Icon:Command}));
 useEffect(()=>{document.getElementById('search-option-'+selected)?.scrollIntoView({block:'nearest'});},[selected,entries.length]);
 function visit(href:string){if(q.trim().length>=2&&!q.startsWith('>')){const next=[q.trim(),...recent.filter(x=>x!==q.trim())].slice(0,6);setRecent(next);try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{}}router.push(href);close();}
 return <><button type="button" className="search-trigger" onClick={()=>setOpen(true)} aria-label="Szukaj w IT Hardware" aria-haspopup="dialog"><Search size={17}/><span>Szukaj w całym systemie</span><kbd>Ctrl K</kbd></button>{open&&<Modal title="Wyszukiwanie i polecenia" onClose={close}><div className="command-search"><Search size={20}/><input data-autofocus role="combobox" aria-label="Wyszukaj globalnie" aria-autocomplete="list" aria-expanded={!!entries.length} aria-controls="global-search-results" aria-activedescendant={entries.length?'search-option-'+selected:undefined} value={q} maxLength={200} placeholder="Asset ID, serial, MAC, IP, osoba… lub > polecenie" onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setSelected(v=>entries.length?(v+(e.key==='ArrowDown'?1:-1)+entries.length)%entries.length:0);}if(e.key==='Enter'&&entries[selected]){e.preventDefault();visit(entries[selected].href);}}}/></div><div className="command-content" aria-busy={loading}>{!q&&recent.length>0&&<div className="recent-searches"><small>OSTATNIE WYSZUKIWANIA</small>{recent.map(v=><button type="button" key={v} onClick={()=>setQ(v)}><Search size={13}/>{v}</button>)}</div>}{loading?<Loading compact/>:error?<ErrorMessage message={error} onRetry={()=>setRevision(v=>v+1)}/>:!entries.length?<EmptyState title={q.trim().length<2?'Wpisz co najmniej dwa znaki':'Brak pasujących wyników'} description="Możesz podać fragment nazwy, identyfikator lub > polecenie."/>:null}<div id="global-search-results" role="listbox" aria-label="Wyniki wyszukiwania">{entries.map((r,i)=><div key={r.id}>{(i===0||entries[i-1].group!==r.group)&&<div className="command-group" role="presentation">{r.group}</div>}<Link role="option" aria-selected={i===selected} id={'search-option-'+i} href={r.href} className={'command-result '+(i===selected?'selected':'')} onMouseMove={()=>setSelected(i)} onClick={e=>{e.preventDefault();visit(r.href);}}><r.Icon size={18}/><span><strong>{r.title}</strong><span>{r.subtitle}</span></span><ArrowUpRight size={16}/></Link></div>)}</div></div><div className="command-footer"><span><kbd>↑</kbd> <kbd>↓</kbd> wybierz <kbd>Enter</kbd> otwórz</span><span><kbd>Esc</kbd> zamknij</span></div></Modal>}</>;
}
