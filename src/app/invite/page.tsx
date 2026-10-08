'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {AuthFrame} from '@/components/auth-frame';
import {api,Button,ErrorMessage,Field,Loading} from '@/components/ui';
export default function InvitationPage(){
 const router=useRouter();const [token,setToken]=useState(''),[invite,setInvite]=useState<{name:string;email:string}|null>(null),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const value=new URLSearchParams(window.location.search).get('token')??'';setToken(value);const controller=new AbortController();api<{name:string;email:string}>('/api/invite?token='+encodeURIComponent(value),{signal:controller.signal}).then(setInvite).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[]);
 async function submit(e:FormEvent){e.preventDefault();if(busy)return;if(password!==confirmation){setError('Hasła muszą być identyczne.');return;}setBusy(true);setError('');try{await api('/api/invite',{method:'POST',body:JSON.stringify({token,password})});router.replace('/');router.refresh();}catch(e){setError((e as Error).message);setBusy(false);}}
 return <AuthFrame><div className="auth-form"><div className="eyebrow">ITH // ACCOUNT ACTIVATION</div><h1>Aktywuj dostęp.</h1><ErrorMessage message={error}/>{invite?<><p>{invite.name} · {invite.email}</p><form onSubmit={submit}><Field label="Ustaw hasło" hint="Co najmniej 12 znaków."><input autoComplete="new-password" type="password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={e=>setPassword(e.target.value)}/></Field><Field label="Powtórz hasło"><input autoComplete="new-password" type="password" required minLength={12} maxLength={128} value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></Field><Button disabled={busy}>{busy?'Aktywowanie…':'Aktywuj konto i zaloguj'}</Button></form></>:!error&&<Loading compact/>}</div></AuthFrame>;
}
