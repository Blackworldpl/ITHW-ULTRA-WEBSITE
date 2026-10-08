'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { AuthFrame } from '@/components/auth-frame';
import { api, Button, ErrorMessage, Field, Loading, useResource } from '@/components/ui';

export default function SetupPage() {
  const router=useRouter();const available=useResource<{available:boolean}>('/api/setup');
  const [values,setValues]=useState({token:'',name:'',email:'',password:'',confirmation:''});const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const change=(key:keyof typeof values)=>(event:React.ChangeEvent<HTMLInputElement>)=>setValues(v=>({...v,[key]:event.target.value}));
  async function submit(event:React.FormEvent) {
    event.preventDefault();setError('');
    if(values.password!==values.confirmation){setError('Wpisane hasła muszą być identyczne.');return;}
    setBusy(true);
    try { const {confirmation:_confirmation,...body}=values;await api('/api/setup',{method:'POST',body:JSON.stringify(body)});router.replace('/');router.refresh(); }
    catch(err){setError((err as Error).message);setBusy(false);}
  }
  return <AuthFrame><div className="auth-form"><div className="eyebrow">PIERWSZE URUCHOMIENIE</div><h1>Administrator systemu</h1><p>Utwórz pierwsze konto i rozpocznij pracę zespołu.</p>{available.loading?<Loading/>:available.error?<><ErrorMessage message={available.error}/><Button onClick={available.reload}>Sprawdź ponownie</Button></>:!available.data?.available?<><p>Inicjalizacja jest zakończona lub wymaga włączenia przez osobę instalującą system.</p><Link className="button" href="/login">Przejdź do logowania</Link></>:<><ErrorMessage message={error}/><form onSubmit={submit}><Field label="Token inicjalizacji" hint="Otrzymasz go od osoby instalującej system. Instrukcja znajduje się w README projektu."><input type="password" autoComplete="off" value={values.token} onChange={change('token')} required maxLength={512} disabled={busy}/></Field><Field label="Imię i nazwisko"><input autoComplete="name" value={values.name} onChange={change('name')} required minLength={2} maxLength={120} disabled={busy}/></Field><Field label="Adres e-mail"><input type="email" autoComplete="username" value={values.email} onChange={change('email')} required maxLength={254} disabled={busy}/></Field><Field label="Hasło" hint="Co najmniej 12 znaków."><input type="password" autoComplete="new-password" value={values.password} onChange={change('password')} required minLength={12} maxLength={128} disabled={busy}/></Field><Field label="Powtórz hasło"><input type="password" autoComplete="new-password" value={values.confirmation} onChange={change('confirmation')} required minLength={12} maxLength={128} disabled={busy}/></Field><Button type="submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<ShieldCheck size={17}/>} {busy?'Tworzenie konta…':'Utwórz konto administratora'}</Button></form></>}<div className="auth-form-note"><Link href="/login">← Powrót do logowania</Link></div></div></AuthFrame>;
}
