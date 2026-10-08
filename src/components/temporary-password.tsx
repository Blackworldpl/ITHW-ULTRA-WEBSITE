'use client';
import {useState} from 'react';
import {Button,Field} from './ui';

export function TemporaryPassword({value,onChange,readOnly=false,required=true}:{value:string;onChange:(value:string)=>void;readOnly?:boolean;required?:boolean}){
 const [visible,setVisible]=useState(false),[notice,setNotice]=useState('');
 function generate(){const bytes=crypto.getRandomValues(new Uint8Array(16));onChange('Tmp-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));setNotice('Wygenerowano hasło tymczasowe.');}
 async function copy(){try{await navigator.clipboard.writeText(value);setNotice('Skopiowano hasło.');}catch{setNotice('Nie udało się skopiować. Pokaż hasło i skopiuj je ręcznie.');}}
 return <div className="field-span"><Field label={required?"Hasło tymczasowe *":"Hasło tymczasowe"} hint="Co najmniej 12 znaków. Możesz wkleić hasło lub je wygenerować."><input required={required} type={visible?'text':'password'} minLength={12} maxLength={128} autoComplete="new-password" value={value} readOnly={readOnly} onChange={e=>{onChange(e.target.value);setNotice('');}}/></Field><div className="row-actions">{!readOnly&&<Button type="button" variant="secondary" onClick={generate}>Wygeneruj hasło</Button>}<Button type="button" variant="ghost" onClick={()=>setVisible(v=>!v)}>{visible?'Ukryj hasło':'Pokaż hasło'}</Button><Button type="button" variant="ghost" disabled={!value} onClick={()=>void copy()}>Kopiuj hasło</Button></div><p className="help-note" role="status">{notice}</p></div>;
}
