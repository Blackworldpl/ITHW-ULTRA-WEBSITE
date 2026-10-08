"use client";
import {createUuid} from '@/shared/uuid';
import {hasPermission} from '@/shared/permissions';

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  MapPin,
  Minus,
  Pencil,
  ClipboardCheck,
  Plus,
  Truck,
} from "lucide-react";
import type { History, InventoryItem } from "@/shared/types";
import { useApp } from "./context";
import {LocationPicker} from './pickers';
import {
  api,
  Button,
  EmptyState,
  ErrorMessage,
  Field,
  HistoryList,
  Loading,
  Modal,
  QRLabel,
  SuccessMessage,
  useResource,
} from "./ui";

export {InventoryListScreen} from './inventory-workbench';
export {InventoryForm} from './inventory-product-form';
import {InventoryForm} from './inventory-product-form';
import {quantityValue,quantityOrNaN,subtractQuantity,addQuantity} from '@/shared/quantity';
export function InventoryDetailScreen({ slug }: { slug: string }) {
  const searchParams=useSearchParams(),returnTo=searchParams.get('returnTo')||'';
  const backHref=returnTo==='/inventory'||returnTo.startsWith('/inventory?')?returnTo:'/inventory';
  const { user } = useApp();
  const resource = useResource<InventoryItem>(
    `/api/inventory/${encodeURIComponent(slug)}`,
  );
  const history = useResource<History[]>(
    `/api/inventory/${encodeURIComponent(slug)}/history`,
  );
  const [quantityText, setQuantityText] = useState('1');
  const quantity=quantityOrNaN(quantityText,resource.data?.quantityPrecision??0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const retry = useRef<{
    delta: number;
    note: string;
    requestId: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editing,setEditing]=useState(false);
  const [correcting,setCorrecting]=useState(false);
  const item = resource.data;
  async function move(direction: 1 | -1) {
    if (lock.current) return;
    if (!Number.isFinite(quantity)) {
      setError("Wpisz dodatnią ilość zgodną z jednostką produktu.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const delta = quantity * direction;
    const input =
      retry.current?.delta === delta && retry.current?.note === note
        ? retry.current
        : { delta, note, requestId: createUuid() };
    retry.current = input;
    try {
      await api<InventoryItem>(
        `/api/inventory/${encodeURIComponent(slug)}/movements`,
        { method: "POST", body: JSON.stringify(input) },
        user.csrfToken,
      );
      retry.current = null;
      resource.reload();
      history.reload();
      setSuccess(
        `${direction < 0 ? "Pobrano" : "Oddano"} ${quantity.toLocaleString('pl-PL')} ${item?.unit || "szt."} Ruch zapisano w historii.`,
      );
      setNote("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (resource.loading && !item) return <Loading />;
  return (
    <>
      <Link href={backHref} className="back-link">
        <ArrowLeft size={15} />
        Wróć do magazynu
      </Link>
      <ErrorMessage message={resource.error} onRetry={resource.reload} />
      {item && (
        <>
          <div className="record-heading">
            <div className="record-icon">
              <Boxes size={32} />
            </div>
            <div>
              <div className="eyebrow">{item.category}</div>
              <h1>{item.name}</h1>
              <div className="record-id">
                <span className="mono">{item.sku||item.productCode||item.slug}</span>
                {item.productCode&&<span className="badge">Kod produktu: {item.productCode}</span>}
                {item.stock <= item.minimalStock && (
                  <span className="badge low-badge">
                    <AlertTriangle size={11} />
                    Niski stan
                  </span>
                )}
              </div>
            </div>
          </div>
          {hasPermission(user,'inventory.edit')&&<div className="quick-asset-actions"><Button variant="secondary" onClick={()=>setEditing(true)}><Pencil size={16}/>Edytuj produkt</Button><Button variant="secondary" onClick={()=>setCorrecting(true)}><ClipboardCheck size={16}/>Korekta po przeliczeniu</Button></div>}
          {editing&&<InventoryForm item={item} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);resource.reload();setSuccess('Zapisano dane produktu.');}}/>}
          {correcting&&<StockCorrectionModal item={item} onClose={()=>setCorrecting(false)} onSaved={()=>{setCorrecting(false);resource.reload();history.reload();setSuccess('Korekta stanu zapisana w historii.');}}/>}
          <div className="split-grid">
            <div>
              <section className="movement-controls">
                <div className="inventory-meta">
                  <span>
                    <MapPin
                      size={13}
                      style={{ verticalAlign: "middle", marginRight: 5 }}
                    />
                    {item.locationName || "Nie przypisano lokalizacji"}
                  </span>
                  <span>
                    Minimum: {item.minimalStock.toLocaleString('pl-PL')} {item.unit}
                  </span>
                </div>
                <div className="eyebrow">AKTUALNY STAN</div>
                <div className="inventory-stock">
                  <strong>{item.stock.toLocaleString('pl-PL')}</strong>
                  <span>{item.unit}</span>
                </div>
                {item.stock <= item.minimalStock && (
                  <div className="stock-minimum">
                    <AlertTriangle size={16} />
                    {item.stock < item.minimalStock
                      ? `Brakuje ${subtractQuantity(item.minimalStock,item.stock).toLocaleString('pl-PL')} ${item.unit} do minimalnego stanu.`
                      : "Stan osiągnął minimum. Zaplanuj uzupełnienie."}
                  </div>
                )}
                <ErrorMessage message={error} />
                <SuccessMessage message={success} />
                {hasPermission(user,'inventory.move') ? (
                  <>
                    <div className="quantity-select">
                      <span
                        className="muted"
                        style={{ fontSize: 11, marginRight: 5 }}
                      >
                        Ilość
                      </span>
                      {(item.quantityPrecision?[0.1,0.5,1,5]:[1,5,10]).map((value) => (
                        <button
                          key={value}
                          className={quantity === value ? "active" : ""}
                          onClick={() => setQuantityText(String(value))}
                          disabled={busy}
                        >
                          {value.toLocaleString('pl-PL')}
                        </button>
                      ))}
                      <input
                        type="text"
                        inputMode={item.quantityPrecision?"decimal":"numeric"}
                        value={quantityText}
                        aria-label="Własna ilość"
                        onChange={(event) =>
                          setQuantityText(event.target.value)
                        }
                        disabled={busy}
                      />
                    </div>
                    <Field label="Notatka do ruchu (opcjonalnie)">
                      <input
                        value={note}
                        maxLength={1000}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="np. Wydanie do stanowiska pakowania"
                        disabled={busy}
                      />
                    </Field>
                    <div className="movement-actions">
                      <button
                        className="movement-button take"
                        onClick={() => move(-1)}
                        disabled={
                          busy ||
                          quantity > item.stock ||
                          !Number.isFinite(quantity)
                        }
                      >
                        <Minus />
                        <span>
                          −{Number.isFinite(quantity)?quantity.toLocaleString('pl-PL'):"…"}
                          <small>POBIERAM</small>
                        </span>
                      </button>
                      <button
                        className="movement-button"
                        onClick={() => move(1)}
                        disabled={
                          busy || !Number.isFinite(quantity) || addQuantity(item.stock,quantity)>10000000
                        }
                      >
                        <Plus />
                        <span>
                          +{Number.isFinite(quantity)?quantity.toLocaleString('pl-PL'):"…"}
                          <small>ODDAJĘ</small>
                        </span>
                      </button>
                    </div>
                    <p className="movement-help">
                      {busy
                        ? "Zapisywanie ruchu…"
                        : `Każdy ruch zapisuje użytkownika, datę i nowy stan magazynu.`}
                    </p>
                  </>
                ) : (
                  <div className="notice notice-info">
                    Twoja rola pozwala przeglądać stany i historię. Pobrania i
                    zwroty są dostępne dla użytkowników IT.
                  </div>
                )}
              </section>
              {item.notes && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Uwagi</h2>
                  </div>
                  <p
                    className="panel-body"
                    style={{ fontSize: 12, whiteSpace: "pre-wrap" }}
                  >
                    {item.notes}
                  </p>
                </section>
              )}
              <section className="panel" id="inventory-history">
                <div className="panel-heading">
                  <div>
                    <h2>Historia magazynowa</h2>
                    <p>Pobrania, zwroty, przyjęcia, import i korekty stanu.</p>
                  </div>
                    <a
                      href={`/api/inventory/${item.slug}/history/export`}
                      className="subtle-link"
                    >
                      Historia tego produktu · CSV
                      <ArrowUpRight size={14} />
                    </a>
                </div>
                <ErrorMessage message={history.error} />
                {history.loading && !history.data ? (
                  <Loading />
                ) : (
                  <HistoryList items={history.data || []} />
                )}
              </section>
            </div>
            <aside>
              {hasPermission(user,'inventory.edit') && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Etykieta pojemnika</h2>
                  </div>
                  <QRLabel type="inventory" id={item.slug} name={item.name} />
                </section>
              )}
              <section className="panel">
                <div className="panel-heading">
                  <h2>Przyjęcie towaru</h2>
                </div>
                <div className="panel-body">
                  <p className="help-note">
                    Dostawa wiąże towar z fakturą i automatycznie zwiększa stan
                    magazynowy.
                  </p>
                  {hasPermission(user,'inventory.edit') && (
                    <Link
                      href="/deliveries?receive=1"
                      className="button button-secondary"
                    >
                      <Truck size={15} />
                      Przyjmij dostawę
                    </Link>
                  )}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export function StockCorrectionModal({item,onClose,onSaved}:{item:InventoryItem;onClose:()=>void;onSaved:()=>void}) {
  const {user}=useApp();
  const [stock,setStock]=useState(String(item.stock));
  const [note,setNote]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const retry=useRef<{stock:number;expectedStock:number;note:string;requestId:string}|null>(null);
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    let value:number;try{value=quantityValue(stock,item.quantityPrecision,0,10000000);}catch(failure){setError((failure as Error).message);setBusy(false);return;}
    const body=retry.current?.stock===value&&retry.current?.note===note?retry.current:{stock:value,expectedStock:item.stock,note,requestId:createUuid()};
    retry.current=body;
    try {await api(`/api/inventory/${item.slug}/correction`,{method:'POST',body:JSON.stringify(body)},user.csrfToken);onSaved();}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  const counted=quantityOrNaN(stock,item.quantityPrecision,0,10000000),delta=Number.isFinite(counted)?subtractQuantity(counted,item.stock):NaN;
  return <Modal title="Korekta stanu po przeliczeniu" onClose={()=>{if(!busy)onClose();}}><form onSubmit={submit}>
    <p className="help-note">{item.name} · obecnie {item.stock.toLocaleString('pl-PL')} {item.unit}. Wpisz faktycznie policzony stan.</p><ErrorMessage message={error}/>
    <Field label="Nowy stan *"><input required type="text" inputMode={item.quantityPrecision?"decimal":"numeric"} value={stock} onChange={e=>setStock(e.target.value)}/></Field>
    <Field label="Powód korekty *"><textarea required minLength={3} maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} placeholder="np. Przeliczenie pojemnika, rozbieżność z ewidencją"/></Field>
    <div className="notice notice-info">Zmiana: {delta>0?'+':''}{Number.isFinite(delta)?delta.toLocaleString('pl-PL'):'—'} {item.unit}. Powód, autor i stan po korekcie zostaną zapisane w historii.</div>
    <div className="form-actions"><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Anuluj</Button><Button type="submit" disabled={busy||stock===''||delta===0}>{busy?'Zapisywanie…':'Zatwierdź korektę'}</Button></div>
  </form></Modal>;
}
