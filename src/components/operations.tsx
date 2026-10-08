"use client";
import {InvoiceSerialModal} from './purchase-serials';
import {InvoiceStockModal} from './purchase-stock';
import {deliveryQuantities} from '@/shared/purchase';
import {integerQuantity} from '@/shared/quantity';
import {invoiceTotal,normalizedMoney} from '@/shared/money';
import {hasPermission} from '@/shared/permissions';

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {useRouter} from 'next/navigation';
import {InvoiceComposer} from './invoice-composer';
import {AssetLinker} from './asset-linker';
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  Cpu,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
} from "lucide-react";
import type {
  Delivery,
  Invoice,
  InvoiceDetail,
  InvoiceLine,
  InventoryItem,
  PageResult,
} from "@/shared/types";
import { useApp, canEdit } from "./context";
import { InvoiceDocuments } from './invoice-documents';
import {LocationPicker} from './pickers';
import {
  api,
  Button,
  EmptyState,
  ErrorMessage,
  DetailsGrid,
  Field,
  formatDate,
  formatMoney,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  StatusBadge,
  SuccessMessage,
  useResource,
} from "./ui";

export function DeliveryScreen() {
  const searchParams = useSearchParams();
  const { user } = useApp();
  const [receiving, setReceiving] = useState(
    searchParams.get("receive") === "1",
  );
  const [page, setPage] = useState(1);
  const [success, setSuccess] = useState("");
  const { data, error, loading, reload } = useResource<PageResult<Delivery>>(
    `/api/deliveries?page=${page}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="PRZYJĘCIA TOWARU"
        title="Dostawy"
        description="Przyjęcie sprzętu i materiałów z automatyczną aktualizacją stanów."
        actions={
          hasPermission(user,'invoice.edit') && (
            <Button onClick={() => setReceiving(true)}>
              <Plus size={17} />
              Przyjmij dostawę
            </Button>
          )
        }
      />
      <SuccessMessage message={success} />
      <ErrorMessage message={error} />
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Rejestr przyjęć{" "}
            <span className="count-pill">{data?.total ?? "—"}</span>
          </h2>
          <Link href="/invoices" className="subtle-link">
            Faktury <ArrowUpRight size={14} />
          </Link>
        </div>
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Dokument / dostawca</th>
                    <th>Data przyjęcia</th>
                    <th>Przyjęte ilości</th>
                    <th>Przyjął</th>
                    <th>Uwagi</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>
                        <Link
                          href={`/invoice/${delivery.invoiceId}`}
                          className="table-title"
                        >
                          {delivery.invoiceNumber}
                        </Link>
                        <small>{delivery.supplierName}</small>
                      </td>
                      <td>{formatDate(delivery.receivedAt, true)}</td>
                      <td>{deliveryQuantities(delivery)}</td>
                      <td>{delivery.receivedBy}</td>
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {delivery.notes || "—"}
                      </td>
                      <td>
                        <Link
                          href={`/invoice/${delivery.invoiceId}`}
                          className="icon-button"
                          aria-label={`Otwórz fakturę ${delivery.invoiceNumber}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={data.total}
              page={page}
              pageSize={data.pageSize}
              onChange={setPage}
            />
          </>
        ) : (
          !error && (
            <EmptyState
              title="Gotowi na pierwszą dostawę"
              description="Wpisz fakturę i pozycje. System utworzy ewidencję urządzeń, zwiększy stany i zapisze historię w jednej operacji."
              action={
                hasPermission(user,'invoice.edit') ? (
                  <Button
                    variant="secondary"
                    onClick={() => setReceiving(true)}
                  >
                    <Truck size={16} />
                    Przyjmij dostawę
                  </Button>
                ) : undefined
              }
            />
          )
        )}
      </section>
      {receiving && hasPermission(user,'invoice.edit') && (
        <ReceiveDeliveryForm
          onClose={() => setReceiving(false)}
          onSaved={(delivery) => {
            setReceiving(false);
            setSuccess(
              `Zapisano fakturę ${delivery.number}. Przyjęte ilości są widoczne na liście dostaw.`,
            );
            reload();
          }}
        />
      )}
    </>
  );
}

export function ReceiveDeliveryForm({onClose,onSaved}:{onClose:()=>void;onSaved:(invoice:Invoice)=>void}){return <InvoiceComposer initialReceive onClose={onClose} onSaved={onSaved}/>;}

export function InvoiceScreen({ id }: { id?: string }) {
  return id ? <InvoiceDetailScreen id={id} /> : <InvoiceListScreen />;
}
function InvoiceListScreen() {
  const router=useRouter();
  const [query,setQuery]=useState(''),[debounced,setDebounced]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>{setDebounced(query);setPage(1);},180);return()=>clearTimeout(timer);},[query]);
  const [page, setPage] = useState(1);
  const [creating,setCreating]=useState(false),[success,setSuccess]=useState('');
  const { user,refreshLookups } = useApp();
  const { data, error, loading,reload } = useResource<PageResult<Invoice>>(
    `/api/invoices?page=${page}&q=${encodeURIComponent(debounced)}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="DOKUMENTY ZAKUPU"
        title="Faktury"
        description="FV zakupu i przypisany sprzęt. Dokumenty PDF dostępne także po zeskanowaniu urządzenia."
        actions={
          hasPermission(user,'invoice.edit') && (
            <Button onClick={()=>setCreating(true)}>
              <Plus size={17} />
              Dodaj fakturę
            </Button>
          )
        }
      />
      <ErrorMessage message={error} onRetry={reload} />
      <SuccessMessage message={success}/>
      {creating&&<InvoiceComposer onClose={()=>setCreating(false)} onSaved={invoice=>{setCreating(false);reload();refreshLookups(['suppliers','locations']);router.push(`/invoice/${invoice.id}`);}}/>}
      <div className="toolbar"><div className="toolbar-search"><input aria-label="Szukaj faktur" placeholder="Numer FV lub kontrahent…" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
      <section className="panel">
        <div className="panel-heading">
          <h2>
            Rejestr faktur{" "}
            <span className="count-pill">{data?.total ?? "—"}</span>
          </h2>
          <span className="muted" style={{ fontSize: 10 }}>
            Kwoty zgodnie z dokumentami
          </span>
        </div>
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Numer faktury / dostawca</th>
                    <th>Data</th>
                    <th>Kwota</th>
                    <th>Zamówienie</th>
                    <th>Przyjął</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link
                          href={`/invoice/${invoice.id}`}
                          className="table-title"
                        >
                          {invoice.number}
                        </Link>
                        <small>{invoice.supplierName}</small>
                      </td>
                      <td>{formatDate(invoice.date)}</td>
                      <td>{formatMoney(invoice.amount, invoice.currency)}</td>
                      <td>{invoice.orderNumber || "—"}</td>
                      <td>{invoice.receivedBy}</td>
                      <td>
                        <Link
                          href={`/invoice/${invoice.id}`}
                          className="icon-button"
                          aria-label={`Otwórz fakturę ${invoice.number}`}
                        >
                          <ArrowUpRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              total={data.total}
              page={page}
              pageSize={data.pageSize}
              onChange={setPage}
            />
          </>
        ) : (
          !error && (
            <EmptyState
              title="Dokumenty pod ręką"
              description="Dodaj dane dokumentu, pozycje i PDF w jednym formularzu. Możesz również przyjąć nowy zakup do ewidencji."
              action={
                hasPermission(user,'invoice.edit') ? (
                  <Button variant="secondary" onClick={()=>setCreating(true)}><Plus size={16}/>Dodaj fakturę</Button>
                ) : undefined
              }
            />
          )
        )}
      </section>
    </>
  );
}
function InvoiceDetailScreen({ id }: { id: string }) {
  const {user,refreshLookups}=useApp();
  const [editing,setEditing]=useState(false),[serialLine,setSerialLine]=useState<InvoiceLine|null>(null),[stockLine,setStockLine]=useState<InvoiceLine|null>(null);
  const {
    data: invoice,
    error,
    loading,
    reload,
  } = useResource<InvoiceDetail>(`/api/invoices/${encodeURIComponent(id)}`);
  if (loading && !invoice) return <Loading />;
  return (
    <>
      <Link href="/invoices" className="back-link">
        <ArrowLeft size={15} />
        Wróć do faktur
      </Link>
      <ErrorMessage message={error} onRetry={reload}/>
      {invoice && (
        <>
          <div className="record-heading">
            <div className="record-icon">
              <ReceiptText size={30} />
            </div>
            <div>
              <div className="eyebrow">DOKUMENT ZAKUPU</div>
              <h1>{invoice.number}</h1>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {invoice.supplierName}
              </p>
            </div>
            {hasPermission(user,'invoice.edit')&&<Button variant="secondary" onClick={()=>setEditing(true)}>Edytuj fakturę</Button>}
          </div>
          {editing&&<InvoiceComposer invoice={invoice} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);reload();refreshLookups(['suppliers','locations']);}}/>}
          <section className="panel">
            <div className="invoice-summary">
              <div>
                <small>Data faktury</small>
                <strong>{formatDate(invoice.date)}</strong>
              </div>
              <div>
                <small>Kwota</small>
                <strong>{formatMoney(invoice.amount, invoice.currency)}</strong>
              </div>
              <div>
                <small>Numer zamówienia</small>
                <strong>{invoice.orderNumber || "—"}</strong>
              </div>
              <div>
                <small>Przyjął</small>
                <strong>{invoice.receivedBy}</strong>
              </div>
            </div>
            <div className="panel-heading">
              <h2>Pozycje dokumentu</h2>
              <span className="count-pill">{invoice.items.length}</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pozycja</th>
                    <th>Rodzaj</th>
                    <th>Ilość</th>
                    <th>Cena jednostkowa</th>
                    <th>Wartość</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <strong className="table-title">{line.position}. {line.name}</strong>{line.inventoryItemName&&<small>Kartoteka: {line.inventoryItemSlug?<Link className="text-link" href={"/inventory/"+line.inventoryItemSlug}>{line.inventoryItemName}</Link>:line.inventoryItemName}</small>}{line.categoryId&&<div><small>Powiązano {line.assetIds?.length??0} z {line.quantity}</small>{(line.assetIds??[]).map(assetId=><Link className="text-link" style={{display:"block"}} key={assetId} href={"/asset/"+assetId}>{assetId} · SN {invoice.assets.find(a=>a.assetId===assetId)?.serialNumber||"—"}</Link>)}{hasPermission(user,"invoice.edit")&&hasPermission(user,"asset.view")&&<Button variant="ghost" onClick={()=>setSerialLine(line)}>Numery seryjne / powiązania</Button>}</div>}
                      </td>
                      <td>
                        <span className="badge">
                          {line.inventoryItemId ? (
                            <>
                              <Boxes size={11} />
                              Magazyn
                            </>
                          ) : line.categoryId ? (
                            <>
                              <Cpu size={11} />
                              Urządzenie
                            </>
                          ) : <>Dokument / usługa</>}
                        </span>
                        {line.inventoryItemId&&<div><small>Przyjęto {(line.receivedQuantity??0).toLocaleString('pl-PL')} z {line.quantity.toLocaleString('pl-PL')} {line.unit}</small>{(line.receivedQuantity??0)<line.quantity&&hasPermission(user,'invoice.edit')&&hasPermission(user,'inventory.move')&&<Button variant="ghost" onClick={()=>setStockLine(line)}>Przyjmij produkt</Button>}</div>}
                      </td>
                      <td>{line.quantity.toLocaleString('pl-PL')} {line.unit}</td>
                      <td>{formatMoney(line.unitPrice, invoice.currency)}</td>
                      <td>
                        {formatMoney(
                          line.unitPrice===null?null:invoiceTotal([{quantity:line.quantity,unitPrice:line.unitPrice}]),
                          invoice.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="invoice-total">
              Wartość faktury
              <strong>{formatMoney(invoice.amount, invoice.currency)}</strong>
            </div>
          </section>
          {serialLine&&<InvoiceSerialModal invoice={invoice} line={serialLine} onClose={()=>setSerialLine(null)} onSaved={()=>{setSerialLine(null);reload();}}/>}
          {stockLine&&<InvoiceStockModal invoice={invoice} line={stockLine} onClose={()=>setStockLine(null)} onSaved={()=>{setStockLine(null);reload();refreshLookups(['locations']);}}/>}
          {invoice.notes&&<section className="panel"><div className="panel-heading"><h2>Uwagi do faktury</h2></div><p className="panel-body">{invoice.notes}</p></section>}
          {invoice.supplier&&<section className="panel"><div className="panel-heading"><h2>Dane kontrahenta</h2></div><DetailsGrid entries={[["Firma",invoice.supplier.name],["NIP / VAT ID",invoice.supplier.taxId],["REGON",invoice.supplier.regon],["Adres",[invoice.supplier.street,invoice.supplier.postalCode,invoice.supplier.city,invoice.supplier.country].filter(Boolean).join(', ')],["Osoba kontaktowa",invoice.supplier.contactName],["E-mail",invoice.supplier.email],["Telefon",invoice.supplier.phone],["Konto / IBAN",invoice.supplier.bankAccount]]}/></section>}
          <section className="panel">
            <div className="panel-heading">
              <h2>Urządzenia z tej faktury</h2>
              <span className="count-pill">{invoice.assets.length}</span>
            </div>
            {hasPermission(user,'invoice.edit')&&(!invoice.items.length||invoice.items.some(l=>l.categoryId))&&<div className="panel-body">{invoice.items.some(l=>l.categoryId)?<p className="help-note">Sprzęt dopasuj przez „Numery seryjne / powiązania” przy konkretnej pozycji dokumentu.</p>:<AssetLinker mode="invoice" targetId={invoice.id} targetName={invoice.number} onSaved={reload}/>}</div>}
            {invoice.assets.length ? (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Urządzenie / Asset ID</th>
                      <th>Numer seryjny</th>
                      <th>Status</th>
                      <th>Lokalizacja</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.assets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          <Link
                            href={`/asset/${asset.assetId}`}
                            className="table-title"
                          >
                            {asset.name}
                          </Link>
                          <small className="mono">{asset.assetId}</small>
                        </td>
                        <td className="mono">{asset.serialNumber || "—"}</td>
                        <td>
                          <StatusBadge status={asset.status} />
                        </td>
                        <td>{asset.locationName || "—"}</td>
                        <td>
                          <Link
                            href={`/asset/${asset.assetId}`}
                            className="icon-button"
                            aria-label={`Otwórz ${asset.name}`}
                          >
                            <ArrowUpRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="small-empty">
                Dokument nie zawiera indywidualnie ewidencjonowanych urządzeń.
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Powiązane przyjęcia</h2>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Data przyjęcia</th>
                    <th>Przyjął</th>
                    <th>Przyjęte ilości</th>
                    <th>Uwagi</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>{formatDate(delivery.receivedAt, true)}</td>
                      <td>{delivery.receivedBy}</td>
                      <td>{deliveryQuantities(delivery)}</td>
                      <td>{delivery.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <InvoiceDocuments invoiceId={invoice.id} allowUpload/>
        </>
      )}
    </>
  );
}

