'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {SessionUser} from '@/shared/types';
import {loginUrl,safeReturnPath} from '@/shared/login-return';
import {AuthFrame} from '@/components/auth-frame';
import {api,ApiFailure,Button,ErrorMessage,Field,Loading} from '@/components/ui';

export default function ChangePasswordPage(){
 const router=useRouter(),lock=useRef(false);
 const [user,setUser]=useState<SessionUser|null>(null),[current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[next,setNext]=useState('/');
 useEffect(()=>{const destination=safeReturnPath(new URLSearchParams(window.location.search).get('next'));setNext(destination);const controller=new AbortController();api<SessionUser>('/api/auth/me',{signal:controller.signal}).then(setUser).catch(failure=>{if(controller.signal.aborted)return;if(failure instanceof ApiFailure&&failure.status===401)router.replace(loginUrl(destination));else setError(failure.message);});return()=>controller.abort();},[router]);
 async function submit(event:FormEvent){
  event.preventDefault();if(lock.current||!user)return;setError('');
  if(password!==confirmation){setError('Nowe hasła muszą być identyczne.');return;}
  if(password===current){setError('Nowe hasło musi różnić się od dotychczasowego.');return;}
  lock.current=true;setBusy(true);
  try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:password,confirmation})},user.csrfToken);setCurrent('');setPassword('');setConfirmation('');setDone(true);}
  catch(failure){setError((failure as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 async function logout(){if(busy||!user)return;setBusy(true);try{await api('/api/auth/logout',{method:'POST'},user.csrfToken);router.replace(loginUrl(next));router.refresh();}catch(failure){setError((failure as Error).message);setBusy(false);}}
 return <AuthFrame><div className="auth-form"><div className="eyebrow">IT HARDWARE / TWOJE KONTO</div><h1>{done?'Hasło zostało zapisane.':user?.mustChangePassword?'Ustaw własne hasło.':'Zmień hasło.'}</h1><ErrorMessage message={error}/>{done?<><p>Twoje dotychczasowe sesje zostały zakończone. Zaloguj się nowym hasłem, aby kontynuować.</p><Link className="button" href={loginUrl(next)}>Zaloguj się nowym hasłem</Link></>:user?<><p>{user.mustChangePassword?'To pierwsze logowanie z hasłem tymczasowym. Ustaw swoje hasło, aby otrzymać dostęp do systemu.':'Zmiana zakończy sesje tego konta na wszystkich urządzeniach.'}</p><p><strong>{user.name}</strong><br/>{user.email}</p><form onSubmit={submit}><fieldset className="plain-fieldset" disabled={busy}><Field label={user.mustChangePassword?'Hasło tymczasowe':'Dotychczasowe hasło'}><input type="password" autoComplete="current-password" required maxLength={128} autoFocus value={current} onChange={e=>setCurrent(e.target.value)}/></Field><Field label="Nowe hasło" hint="12–128 znaków. Możesz użyć długiej frazy i wkleić hasło z menedżera."><input type={visible?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></Field><Field label="Powtórz nowe hasło"><input type={visible?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></Field><label className="checkbox-inline"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/>Pokaż nowe hasło</label><Button type="submit" disabled={busy}>{busy?'Zapisywanie…':'Zapisz własne hasło'}</Button></fieldset></form><div className="row-actions">{!user.mustChangePassword&&<Link className="button button-ghost" href={next}>Wróć do systemu</Link>}<Button type="button" variant="ghost" disabled={busy} onClick={()=>void logout()}>Wyloguj</Button></div></>:!error&&<Loading compact/>}</div></AuthFrame>;
}
