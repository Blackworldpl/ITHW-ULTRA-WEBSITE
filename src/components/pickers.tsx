'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronRight,Folder,Search,X} from 'lucide-react';
import type {Invoice,PageResult} from '@/shared/types';
import {useApp} from './context';
import {api} from './ui';

export type Choice = {id:string;label:string;detail?:string;search?:string;parentId?:string|null;unit?:string;quantityPrecision?:number;serialNumber?:string|null};
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pl').replace(/ł/g,'l').trim();

export function SearchSelect({label,value,options,onSelect,placeholder='Wpisz, aby wyszukać…',required=false,disabled=false,freeText,onTextChange,selectedLabel,search,tree=false,emptyLabel='Brak przypisania',onCreate,createLabel='Dodaj wpis'}:{
  label:string;value:string;options:Choice[];onSelect:(id:string,choice?:Choice)=>void;placeholder?:string;required?:boolean;disabled?:boolean;
  onCreate?:(text:string)=>void;createLabel?:string;
  freeText?:string;onTextChange?:(text:string)=>void;selectedLabel?:string;search?:(text:string,signal:AbortSignal)=>Promise<Choice[]>;tree?:boolean;emptyLabel?:string;
}){
  const id=useId(),root=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[query,setQuery]=useState<string|null>(null),[remote,setRemote]=useState<Choice[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [activeId,setActiveId]=useState<string|null>(null),[closed,setClosed]=useState<Set<string>>(new Set());
  const [picked,setPicked]=useState<Choice|null>(null);
  const [resolvedQuery,setResolvedQuery]=useState<string|null>(null);
  const createId=id+'-create';
  useEffect(()=>{if(value)setQuery(null);},[value]);
  const all=Array.from(new Map([...options,...remote,...(picked?.id===value?[picked]:[])].map(option=>[option.id,option])).values());
  const selected=all.find(option=>option.id===value);
  const display=query??(value?(selectedLabel??selected?.label??value):(freeText??''));
  const term=normalize(query??'');
  const matches=new Set(all.filter(option=>normalize(`${option.label} ${option.detail??''} ${option.search??''}`).includes(term)).map(option=>option.id));
  const directMatches=new Set(matches);
  const byId=new Map(all.map(option=>[option.id,option]));
  if(tree)for(const match of Array.from(matches)){
    let parent=byId.get(match)?.parentId;const seen=new Set<string>();
    while(parent&&!seen.has(parent)){seen.add(parent);matches.add(parent);parent=byId.get(parent)?.parentId;}
  }
  const rows:{option:Choice;depth:number;hasChildren:boolean}[]=[];
  if(tree){
    const visit=(parentId:string|null,depth:number,seen:Set<string>)=>{
      for(const option of all.filter(o=>(o.parentId??null)===parentId&&matches.has(o.id)&&!seen.has(o.id))){
        const children=all.some(o=>o.parentId===option.id);rows.push({option,depth,hasChildren:children});
        if(children&&(term||!closed.has(option.id)))visit(option.id,depth+1,new Set([...seen,option.id]));
      }
    };visit(null,0,new Set());
  }else rows.push(...all.filter(option=>matches.has(option.id)).slice(0,30).map(option=>({option,depth:0,hasChildren:false})));
  const canCreate=!!onCreate&&!disabled&&!loading&&!error&&(!search||!query?.trim()||resolvedQuery===query.trim())&&!all.some(o=>term&&normalize(o.label)===term);
  const keyboardIds=[...rows.map(row=>row.option.id),...(canCreate?[createId]:[])];
  useEffect(()=>{
    if(open&&activeId)document.getElementById(activeId===createId?createId:`${id}-${activeId}`)?.scrollIntoView({block:'nearest'});
  },[open,activeId,createId,id]);
  useEffect(()=>{
    input.current?.setCustomValidity(!onTextChange&&display.trim()&&!value?'Wybierz pasujący wpis z podpowiedzi lub wyczyść pole.':'');
  },[display,value,onTextChange]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[]);
  useEffect(()=>{
    setRemote([]);setError('');setResolvedQuery(null);
    if(!search||!open||!query?.trim()){setLoading(false);return;}
    const controller=new AbortController();let current=true;setLoading(true);
    const timer=setTimeout(()=>{search(query.trim(),controller.signal).then(result=>{if(current){setRemote(result);setResolvedQuery(query.trim());}}).catch(e=>{if(current&&!controller.signal.aborted)setError((e as Error).message);}).finally(()=>{if(current)setLoading(false);});},200);
    return()=>{current=false;clearTimeout(timer);controller.abort();};
  },[query,open,search]);
  function choose(option:Choice){if(input.current?.matches(':disabled'))return;setPicked(option);onSelect(option.id,option);setQuery(null);setOpen(false);setActiveId(option.id);}
  function create(){if(canCreate){setOpen(false);onCreate?.(query?.trim()??'');}}
  function clear(){onSelect('');onTextChange?.('');setQuery(null);setActiveId(null);input.current?.focus();setOpen(false);}
  function toggle(optionId:string){setClosed(previous=>{const next=new Set(previous);next.has(optionId)?next.delete(optionId):next.add(optionId);return next;});}
  return <div className="field search-select" ref={root}>
    <label htmlFor={id}>{label}</label>
    <div className={`picker-input ${open?'is-open':''}`}>
      <Search size={15}/><input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-haspopup={tree?'tree':'listbox'} aria-expanded={open} aria-controls={id+'-options'} aria-activedescendant={open&&activeId&&keyboardIds.includes(activeId)?activeId===createId?createId:`${id}-${activeId}`:undefined} autoComplete="off" value={display} placeholder={placeholder} required={required} disabled={disabled} maxLength={onTextChange?200:250}
        onFocus={()=>{setOpen(true);setActiveId(value||null);input.current?.select();}}
        onChange={event=>{setQuery(event.target.value);onSelect('');onTextChange?.(event.target.value);setActiveId(null);setOpen(true);}}
        onBlur={event=>{if(!root.current?.contains(event.relatedTarget))setOpen(false);}}
        onKeyDown={event=>{
          if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);return;}
          if(event.key==='ArrowDown'||event.key==='ArrowUp'){
            event.preventDefault();setOpen(true);const index=keyboardIds.indexOf(activeId??''),direction=event.key==='ArrowDown'?1:-1;
            const next=keyboardIds[index<0?(direction===1?0:keyboardIds.length-1):Math.max(0,Math.min(keyboardIds.length-1,index+direction))];setActiveId(next??null);return;
          }
          if(tree&&['ArrowRight','ArrowLeft'].includes(event.key)&&activeId){event.preventDefault();setClosed(previous=>{const next=new Set(previous);event.key==='ArrowLeft'?next.add(activeId):next.delete(activeId);return next;});return;}
          if(event.key==='Enter'&&open){event.preventDefault();if(search&&query?.trim()&&resolvedQuery!==query.trim()&&!error)return;if(activeId===createId){create();return;}const row=rows.find(row=>row.option.id===activeId)??(query!==null?(rows.find(row=>normalize(row.option.label)===term)??rows.find(row=>directMatches.has(row.option.id))):undefined);if(row)choose(row.option);else if(query?.trim()&&canCreate)create();else setOpen(false);}
        }}/>
      {(value||display)&&!disabled&&<button type="button" className="picker-clear" aria-label={`Wyczyść: ${label}`} onMouseDown={event=>event.preventDefault()} onClick={clear}><X size={14}/></button>}
      <button type="button" className="picker-clear" disabled={disabled} aria-label={`Pokaż podpowiedzi: ${label}`} onMouseDown={event=>event.preventDefault()} onClick={()=>{input.current?.focus();setOpen(!open);}}><ChevronDown size={15}/></button>
    </div>
    {open&&!disabled&&<div className="picker-popup">
      {tree&&<button type="button" className="picker-empty" onMouseDown={event=>event.preventDefault()} onClick={clear}>{emptyLabel}</button>}
      <div id={id+'-options'} role={tree?'tree':'listbox'} aria-label={`${label} — podpowiedzi`} className="picker-options">
        {rows.map(({option,depth,hasChildren})=><div key={option.id} id={`${id}-${option.id}`} role={tree?'treeitem':'option'} aria-level={tree?depth+1:undefined} aria-expanded={tree&&hasChildren?!!term||!closed.has(option.id):undefined} aria-selected={value===option.id} className={`picker-option ${activeId===option.id?'is-active':''} ${value===option.id?'is-selected':''}`} style={{paddingLeft:12+depth*18}} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActiveId(option.id)} onClick={()=>choose(option)}>
          {tree&&(hasChildren?<button type="button" className="picker-branch" aria-label={`${closed.has(option.id)?'Rozwiń':'Zwiń'} ${option.label}`} onClick={event=>{event.stopPropagation();toggle(option.id);}}>{closed.has(option.id)&&!term?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>:<span className="picker-branch-space"/>)}
          {tree&&<Folder size={15}/>}<span><strong>{option.label}</strong>{option.detail&&<small>{option.detail}</small>}</span>{value===option.id&&<Check size={15} className="picker-check"/>}
        </div>)}
        {canCreate&&<button type="button" id={createId} role="option" aria-selected={false} className={`picker-free ${activeId===createId?'is-active':''}`} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActiveId(createId)} onClick={create}>{createLabel}{query?.trim()?` „${query.trim()}”`:''}</button>}
      </div>
      {!rows.length&&!loading&&<p className="picker-note">{onTextChange?'Brak dopasowania. Możesz użyć wpisanej nazwy.':'Nie znaleziono pasującego wpisu.'}</p>}
      {loading&&<p className="picker-note">Szukanie…</p>}{error&&<p className="picker-note picker-error">{error}</p>}
      {onTextChange&&query?.trim()&&<button type="button" className="picker-free" onMouseDown={event=>event.preventDefault()} onClick={()=>{onSelect('');onTextChange(query.trim());setQuery(null);setOpen(false);}}>Użyj nazwy „{query.trim()}” bez profilu</button>}
      {value&&selected?.detail&&<p className="picker-note">{selected.detail}</p>}
    </div>}
  </div>;
}

export function LocationPicker({value,onChange,label='Lokalizacja',required=false,emptyLabel='Nie przypisano',excluded,disabled=false}:{value:string;onChange:(id:string)=>void;label?:string;required?:boolean;emptyLabel?:string;excluded?:Set<string>;disabled?:boolean}){
  const {lookups}=useApp();const locations=lookups?.locations??[];
  const selected=locations.find(location=>location.id===value);
  return <SearchSelect label={label} value={value} onSelect={onChange} required={required} disabled={disabled||!lookups} selectedLabel={selected?.path} options={locations.filter(location=>!excluded?.has(location.id)).map(location=>({id:location.id,label:location.name,detail:location.path===location.name?undefined:location.path,search:location.path,parentId:location.parentId}))} tree placeholder={lookups?emptyLabel:'Wczytywanie lokalizacji…'} emptyLabel={emptyLabel}/>;
}
export function EmployeePicker({employeeId,owner,onChange,label='Pracownik / właściciel',required=false,excludeId,disabled=false}:{employeeId:string;owner:string;onChange:(id:string,name:string)=>void;label?:string;required?:boolean;excludeId?:string;disabled?:boolean}){
  const {lookups}=useApp();const employees=(lookups?.employees??[]).filter(employee=>(employee.active||employee.id===employeeId)&&employee.id!==excludeId);
  return <SearchSelect label={label} value={employeeId} freeText={owner} selectedLabel={employees.find(employee=>employee.id===employeeId)?.name??owner} required={required} disabled={disabled||!lookups} options={employees.map(employee=>({id:employee.id,label:employee.name,detail:[employee.employeeNumber,employee.department,employee.email].filter(Boolean).join(' · ')}))} onSelect={id=>onChange(id,employees.find(employee=>employee.id===id)?.name??owner)} onTextChange={text=>onChange('',text)} placeholder={lookups?'Wpisz imię, nazwisko lub numer pracownika…':'Wczytywanie pracowników…'}/>;
}
async function searchInvoices(text:string,signal:AbortSignal){const result=await api<PageResult<Invoice>>(`/api/invoices?q=${encodeURIComponent(text)}&pageSize=30`,{signal});return result.items.map(invoice=>({id:invoice.id,label:invoice.number,detail:invoice.supplierName}));}
export function InvoicePicker({value,onChange,label='Faktura',number,emptyLabel='Wpisz numer faktury…'}:{value:string;onChange:(id:string)=>void;label?:string;number?:string|null;emptyLabel?:string}){
  const {lookups}=useApp();return <SearchSelect label={label} value={value} onSelect={onChange} selectedLabel={number??undefined} options={(lookups?.invoices??[]).map(invoice=>({id:invoice.id,label:invoice.number}))} search={searchInvoices} placeholder={emptyLabel}/>;
}
