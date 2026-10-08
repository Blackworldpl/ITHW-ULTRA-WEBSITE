"use client";
import {createUuid} from '@/shared/uuid';
import {quantityOrNaN} from '@/shared/quantity';
import {hasPermission} from '@/shared/permissions';

import { useState } from 'react';
import Link from 'next/link';
import { FileSpreadsheet, Upload, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useApp, canEdit } from './context';
import {LocationPicker,SearchSelect} from './pickers';
import type {InventoryDictionaries} from '@/shared/inventory-dictionaries';
import { api, Button, ErrorMessage, Field, PageHeader,useResource } from './ui';
import { parseCsv, type ImportPayload, type ImportPreview, type ImportResult, type ImportRow } from '@/shared/import';

type Sheet={sheet:string;data:string[][]};
const fields: {key:keyof Omit<ImportRow,'row'>;label:string;aliases:string[]}[]=[
 {key:'name',label:'Nazwa / opis *',aliases:['name','nazwa','description','opis','product name','item name']},
 {key:'quantity',label:'Ilość (bez kolumny: 1)',aliases:['quantity','qty','ilosc','stock','stan','count']},
 {key:'serialNumber',label:'Numer seryjny',aliases:['serial number','serial','serialnumber','sn','numer seryjny']},
 {key:'sku',label:'SKU / kod produktu',aliases:['sku','product code','kod','kod produktu','item code']},
 {key:'manufacturer',label:'Producent',aliases:['manufacturer','producent','brand']},
 {key:'model',label:'Model',aliases:['model']},
 {key:'fixedAssetNumber',label:'Istniejący numer środka trwałego',aliases:['fixed asset number','numer st','numer srodka trwalego']},
 {key:'notes',label:'Uwagi',aliases:['notes','uwagi','comment']},
];
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('ł','l').toLowerCase().trim();
const guess=(headers:string[])=>Object.fromEntries(fields.map(f=>[f.key,headers.findIndex(h=>f.aliases.includes(normalize(h)))])) as Record<string,number>;

// Reject compressed archives with excessive declared expansion before the XLSX parser runs.
function checkWorkbook(buffer:ArrayBuffer){
 const v=new DataView(buffer);let end=-1;
 for(let i=v.byteLength-22;i>=Math.max(0,v.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw new Error('Niepoprawny plik XLSX. Dla starego XLS zapisz kopię jako XLSX lub CSV.');
 const count=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true),expanded=0;
 if(count>1000||count===65535)throw new Error('Zbyt złożony skoroszyt. Użyj CSV.');
 for(let i=0;i<count;i++){
  if(offset+46>v.byteLength||v.getUint32(offset,true)!==0x02014b50)throw new Error('Niepoprawna struktura XLSX.');
  const size=v.getUint32(offset+24,true);expanded+=size;
  if(size>30*1024*1024||expanded>60*1024*1024||(v.getUint16(offset+8,true)&1))throw new Error('Skoroszyt jest zbyt duży lub zaszyfrowany. Użyj CSV.');
  offset+=46+v.getUint16(offset+28,true)+v.getUint16(offset+30,true)+v.getUint16(offset+32,true);
 }
}

export function InventoryImportScreen(){
 const {user,lookups,lookupError}=useApp();
 const [sheets,setSheets]=useState<Sheet[]>([]),[sheetIndex,setSheetIndex]=useState(0),[headerRow,setHeaderRow]=useState(1);
 const [mapping,setMapping]=useState<Record<string,number>>({}),[sourceHash,setSourceHash]=useState(''),[fileName,setFileName]=useState('');
 const [mode,setMode]=useState<'assets'|'inventory'>('assets'),[categoryId,setCategoryId]=useState(''),[category,setCategory]=useState(''),[unit,setUnit]=useState('szt.'),[locationId,setLocationId]=useState(''),[fixedAssets,setFixedAssets]=useState(false);
 const dictionaries=useResource<InventoryDictionaries>(mode==='inventory'?'/api/inventory/dictionaries':null);
 const [from,setFrom]=useState(2),[to,setTo]=useState(1001),[encoding,setEncoding]=useState('utf-8');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState<(ImportPreview&{token:string})|null>(null);
 const [reviewed,setReviewed]=useState(false),[result,setResult]=useState<ImportResult|null>(null),[page,setPage]=useState(0);
 const [pending,setPending]=useState<{payload:ImportPayload;requestId:string;previewToken:string}|null>(null);
 const invalidate=()=>{setPreview(null);setPending(null);setReviewed(false);setResult(null);setPage(0);};
 const rows=sheets[sheetIndex]?.data||[],headers=rows[headerRow-1]||[];
 async function load(file:File|undefined){
  if(!file)return;setBusy(true);setError('');invalidate();setSheets([]);
  try{
   if(file.size>10*1024*1024)throw new Error('Limit pliku to 10 MB. Podziel eksport lub zapisz go jako CSV.');
   const buffer=await file.arrayBuffer();let parsed:Sheet[];
   if(/\.xlsx$/i.test(file.name)){
    checkWorkbook(buffer);
    const {default:read}=await import('read-excel-file/universal');
    const workbook=await read(buffer,{parseNumber:value=>value});
    parsed=workbook.map(s=>({sheet:s.sheet,data:s.data.map(r=>r.map(c=>c===null?'':c instanceof Date?c.toISOString().slice(0,10):String(c)))}));
   }else if(/\.csv$/i.test(file.name)){
    const bytes=new Uint8Array(buffer);const actual=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':encoding;
    parsed=[{sheet:'CSV',data:parseCsv(new TextDecoder(actual,{fatal:true}).decode(buffer))}];
   }else throw new Error('Wybierz plik .xlsx lub .csv.');
   if(!parsed.length||parsed.some(s=>s.data.length>10001||s.data.some(r=>r.length>256||r.some(c=>c.length>10000))))throw new Error('Limit: 10 000 wierszy i 256 kolumn w arkuszu. Podziel plik.');
   const digest=await crypto.subtle.digest('SHA-256',buffer);
   setSourceHash(Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''));
   setSheets(parsed);setSheetIndex(0);setHeaderRow(1);setMapping(guess(parsed[0].data[0]||[]));setFrom(2);setTo(Math.min(parsed[0].data.length,1001));setFileName(file.name);
  }catch(err){setError(err instanceof TypeError?'Nie udało się odczytać pliku. Dla polskiego CSV wybierz Windows-1250 i wybierz plik ponownie.':err instanceof Error?err.message:'Nie udało się odczytać pliku.');}
  finally{setBusy(false);}
 }
 async function check(){
  setBusy(true);setError('');setResult(null);setPreview(null);setReviewed(false);setPending(null);
  try{
   if(mapping.name===undefined||mapping.name<0)throw new Error('Dopasuj kolumnę z nazwą.');
   if(from<=headerRow||to<from||to-from+1>1000)throw new Error('Wybierz do 1000 wierszy danych za nagłówkiem.');
   const mapped:ImportRow[]=rows.map((r,i)=>({r,i})).filter(({r,i})=>i+1>=from&&i+1<=to&&r.some(c=>c.trim())).map(({r,i})=>{
    const cell=(key:string)=>mapping[key]>=0?(r[mapping[key]]||'').trim():'';
    const quantity=mapping.quantity>=0?quantityOrNaN(cell('quantity'),3,0):1;
    return {row:i+1,name:cell('name'),quantity:cell('quantity')===''&&mapping.quantity>=0?-1:Number.isFinite(quantity)?quantity:-1,...Object.fromEntries(fields.filter(f=>f.key!=='name'&&f.key!=='quantity'&&mapping[f.key]>=0).map(f=>[f.key,cell(f.key)]))};
   });
   const payload:ImportPayload={sourceHash,sheet:sheets[sheetIndex].sheet,mode,...(mode==='inventory'?{unit}:{}),category:mode==='assets'?'Sprzęt':category, ...(mode==='assets'?{categoryId}:{}),...(locationId?{locationId}:{}),fixedAssets:mode==='assets'&&fixedAssets,rows:mapped};
   const value=await api<ImportPreview&{token:string}>('/api/imports/preview',{method:'POST',body:JSON.stringify(payload)},user.csrfToken);
   setPreview(value);setPage(0);setPending({payload,requestId:createUuid(),previewToken:value.token});
  }catch(err){setError(err instanceof Error?err.message:'Kontrola nie powiodła się.');}finally{setBusy(false);}
 }
 async function commit(){
  if(!pending||!reviewed)return;setBusy(true);setError('');
  try{const value=await api<ImportResult>('/api/imports/commit',{method:'POST',body:JSON.stringify(pending)},user.csrfToken);setResult(value);setPreview(null);setReviewed(false);}
  catch(err){setError(err instanceof Error?err.message:'Zapis nie powiódł się. Możesz ponowić tę samą operację.');}finally{setBusy(false);}
 }
 if(!hasPermission(user,'import.run'))return <><PageHeader title="Import danych"/><ErrorMessage message="Import jest dostępny dla IT Advanced i administratora."/></>;
 return <>
  <PageHeader eyebrow="STAN POCZĄTKOWY · CZĘŚCIOWA EWIDENCJA" title="Import Excel / CSV" description="Zacznijmy od danych, które już masz. Pozostały sprzęt uzupełnisz podczas fizycznego spisu."/>
  <div className="import-steps"><span className={sheets.length?'done':'active'}>01 · Wybierz plik</span><span className={preview?'done':sheets.length?'active':''}>02 · Dopasuj kolumny</span><span className={preview||result?'active':''}>03 · Sprawdź i zapisz</span></div>
  <div className="notice"><ShieldCheck size={20}/><span>Plik jest odczytywany w Twojej przeglądarce. Dopiero kontrola wysyła wybrane wiersze do serwera tej aplikacji. Import zachowuje obecne rekordy i nie potwierdza spisu fizycznego.</span></div>
  <ErrorMessage message={error||lookupError}/>
  {result?<section className="panel import-success"><CheckCircle2 size={36}/><h2>Zapisano stan początkowy</h2><p>Dodano {result.createdRows} pozycji, łącznie {result.createdUnits} {mode==='inventory'?unit:'szt.'} Pominięto {result.skipped} duplikatów.</p><p className="help-note">Dane wymagają fizycznej weryfikacji. Numer partii: {result.batchId}</p><div className="page-actions"><Link className="button" href={mode==='assets'?'/assets':'/inventory'}>Otwórz zapisane dane</Link><Button variant="secondary" onClick={invalidate}>Importuj kolejną partię</Button></div></section>:null}
  <fieldset disabled={busy} className="import-fieldset">
  <section className="panel import-panel"><div className="import-section-title"><FileSpreadsheet size={22}/><div><h2>1. Plik z magazynu</h2><p>XLSX lub CSV · do 10 MB · maks. 1000 wierszy w jednej partii</p></div></div>
   <div className="form-grid"><Field label="Wybierz lokalny plik"><input type="file" accept=".xlsx,.csv" onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></Field><Field label="Kodowanie CSV" hint="Po zmianie kodowania wybierz plik ponownie."><select value={encoding} onChange={e=>{setEncoding(e.target.value);invalidate();setSheets([]);}}><option value="utf-8">UTF-8</option><option value="windows-1250">Windows-1250 (polski Excel)</option></select></Field></div>
   {sheets.length>0?<p className="help-note">Wybrano: {fileName} · {rows.length} wierszy w arkuszu. Formuły nie są wykonywane. Sprawdź numery seryjne — formatowanie Excela, np. zera na początku, może nie być zachowane.</p>:null}
  </section>
  {sheets.length>0?<><section className="panel import-panel"><div className="import-section-title"><Upload size={22}/><div><h2>2. Dopasowanie danych</h2><p>Wybierz rodzaj ewidencji i kolumny eksportu.</p></div></div>
   <div className="form-grid">
    <Field label="Arkusz"><select value={sheetIndex} onChange={e=>{const i=Number(e.target.value);setSheetIndex(i);setHeaderRow(1);setMapping(guess(sheets[i].data[0]||[]));setFrom(2);setTo(Math.min(sheets[i].data.length,1001));invalidate();}}>{sheets.map((s,i)=><option key={i} value={i}>{s.sheet}</option>)}</select></Field>
    <Field label="Wiersz nagłówków"><input type="number" min="1" max={rows.length} value={headerRow} onChange={e=>{const n=Number(e.target.value);setHeaderRow(n);setMapping(guess(rows[n-1]||[]));setFrom(n+1);setTo(Math.min(rows.length,n+1000));invalidate();}}/></Field>
    <Field label="Zapisz jako"><select value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setFixedAssets(false);invalidate();}}><option value="assets">Urządzenia — każda sztuka z osobnym Asset ID</option><option value="inventory">Magazyn — produkt i ilość początkowa</option></select></Field>
    {mode==='assets'?<Field label="Kategoria urządzeń *"><select value={categoryId} onChange={e=>{setCategoryId(e.target.value);invalidate();}}><option value="">Wybierz kategorię</option>{lookups?.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>:<div><SearchSelect label="Kategoria produktu *" required value={category} options={(dictionaries.data?.categories??[]).filter(e=>e.active).map(e=>({id:e.name,label:e.name}))} onSelect={name=>{setCategory(name);invalidate();}} disabled={!dictionaries.data||!!dictionaries.error} placeholder="Wybierz kategorię magazynową…"/><ErrorMessage message={dictionaries.error} onRetry={dictionaries.reload}/></div>}
    {mode==='inventory'&&<Field label="Jednostka całej partii *" hint="Dla różnych jednostek przygotuj osobne partie."><select value={unit} disabled={!dictionaries.data||!!dictionaries.error} onChange={e=>{setUnit(e.target.value);invalidate();}}>{dictionaries.data?.units.filter(u=>u.active).map(u=><option key={u.id} value={u.name}>{u.name} — {u.label} ({u.quantityPrecision?u.quantityPrecision+' miejsca po przecinku':'całe sztuki'})</option>)}</select></Field>}
    <LocationPicker label="Lokalizacja dla tej partii" value={locationId} onChange={id=>{setLocationId(id);invalidate();}} emptyLabel="Nieustalona — do uzupełnienia"/>
    <Field label="Zakres wierszy danych"><div className="import-range"><input aria-label="Od wiersza" type="number" min={headerRow+1} value={from} onChange={e=>{setFrom(Number(e.target.value));invalidate();}}/><span>do</span><input aria-label="Do wiersza" type="number" max={rows.length} value={to} onChange={e=>{setTo(Number(e.target.value));invalidate();}}/></div></Field>
   </div>
   {mode==='assets'?<label className="import-check"><input type="checkbox" checked={fixedAssets} onChange={e=>{setFixedAssets(e.target.checked);invalidate();}}/><span>Ta partia zawiera środki trwałe. Dla brakujących numerów wygeneruj wewnętrzne ST-00000001 itd. (Numer księgowy należy później uzgodnić.)</span></label>:null}
   <div className="form-grid import-mapping">{fields.map(f=><Field key={f.key} label={f.label}><select value={mapping[f.key]??-1} onChange={e=>{setMapping({...mapping,[f.key]:Number(e.target.value)});invalidate();}}><option value={-1}>Nie importuj tej kolumny</option>{headers.map((h,i)=><option key={i} value={i}>{i+1}. {h||'(bez nagłówka)'}</option>)}</select></Field>)}</div>
   <p className="help-note">Bez numeru seryjnego / ST / SKU wykryjemy ponowne wczytanie tego samego pliku, ale zmieniony eksport może zawierać ten sam sprzęt. Porównaj go z ewidencją przed zapisem. RFID dodasz po wyborze i przypisaniu fizycznych tagów.</p>
   <Button onClick={()=>void check()} disabled={!lookups||busy||!!result}>{busy?'Przetwarzanie…':'Sprawdź wybrane dane'}</Button>
  </section></>:null}
  </fieldset>
  {preview?<section className="panel import-panel"><h2>3. Kontrola przed zapisem</h2><div className="import-totals"><span><strong>{preview.newRows}</strong> nowych pozycji / {preview.newUnits} {mode==='inventory'?unit:'szt.'}</span><span><strong>{preview.duplicates}</strong> duplikatów — pominiemy</span><span><strong>{preview.errors}</strong> błędów — popraw przed zapisem</span></div>
   <div className="table-wrap"><table><thead><tr><th>Wiersz</th><th>Nazwa</th><th>Ilość</th><th>Wynik kontroli</th></tr></thead><tbody>{preview.rows.slice(page*25,(page+1)*25).map(r=><tr key={r.row}><td>{r.row}</td><td>{r.name||'—'}</td><td>{r.quantity.toLocaleString('pl-PL')}</td><td><span className={`import-state import-${r.status}`}>{r.status==='new'?'Nowa':r.status==='duplicate'?'Duplikat':'Błąd'}</span><small className="import-reason">{r.reason}</small></td></tr>)}</tbody></table></div>
   <div className="page-actions import-pagination"><Button variant="secondary" disabled={page===0||busy} onClick={()=>setPage(page-1)}>Poprzednie</Button><span>Strona {page+1} / {Math.max(1,Math.ceil(preview.rows.length/25))}</span><Button variant="secondary" disabled={(page+1)*25>=preview.rows.length||busy} onClick={()=>setPage(page+1)}>Następne</Button></div>
   <label className="import-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/><span>Sprawdziłem podgląd, identyfikatory i ilości. Zapisuję częściowy stan początkowy wymagający fizycznej weryfikacji.</span></label>
   <Button disabled={busy||!reviewed||preview.errors>0||preview.newRows===0} onClick={()=>void commit()}>{busy?'Zapisywanie…':`Zapisz ${preview.newRows} nowych pozycji do obecnej bazy`}</Button>
  </section>:null}
 </>;
}
