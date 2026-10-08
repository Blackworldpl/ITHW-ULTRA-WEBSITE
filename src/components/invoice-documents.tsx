'use client';
import {hasPermission} from '@/shared/permissions';
import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Download, FileText, Upload, LoaderCircle } from 'lucide-react';
import type { InvoiceDocument } from '@/shared/types';
import { canEdit, useApp } from './context';
import { api, Button, ErrorMessage, Field, formatDate, Loading, SuccessMessage, useResource } from './ui';
import { loginUrl } from '@/shared/login-return';

export function InvoiceDocuments({invoiceId,invoiceNumber,allowUpload=false}:{invoiceId:string;invoiceNumber?:string|null;allowUpload?:boolean}) {
  const {user}=useApp();
  const documents=useResource<InvoiceDocument[]>(`/api/invoices/${invoiceId}/documents`);
  const fileRef=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const [downloadingId,setDownloadingId]=useState<string|null>(null);
  async function upload(event:FormEvent) {
    event.preventDefault();if(busy)return;
    const file=fileRef.current?.files?.[0];
    if(!file){setError('Wybierz PDF faktury.');return;}
    if(file.size>10*1024*1024){setError('PDF może mieć najwyżej 10 MB.');return;}
    setBusy(true);setError('');setSuccess('');
    try {
      await api(`/api/invoices/${invoiceId}/documents`,{method:'POST',body:file,headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent(file.name)}},user.csrfToken);
      documents.reload();if(fileRef.current)fileRef.current.value='';setSuccess('PDF jest dostępny na fakturze i kartach przypisanego sprzętu.');
    } catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  async function download(document:InvoiceDocument) {
    if(busy)return;setBusy(true);setDownloadingId(document.id);setError('');
    try {
      const response=await fetch(`/api/invoices/${invoiceId}/documents/${document.id}`,{credentials:'same-origin'});
      if(!response.ok){
        if(response.status===401)window.location.assign(loginUrl(window.location.pathname+window.location.search));
        const result=await response.json().catch(()=>({}));throw new Error(response.status>=500?'Nie udało się pobrać PDF. Spróbuj ponownie.':result.error||'Nie udało się pobrać PDF.');
      }
      const url=URL.createObjectURL(await response.blob());
      const link=documentElement(document.name,url);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60_000);
    }catch(error){setError((error as Error).message);}finally{setBusy(false);setDownloadingId(null);}
  }
  return <section className="panel">
    <div className="panel-heading"><div><h2>Faktura zakupu — PDF</h2>{invoiceNumber&&<Link href={`/invoice/${invoiceId}`} className="text-link">{invoiceNumber}</Link>}</div><FileText size={19}/></div>
    <div className="panel-body"><ErrorMessage message={documents.error||error}/><SuccessMessage message={success}/>
      {documents.loading&&!documents.data?<Loading/>:documents.data?.length?<ul className="invoice-documents">{documents.data.map(document=><li key={document.id}><div><strong>{document.name}</strong><small>{(document.size/1024).toFixed(0)} KB · {document.uploadedBy} · {formatDate(document.createdAt,true)}</small></div><Button variant="secondary" disabled={busy} onClick={()=>download(document)}>{downloadingId===document.id?<LoaderCircle className="spin" size={15}/>:<Download size={15}/>} {downloadingId===document.id?'Pobieranie…':'Pobierz PDF'}</Button></li>)}</ul>:!documents.error&&<p className="help-note">Do tej faktury nie dołączono jeszcze PDF.</p>}
      {allowUpload&&hasPermission(user,'invoice.edit')&&<form className="invoice-upload" onSubmit={upload}><Field label="Dołącz PDF faktury"><input ref={fileRef} type="file" accept=".pdf,application/pdf" disabled={busy} required/></Field><p className="help-note">Do 10 MB. Dokument będzie dostępny przy każdym urządzeniu przypisanym do tej FV.</p><Button disabled={busy}><Upload size={15}/>{busy?'Przetwarzanie…':'Dołącz PDF'}</Button></form>}
    </div>
  </section>;
}

function documentElement(name:string,url:string) {
  const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);return link;
}
