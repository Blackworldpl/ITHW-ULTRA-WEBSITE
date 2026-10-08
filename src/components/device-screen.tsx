'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Monitor,ScanLine,RefreshCw,Maximize,Camera,Square} from 'lucide-react';
import type {Html5Qrcode} from 'html5-qrcode';
import type {DeviceScreenData,DeviceReading} from '@/shared/devices';
import {deviceModeLabels,tvDashboard,terminalConfig,terminalCounterLabels,type DeviceInventory,type DeviceKind} from '@/shared/devices';
import {TvPairingScreen} from './tv-pairing';
import {TvDashboard,TvClock} from './tv-dashboard';
import {TerminalReadingCard,terminalResultLabels} from './terminal-reading';
import {Brand} from './brand';
import {ThemeToggle} from './theme';
import {useIdentifierQueue} from './identifier-queue';
import {api,ApiFailure,Button,ErrorMessage,Field,Loading,StatusBadge,formatDate} from './ui';
export function DeviceScreen({id}:{id:string}){
 const [data,setData]=useState<DeviceScreenData|null>(null),[unavailable,setUnavailable]=useState(false),[pairRequired,setPairRequired]=useState(false),[pairKind,setPairKind]=useState<DeviceKind|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
 const latest=useRef(data);latest.current=data;
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;async function load(){try{const response=await api<DeviceScreenData>('/api/device/'+id);if(active){setData(response);setUnavailable(false);setPairRequired(false);setError('');}}catch(e){if(active){const failure=e as ApiFailure;setError(failure.message);if(failure.status===401||failure.status===403){setData(null);setPairRequired(true);try{const setup=await api<{kind:DeviceKind}>('/api/device/'+id+'/setup');if(active){setPairKind(setup.kind);setUnavailable(false);}}catch(setupError){if(active){setError((setupError as Error).message);if([403,404].includes((setupError as ApiFailure).status)){setPairKind(null);setPairRequired(false);setUnavailable(true);}}}}}}finally{if(active)timer=setTimeout(load,(latest.current?.config.refreshSeconds??5)*1000);}}void load();return()=>{active=false;clearTimeout(timer);};},[id,revision]);
 async function pair(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/api/device/'+id+'/pair',{method:'POST',body:JSON.stringify({code})});setCode('');setPairRequired(false);setRevision(v=>v+1);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 function inventoryChanged(inventory:DeviceInventory){setData(value=>value&&value.config.stocktakeId===inventory.id?{...value,inventory}:value);}
 if(!data)return <main className="device-pair-screen"><div className="auth-theme-toggle"><ThemeToggle/></div><Brand/><section>{unavailable?<><h1>Ekran niedostępny</h1><ErrorMessage message={error}/><p>Skontaktuj się z administratorem, aby uzyskać aktualny link urządzenia.</p><Button variant="secondary" onClick={()=>setRevision(v=>v+1)}>Sprawdź ponownie</Button></>:pairRequired&&pairKind==='TV'?<TvPairingScreen key={id} id={id} onApproved={()=>{setPairRequired(false);setRevision(v=>v+1);}}/>:pairRequired&&pairKind==='SCANNER'?<><div className="eyebrow">POŁĄCZ URZĄDZENIE</div><h1>Wpisz kod z panelu</h1><p>Administrator dodaje TV lub terminal w „Ekrany i terminale” i przekazuje kod parowania.</p><ErrorMessage message={error}/><form onSubmit={pair}><Field label="Sześciocyfrowy kod parowania"><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,''))} autoFocus disabled={busy}/></Field><Button disabled={busy||code.length!==6}>{busy?'Łączenie…':'Połącz urządzenie'}</Button></form><small>Link nie daje dostępu bez sparowania tej przeglądarki.</small></>:<><Loading/><ErrorMessage message={error} onRetry={()=>setRevision(v=>v+1)}/></>}</section></main>;
 return <main className={'device-screen '+(data.kind==='TV'?'device-tv':'device-terminal')+(data.config.mode==='MESSAGE'?' device-message-mode':'')} data-theme={data.config.theme} data-terminal-size={data.kind==='SCANNER'?terminalConfig(data.config).textSize:undefined} data-tv-size={data.kind==='TV'?tvDashboard(data.config).textSize:undefined}><header className="device-screen-header"><Brand/><div>{data.kind==='TV'?<Monitor size={23}/>:<ScanLine size={23}/>}<div><h1>{data.config.title||data.name}</h1><span>{deviceModeLabels[data.config.mode]}</span></div></div>{data.kind==='TV'&&<TvClock enabled={tvDashboard(data.config).showClock}/>}<button className="icon-button" aria-label="Pełny ekran" onClick={()=>{if(!document.fullscreenElement)void document.documentElement.requestFullscreen().catch(()=>setError('Uruchom pełny ekran z menu przeglądarki.'));else void document.exitFullscreen();}}><Maximize size={21}/></button></header>
 <ErrorMessage message={error} onRetry={()=>setRevision(v=>v+1)}/>
 {data.kind==='SCANNER'&&data.config.message&&<aside className={'device-notification level-'+data.config.messageLevel} role={data.config.messageLevel==='CRITICAL'?'alert':'status'}><span>{data.config.messageLevel==='CRITICAL'?'PILNE':data.config.messageLevel==='WARNING'?'WAŻNE':'KOMUNIKAT'}</span><p>{data.config.message}</p></aside>}
 {data.kind==='TV'?<TvDashboard data={data}/>:<TerminalContents data={data} onInventory={inventoryChanged} onRefresh={async()=>{const next=await api<DeviceScreenData>('/api/device/'+id);setData(next);return next;}}/>}
 <footer className="device-screen-footer"><span>IT HARDWARE / ROBAKOWO</span><span>{error?'Brak aktualizacji · ostatnie dane: ':'Ostatnia aktualizacja: '}{formatDate(data.updatedAt,true)} · co {data.config.refreshSeconds} s</span></footer></main>;
}
function TerminalContents({data,onInventory,onRefresh}:{data:DeviceScreenData;onInventory:(scan:DeviceInventory)=>void;onRefresh:()=>Promise<DeviceScreenData>}){
 const [input,setInput]=useState(''),[last,setLast]=useState<DeviceReading|null>(null),[readings,setReadings]=useState<DeviceReading[]>([]),[refreshError,setRefreshError]=useState('');
 const inputRef=useRef<HTMLInputElement>(null),dataRef=useRef(data);dataRef.current=data;
 const options=terminalConfig(data.config);
 useEffect(()=>{setLast(null);setReadings([]);},[data.version]);
 useEffect(()=>{setReadings(values=>values.slice(0,options.showHistory?options.historyLimit:0));},[options.showHistory,options.historyLimit]);
 const queue=useIdentifierQueue<DeviceReading>((encoded,requestId)=>{
  const item=JSON.parse(encoded) as {code:string;mode:string;stocktakeId:string|null},current=dataRef.current;
  if(item.mode!==current.config.mode||item.stocktakeId!==current.config.stocktakeId)throw new Error('Tryb lub sesja terminala zmieniły się. Pomiń ten odczyt i zeskanuj ponownie w nowym trybie.');
  return api<DeviceReading>('/api/device/'+data.id+'/scan',{method:'POST',body:JSON.stringify({code:item.code,version:current.version,requestId}),headers:{'X-Device-CSRF':current.csrfToken}});
 },(result,encoded)=>{
  const item=JSON.parse(encoded) as {mode:string;stocktakeId:string|null},current=dataRef.current,settings=terminalConfig(current.config);
  if(item.mode===current.config.mode&&item.stocktakeId===current.config.stocktakeId){setLast(result);if(settings.showHistory)setReadings(values=>[result,...values].slice(0,settings.historyLimit));}
  if(result.inventory)onInventory(result.inventory);inputRef.current?.focus();
 });
 const completed=data.config.mode==='INVENTORY'&&data.inventory?.status!=='OPEN';
 function enqueue(value:string){if(completed)return;if(queue.enqueue(JSON.stringify({code:value.trim(),mode:data.config.mode,stocktakeId:data.config.stocktakeId}))){setInput('');inputRef.current?.focus();}}
 function submit(event:FormEvent){event.preventDefault();if(input.trim())enqueue(input);}
 async function refreshAndRetry(){try{setRefreshError('');dataRef.current=await onRefresh();queue.retry();}catch(error){setRefreshError((error as Error).message);}}
 const inventory=data.inventory;
 return <section className="terminal-workspace">{inventory&&<><h2>{inventory.locationName}</h2>{options.counters.length>0&&<div className="terminal-counts">{options.counters.map(key=>inventory[key]!==undefined&&<div key={key}><strong>{inventory[key]}</strong><span>{terminalCounterLabels[key]}</span></div>)}</div>}{completed&&<div className="notice notice-info">Ta inwentaryzacja została zakończona. Administrator może wybrać kolejną sesję.</div>}</>}
 <form className="terminal-scan-form" onSubmit={submit}><label htmlFor="terminal-code">{options.inputLabel}</label><input ref={inputRef} id="terminal-code" autoFocus autoComplete="off" maxLength={2048} disabled={completed} placeholder={options.inputPlaceholder} value={input} onChange={event=>setInput(event.target.value)}/><Button disabled={completed||!input.trim()}><ScanLine size={20}/>{data.config.mode==='LOOKUP'?'Sprawdź rekord':'Zapisz odczyt'}</Button></form>
 <div role="status" className="terminal-queue">{queue.queued?'Odczyty w kolejce: '+queue.queued:'Gotowy do odczytu'}</div><ErrorMessage message={refreshError||queue.error} onRetry={queue.failedCode?()=>void refreshAndRetry():undefined}/>{queue.failedCode&&<Button variant="secondary" onClick={queue.skip}>Pomiń niezapisany odczyt: {JSON.parse(queue.failedCode).code}</Button>}
 {options.showCamera&&<TerminalCamera onRead={enqueue} disabled={completed}/>}
 {last&&<TerminalReadingCard reading={last} options={options}/>}
 {options.showHistory&&readings.length>0&&<section className="terminal-readings"><div className="section-heading"><h2>Ostatnie odczyty · {readings.length}/{options.historyLimit}</h2><Button type="button" variant="ghost" onClick={()=>{setReadings([]);setLast(null);}}>Wyczyść podgląd</Button></div><p className="help-note">Historia tego ekranu. Wyczyszczenie podglądu zachowuje zapisane operacje w systemie.</p><ol>{readings.map((reading,index)=><li key={index}><strong>{reading.title}</strong>{options.showCode&&reading.code&&<code>{reading.code}</code>}{reading.event&&<span>{terminalResultLabels[reading.event.result]}</span>}</li>)}</ol></section>}</section>;
}
function TerminalCamera({onRead,disabled}:{onRead:(code:string)=>void;disabled:boolean}){
 const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),reader=useRef<Html5Qrcode|null>(null),mounted=useRef(true),lastCode=useRef({code:'',at:0}),callback=useRef(onRead);callback.current=onRead;
 async function stop(){const current=reader.current;reader.current=null;if(current)try{if(current.isScanning)await current.stop();current.clear();}catch{}if(mounted.current)setActive(false);}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void stop();};},[]);
 useEffect(()=>{if(disabled)void stop();},[disabled]);
 async function start(){if(busy||active||disabled)return;setBusy(true);setError('');try{if(!window.isSecureContext||!navigator.mediaDevices)throw Error('Aparat wymaga adresu HTTPS. Możesz użyć wbudowanego czytnika terminala.');const {Html5Qrcode}=await import('html5-qrcode');if(!mounted.current)return;const current=new Html5Qrcode('terminal-camera');reader.current=current;await current.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},code=>{if(lastCode.current.code===code&&Date.now()-lastCode.current.at<2000)return;lastCode.current={code,at:Date.now()};callback.current(code);},()=>{});if(mounted.current)setActive(true);else await stop();}catch(e){await stop();if(mounted.current)setError((e as Error).message.includes('HTTPS')?(e as Error).message:'Nie udało się uruchomić aparatu. Sprawdź zgodę przeglądarki lub użyj czytnika.');}finally{if(mounted.current)setBusy(false);}}
 return <div className="terminal-camera"><Button variant="secondary" type="button" disabled={busy||disabled} onClick={()=>active?void stop():void start()}>{active?<Square size={18}/>:<Camera size={18}/>} {active?'Zatrzymaj aparat':busy?'Uruchamianie…':'Skanuj aparatem'}</Button><ErrorMessage message={error}/><div id="terminal-camera"/></div>;
}
