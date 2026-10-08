'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { AuthFrame } from '@/components/auth-frame';
import { api, Button, ErrorMessage, Field, useResource } from '@/components/ui';
import type {SessionUser} from '@/shared/types';
import { safeReturnPath,passwordChangeUrl } from '@/shared/login-return';

export default function LoginPage() {
  const router=useRouter();
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const setup=useResource<{available:boolean}>('/api/setup');
  async function submit(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try { const user=await api<SessionUser>('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});router.replace(user.mustChangePassword?passwordChangeUrl(safeReturnPath(new URLSearchParams(window.location.search).get('next'))):safeReturnPath(new URLSearchParams(window.location.search).get('next')));router.refresh(); }
    catch(err){setError((err as Error).message);setBusy(false);}
  }
  return <AuthFrame><div className="auth-form"><div className="eyebrow">IT HARDWARE / DOSTĘP DO SYSTEMU</div><h1>Witaj w Robakowie.</h1><p>Zaloguj się, aby otworzyć centrum zarządzania sprzętem.</p><ErrorMessage message={error || setup.error}/><form onSubmit={submit}><Field label="Adres e-mail"><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} placeholder="imie.nazwisko@firma.pl" disabled={busy}/></Field><Field label="Hasło"><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128} placeholder="Wprowadź hasło" disabled={busy}/></Field><Button type="submit" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<ArrowRight size={17}/>} {busy?'Logowanie…':'Zaloguj się'}</Button></form><div className="auth-form-note">Dostęp dla uprawnionych członków zespołu IT. Potrzebujesz konta? Skontaktuj się z administratorem systemu.{setup.data?.available&&<><br/><Link href="/setup">Pierwsze uruchomienie — utwórz konto administratora →</Link></>}</div></div></AuthFrame>;
}
