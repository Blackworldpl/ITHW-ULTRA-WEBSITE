'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {useApp} from './context';
import {useIdentifierQueue} from './identifier-queue';
import { Camera, ScanLine, Square, ArrowRight, ImageUp, Check } from 'lucide-react';
import type { Html5Qrcode } from 'html5-qrcode';
import { api, Button, ErrorMessage, PageHeader } from './ui';
import { scanTarget } from '@/shared/scan';

export function ScanScreen() {
  const {user}=useApp();const [continuous,setContinuous]=useState(false),[readings,setReadings]=useState<{href:string;title:string;code:string;duplicate:boolean}[]>([]),mode=useRef(false),seen=useRef(new Set<string>()),cameraCode=useRef({code:'',at:0});mode.current=continuous;
  const router=useRouter();const scanner=useRef<Html5Qrcode|null>(null);const mounted=useRef(true),busy=useRef(false),processing=useRef(false);
  const [active,setActive]=useState(false),[starting,setStarting]=useState(false),[error,setError]=useState(''),[input,setInput]=useState('');
  const [identified,setIdentified]=useState(false);
  async function stop() {if(scanner.current){const current=scanner.current;scanner.current=null;try{if(current.isScanning)await current.stop();current.clear();}catch{/* Camera may already have stopped. */}}if(mounted.current)setActive(false);}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void stop();};},[]);
  const queue=useIdentifierQueue((code,requestId)=>api<{href:string;title:string;code:string}>('/api/scan/observe',{method:'POST',body:JSON.stringify({code,requestId})},user.csrfToken),(result)=>{const duplicate=seen.current.has(result.href);seen.current.add(result.href);setReadings(v=>[{...result,duplicate},...v].slice(0,100));setIdentified(true);processing.current=false;if(!mode.current){void stop();router.push(result.href);}});
  function open(raw:string){if(!mode.current&&processing.current)return;setError('');if(queue.enqueue(raw)){processing.current=!mode.current;setInput('');}}
  async function start() {
    if(busy.current || active)return;busy.current=true;setStarting(true);setError('');processing.current=false;
    if(!window.isSecureContext || !navigator.mediaDevices){setError('Aparat wymaga połączenia HTTPS lub localhost. Możesz wpisać identyfikator ręcznie.');setStarting(false);busy.current=false;return;}
    try {
      const {Html5Qrcode}=await import('html5-qrcode');if(!mounted.current)return;
      const reader=new Html5Qrcode('qr-camera-reader');scanner.current=reader;
      await reader.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},value=>{if(cameraCode.current.code===value&&Date.now()-cameraCode.current.at<1500)return;cameraCode.current={code:value,at:Date.now()};open(value);},()=>{});
      if(!mounted.current){await stop();return;}setActive(true);
    }catch{await stop();if(mounted.current)setError('Nie można uruchomić aparatu. Sprawdź uprawnienia przeglądarki lub użyj pola poniżej.');}
    finally{busy.current=false;if(mounted.current)setStarting(false);}
  }
  async function scanImage(file:File) {
    if(busy.current)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024){setError('Wybierz zdjęcie PNG, JPG lub WEBP do 12 MB.');return;}
    busy.current=true;setStarting(true);setError('');processing.current=false;
    let reader:Html5Qrcode|null=null;
    try{
      await stop();const {Html5Qrcode}=await import('html5-qrcode');if(!mounted.current)return;
      reader=new Html5Qrcode('qr-file-reader');
      const value=await reader.scanFile(file,true);if(mounted.current)open(value);
    }catch{if(mounted.current)setError('Nie znaleziono czytelnego kodu na zdjęciu. Wybierz wyraźny obraz całego QR, z jasnym marginesem.');}
    finally{try{reader?.clear();}catch{}busy.current=false;if(mounted.current)setStarting(false);}
  }
  return <>
    <PageHeader eyebrow="IDENTYFIKACJA / QR + RFID" title="Skanuj urządzenie" description="Od etykiety do paszportu urządzenia. Aparat, zdjęcie lub czytnik USB."/>
    <div className="scan-mode-control" role="group" aria-label="Tryb skanowania"><Button variant={!continuous?undefined:'secondary'} onClick={()=>{void stop();processing.current=false;setIdentified(false);setContinuous(false);}} disabled={queue.queued>0||starting}>Pojedynczy — otwórz rekord</Button><Button variant={continuous?undefined:'secondary'} onClick={()=>{void stop();processing.current=false;setIdentified(false);setContinuous(true);}} disabled={queue.queued>0||starting}>Ciągły — zbieraj odczyty</Button><Link className="text-link" href="/stocktakes">Inwentaryzacja lokalizacji →</Link></div><div className="scan-layout"><section className="scan-panel">
      <ErrorMessage message={error||queue.error} onRetry={queue.failedCode?queue.retry:undefined}/>{queue.failedCode&&<Button variant="secondary" onClick={()=>{queue.skip();processing.current=false;}}>Pomiń niezapisany odczyt: {queue.failedCode}</Button>}<div className="queue-status" role="status">{queue.queued?`Odczyty w kolejce: ${queue.queued}`:continuous?'Gotowe do kolejnego odczytu':'Tryb pojedynczy'}</div>
      <div className="scan-console">
        <div>
          <div className={`scan-state ${identified ? 'success' : ''}`} role="status"><span className={`status-light ${identified||active ? 'success' : 'pending'}`}/>{identified?'ODCZYT ZAPISANY':active?'APARAT URUCHOMIONY':starting?'URUCHAMIANIE ODCZYTU':'APARAT WYŁĄCZONY'}</div>
          {!active&&<div className="scan-placeholder"><span className="scan-corners"/>{identified?<Check size={44}/>:<ScanLine size={44}/>}<p>{identified?continuous?'Odczyt zapisany. Możesz zeskanować następny kod.':'Otwieranie paszportu urządzenia…':starting?'Przygotowywanie odczytu…':'Umieść etykietę w kadrze po uruchomieniu aparatu'}</p></div>}
          <div id="qr-camera-reader" className={`scan-reader ${active?'is-active':''}`}/>
          {active?<Button variant="secondary" onClick={()=>void stop()}><Square size={17}/> Zatrzymaj aparat</Button>:<Button onClick={()=>void start()} disabled={starting||(!continuous&&identified)}><Camera size={18}/> {starting?'Odczytywanie…':'Uruchom aparat'}</Button>}
          <p className="scan-capability-note">Obsługiwane identyfikatory: QR, Asset ID, serial, numer środka trwałego, RFID, SKU i kod produktu. Tag RFID odczytasz czytnikiem, który wpisuje tekst do pola.</p>
        </div>
        <div>
          <div className="scan-manual"><h2>Identyfikator lub czytnik USB</h2><p>Wpisz kod albo zeskanuj go czytnikiem. Zatwierdź klawiszem Enter. W trybie ciągłym odczyty pozostaną na liście.</p><form className="toolbar" onSubmit={e=>{e.preventDefault();void open(input);}}><input aria-label="Kod lub identyfikator" value={input} onChange={e=>setInput(e.target.value)} placeholder="Asset ID / serial / RFID / SKU" required maxLength={2048} autoComplete="off"/><Button type="submit" disabled={starting||(!continuous&&identified)}><ArrowRight size={17}/> {continuous?'Zapisz odczyt':'Otwórz rekord'}</Button></form></div>
          <div className="scan-manual"><h2><ImageUp size={17}/>Kod QR ze zdjęcia</h2><p>Wybierz zdjęcie etykiety lub zapisany kod QR. Obraz jest przetwarzany lokalnie w przeglądarce.</p><input aria-label="Zdjęcie kodu QR" type="file" accept="image/png,image/jpeg,image/webp" disabled={starting||(!continuous&&identified)} onChange={e=>{const file=e.target.files?.[0];if(file)void scanImage(file);e.target.value='';}}/><div id="qr-file-reader"/></div>
        </div>
      </div>
    </section></div>{continuous&&<section className="scan-batch"><div className="section-heading"><h2>Lista odczytów</h2><span>{seen.current.size} unikalnych rekordów · ostatnie {readings.length} odczytów</span></div>{readings.length?<ol className="scan-event-list">{readings.map((r,i)=><li key={i}><Check size={17}/><div><Link className="table-title" href={r.href}>{r.title}</Link><small className="mono">{r.code}</small></div><span className="badge">{r.duplicate?'Powtórzony odczyt':'Rozpoznano'}</span></li>)}</ol>:<p className="help-note">Odczytaj pierwszy kod. Każdy rozpoznany odczyt zapisuje zdarzenie w historii.</p>}</section>}
  </>;
}
