"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Cpu,
  MapPin,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Asset, AssetStatus, History, PageResult } from "@/shared/types";
import { useApp, canEdit, canMove } from "./context";
import { AssetActions } from './asset-actions';
import {hasPermission} from '@/shared/permissions';
import {AssetRecordMenu,BulkAssetToolbar,AssetViews} from './asset-tools';
import {DocumentsScreen} from './library';
import {AssetConfigurationPanel,AssetServicePanel} from './asset-library';
import { CopyValue } from './experience';
import { InvoiceDocuments } from './invoice-documents';
import {CategoryInputs} from './category-inputs';
import {EmployeePicker,InvoicePicker,LocationPicker} from './pickers';
import {assetFieldVisible,categoryAssetBody,standardFieldKeys,type StandardFieldKey} from '@/shared/asset-fields';
import {
  api,
  Button,
  DetailsGrid,
  EmptyState,
  ErrorMessage,
  Field,
  formatDate,
  formatMoney,
  HistoryList,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  QRLabel,
  StatusBadge,
  statusLabels,
  SuccessMessage,
  useResource,
} from "./ui";

const filterKeys=['status','locationId','categoryId','invoiceId','supplierId','manufacturer','model','owner','employeeId','purchasedFrom','purchasedTo','warranty','fixed','includeChildren','active','noLocation','sort'];
const initialFilters=(params:{get:(key:string)=>string|null})=>Object.fromEntries(filterKeys.map(key=>[key,params.get(key)||'']));
export function AssetListScreen() {
  const searchParams = useSearchParams();
  const { user, lookups, lookupError } = useApp();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [debounced, setDebounced] = useState(query);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters(searchParams));
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(searchParams.get("create") === "1");
  const [success, setSuccess] = useState("");
  const [selected,setSelected]=useState<Record<string,Asset>>({}),[editingRow,setEditingRow]=useState<Asset|null>(null);
  const [columns, setColumns] = useState({ model: true, serial: true, location: true, owner: true, warranty: true, purchase: false, invoice: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("ith-asset-columns:"+user.id) || "null");
      if (saved && typeof saved === "object") setColumns(previous => Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, typeof saved[key] === "boolean" ? saved[key] : value])) as typeof previous);
    } catch { /* Column preferences are optional. */ }
  }, [user.id]);
  function toggleColumn(key: keyof typeof columns) {
    setColumns(previous => {
      const next = { ...previous, [key]: !previous[key] };
      try { localStorage.setItem("ith-asset-columns:"+user.id, JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
      return next;
    });
  }
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebounced(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
    setFilters(initialFilters(searchParams));
    setPage(1);
    if (searchParams.get("create") === "1") setCreating(true);
  }, [searchParams]);
  const params = new URLSearchParams({
    q: debounced,
    page: String(page),
    pageSize: "25",
  });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const { data, error, loading, reload } = useResource<PageResult<Asset>>(
    `/api/assets?${params}`,
  );
  function filter(key: string, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  }
  const filterCount = Object.entries(filters).filter(([key,value])=>value&&key!=='sort'&&!(key==='includeChildren'&&value==='false')).length;
  return (
    <>
      <PageHeader
        eyebrow="EWIDENCJA SPRZĘTU"
        title="Urządzenia"
        description="Każdy sprzęt ma swój identyfikator, lokalizację i pełną historię."
        actions={
          (
            <>
            {hasPermission(user,'import.run')&&<Link href="/import" className="button button-secondary">Import Excel / CSV</Link>}
            {hasPermission(user,'asset.export')&&<a href={`/api/assets/export?${params}`} className="button button-secondary" download>Eksport wyników CSV</a>}
            {hasPermission(user,'asset.create')&&<Button onClick={() => setCreating(true)}>
              <Plus size={17} />
              Dodaj urządzenie
            </Button>}
            </>
          )
        }
      />
      <SuccessMessage message={success} />
      <BulkAssetToolbar selected={selected} onClear={()=>setSelected({})} onSaved={message=>{setSuccess(message);reload();}}/>
      <ErrorMessage message={lookupError} />
      <div className="toolbar">
        <div className="toolbar-search">
          <Search size={17} />
          <input
            placeholder="Nazwa, Asset ID, serial, RFID…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Szukaj urządzeń"
          />
        </div>
        <select
          value={filters.status || ""}
          onChange={(event) => filter("status", event.target.value)}
          aria-label="Filtr statusu"
        >
          <option value="">Wszystkie statusy</option>
          {(Object.keys(statusLabels) as AssetStatus[]).map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
        <select
          value={filters.categoryId || ""}
          onChange={(event) => filter("categoryId", event.target.value)}
          aria-label="Filtr kategorii"
        >
          <option value="">Wszystkie kategorie</option>
          {lookups?.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <Button variant="secondary" aria-expanded={expanded} aria-controls="asset-filters" onClick={() => setExpanded(!expanded)}>
          <SlidersHorizontal size={16} />
          Filtry
          {filterCount > 0 && <span className="count-pill">{filterCount}</span>}
        </Button>
        <AssetViews value={{q:query,filters,columns}} onApply={v=>{setQuery(v.q);setFilters(Object.fromEntries(filterKeys.map(k=>[k,typeof v.filters[k]==='string'?v.filters[k]:''])));setColumns(prev=>Object.fromEntries(Object.entries(prev).map(([k,x])=>[k,typeof v.columns[k]==='boolean'?v.columns[k]:x])) as typeof prev);setPage(1);}}/>
        <select aria-label="Sortowanie urządzeń" value={filters.sort||'newest'} onChange={event=>filter('sort',event.target.value)}><option value="newest">Najnowsze</option><option value="oldest">Najstarsze</option><option value="name">Nazwa A–Z</option><option value="assetId">Asset ID</option><option value="warranty">Koniec gwarancji</option><option value="name-desc">Nazwa Z–A</option><option value="serial">Numer seryjny A–Z</option><option value="location">Lokalizacja A–Z</option><option value="owner">Odbiorca A–Z</option><option value="serial-desc">Numer seryjny Z–A</option><option value="location-desc">Lokalizacja Z–A</option><option value="owner-desc">Odbiorca Z–A</option><option value="updated">Ostatnia zmiana</option></select>
      </div>
      {expanded && (
        <section id="asset-filters" className="filter-panel">
          <div className="form-grid">
            <LocationPicker value={filters.locationId||''} onChange={id=>filter('locationId',id)} emptyLabel="Wszystkie lokalizacje"/>
            <Field label="Zakres lokalizacji"><select value={filters.includeChildren||'false'} onChange={event=>filter('includeChildren',event.target.value)}><option value="false">Tylko wybrana lokalizacja</option><option value="true">Wraz z poziomami podrzędnymi</option></select></Field>
            <Field label="Brak lokalizacji"><select value={filters.noLocation||''} onChange={event=>filter('noLocation',event.target.value)}><option value="">Wszystkie urządzenia</option><option value="true">Tylko bez przypisanej lokalizacji</option></select></Field>
            <Field label="Środki trwałe"><select value={filters.fixed||''} onChange={event=>filter('fixed',event.target.value)}><option value="">Cała ewidencja</option><option value="true">Tylko środki trwałe</option><option value="false">Pozostałe wyposażenie</option></select></Field>
            <Field label="Sprzęt aktywny"><select value={filters.active||''} onChange={event=>filter('active',event.target.value)}><option value="">Wszystkie statusy</option><option value="true">Pomiń zutylizowany</option></select></Field>
            <Field label="Producent">
              <input
                value={filters.manufacturer || ""}
                onChange={(event) => filter("manufacturer", event.target.value)}
                placeholder="np. Lenovo"
              />
            </Field>
            <Field label="Model">
              <input
                value={filters.model || ""}
                onChange={(event) => filter("model", event.target.value)}
              />
            </Field>
            <EmployeePicker employeeId={filters.employeeId||''} owner={filters.owner||''} onChange={(id,name)=>{setFilters(previous=>({...previous,employeeId:id,owner:id?'':name}));setPage(1);}}/>
            <Field label="Dostawca">
              <select
                value={filters.supplierId || ""}
                onChange={(event) => filter("supplierId", event.target.value)}
              >
                <option value="">Wszyscy dostawcy</option>
                {lookups?.suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <InvoicePicker value={filters.invoiceId||''} onChange={id=>filter('invoiceId',id)}/>
            <Field label="Data zakupu od">
              <input
                type="date"
                value={filters.purchasedFrom || ""}
                onChange={(event) =>
                  filter("purchasedFrom", event.target.value)
                }
              />
            </Field>
            <Field label="Data zakupu do">
              <input
                type="date"
                value={filters.purchasedTo || ""}
                onChange={(event) => filter("purchasedTo", event.target.value)}
              />
            </Field>
            <Field label="Gwarancja">
              <select
                value={filters.warranty || ""}
                onChange={(event) => filter("warranty", event.target.value)}
              >
                <option value="">Wszystkie</option>
                <option value="expired">Po gwarancji</option>
                <option value="soon">Kończy się w 30 dni</option>
                <option value="valid">Ponad 30 dni gwarancji</option>
                <option value="none">Brak danych o gwarancji</option>
              </select>
            </Field>
          </div>
          <div className="form-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({});
                setQuery("");
                setPage(1);
              }}
            >
              Wyczyść filtry
            </Button>
            <Button variant="secondary" onClick={() => setExpanded(false)}>
              Zamknij filtry
            </Button>
          </div>
        </section>
      )}
      {filterCount > 0 && !expanded && (
        <p className="help-note">
          Aktywne filtry: {filterCount}.{" "}
          <button
            className="icon-button text-green"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
          >
            Wyczyść
          </button>
        </p>
      )}
      <ErrorMessage message={error} onRetry={reload} />
      <section className="panel asset-list-panel" aria-busy={loading}>
        <div className="panel-heading">
          <h2>
            Baza sprzętu{" "}
            <span className="count-pill">{data?.total ?? "—"}</span>
          </h2>
          <div className="row-actions"><details className="column-settings"><summary>Kolumny</summary><div>{(Object.entries({ model: "Model", serial: "Numer seryjny", location: "Lokalizacja", owner: "Użytkownik", warranty: "Gwarancja", purchase: "Data zakupu", invoice: "Faktura" }) as [keyof typeof columns, string][]).map(([key, label]) => <label key={key} className="checkbox-inline"><input type="checkbox" checked={columns[key]} onChange={() => toggleColumn(key)}/>{label}</label>)}</div></details><span className="muted" style={{ fontSize: 11 }}>
            {loading && data ? "Odświeżanie…" : "25 rekordów na stronę"}
          </span></div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="selection-cell"><input type="checkbox" aria-label="Zaznacz urządzenia na stronie" checked={data.items.every(a=>!!selected[a.assetId])} onChange={e=>setSelected(v=>{const copy={...v};if(e.target.checked){for(const a of data.items)if(Object.keys(copy).length<100||copy[a.assetId])copy[a.assetId]=a;}else for(const a of data.items)delete copy[a.assetId];return copy;})}/></th>
                    <th><button className="sort-heading" onClick={()=>filter('sort',filters.sort==='name'?'name-desc':'name')}>Urządzenie / Asset ID {filters.sort==='name'?'↑':filters.sort==='name-desc'?'↓':''}</button></th>
                    <th>Status</th>
                    {columns.model && <th>Model</th>}
                    {columns.serial && <th><button className="sort-heading" onClick={()=>filter('sort',filters.sort==='serial'?'serial-desc':'serial')}>Numer seryjny {filters.sort==='serial'?'↑':filters.sort==='serial-desc'?'↓':'↕'}</button></th>}
                    {columns.location && <th><button className="sort-heading" onClick={()=>filter('sort',filters.sort==='location'?'location-desc':'location')}>Lokalizacja {filters.sort==='location'?'↑':filters.sort==='location-desc'?'↓':'↕'}</button></th>}
                    {columns.owner && <th><button className="sort-heading" onClick={()=>filter('sort',filters.sort==='owner'?'owner-desc':'owner')}>Użytkownik {filters.sort==='owner'?'↑':filters.sort==='owner-desc'?'↓':'↕'}</button></th>}
                    {columns.warranty && <th>Gwarancja do</th>}
                    {columns.purchase && <th>Data zakupu</th>}
                    {columns.invoice && <th>Faktura</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((asset) => (
                    <tr key={asset.id} className={selected[asset.assetId]?'is-selected':''} onContextMenu={e=>{e.preventDefault();e.currentTarget.querySelector<HTMLButtonElement>('[data-row-menu]')?.click();}}>
                      <td className="selection-cell"><input type="checkbox" aria-label={'Zaznacz '+asset.name} checked={!!selected[asset.assetId]} disabled={!selected[asset.assetId]&&Object.keys(selected).length>=100} onChange={e=>setSelected(v=>{const copy={...v};if(e.target.checked)copy[asset.assetId]=asset;else delete copy[asset.assetId];return copy;})}/></td>
                      <td>
                        <Link
                          className="table-title"
                          href={`/asset/${asset.assetId}`}
                        >
                          {asset.name}
                        </Link>
                        <small>
                          <span className="mono">{asset.assetId}</span> ·{" "}
                          {asset.categoryName}
                        </small>
                      </td>
                      <td>
                        <StatusBadge status={asset.status} />
                      </td>
                      {columns.model && <td>{asset.model || "—"}<small>{asset.manufacturer}</small></td>}
                      {columns.serial && <td className="mono">{asset.serialNumber || "—"}</td>}
                      {columns.location && <td>{asset.locationName || "—"}</td>}
                      {columns.owner && <td>{asset.owner || "—"}</td>}
                      {columns.warranty && <td>{formatDate(asset.warrantyUntil)}</td>}
                      {columns.purchase && <td>{formatDate(asset.purchasedAt)}</td>}
                      {columns.invoice && <td>{asset.invoiceId ? <Link className="text-link" href={`/invoice/${asset.invoiceId}`}>{asset.invoiceNumber || "Otwórz fakturę"}</Link> : "—"}</td>}
                      <td>
                        <AssetRecordMenu asset={asset} onEdit={()=>setEditingRow(asset)} onSaved={()=>{reload();setSelected({});setSuccess('Zapisano operację urządzenia.');}}/>
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
              title={
                filterCount || query
                  ? "Nie znaleziono urządzeń"
                  : "Dodaj pierwsze urządzenie"
              }
              description={
                filterCount || query
                  ? "Zmień wyszukiwanie lub wyczyść filtry, aby zobaczyć więcej rekordów."
                  : "Utwórz kategorię i lokalizację, a następnie dodaj sprzęt do centralnej ewidencji."
              }
              action={
                hasPermission(user,'asset.create') && !(filterCount || query) ? (
                  <Button variant="secondary" onClick={() => setCreating(true)}>
                    <Plus size={16} />
                    Dodaj urządzenie
                  </Button>
                ) : undefined
              }
            />
          )
        )}
      </section>
      {editingRow&&<AssetForm asset={editingRow} onClose={()=>setEditingRow(null)} onSaved={()=>{setEditingRow(null);reload();setSelected({});setSuccess('Zapisano urządzenie.');}}/>}
      {creating && hasPermission(user,'asset.create') && (
        <AssetForm
          onClose={() => setCreating(false)}
          onSaved={(asset) => {
            setCreating(false);
            setSuccess(`Dodano ${asset.name} · ${asset.assetId}`);
            reload();
          }}
        />
      )}
    </>
  );
}

type AssetFormData = {
  sku:string;productCode:string;employeeId:string;
  name: string;
  categoryId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  ipAddress: string;
  hostname: string;
  locationId: string;
  status: AssetStatus;
  owner: string;
  purchasedAt: string;
  purchasePrice: string;
  invoiceId: string;
  warrantyUntil: string;
  isFixedAsset: boolean;
  fixedAssetNumber: string;
  rfidTag: string;
  notes: string;
};
export function AssetForm({
  asset,
  initialLocationId,
  onClose,
  onSaved,
}: {
  asset?: Asset;
  initialLocationId?: string;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}) {
  const { user, lookups, lookupError } = useApp();
  const [form, setForm] = useState<AssetFormData>({
    sku:asset?.sku??'',productCode:asset?.productCode??'',employeeId:asset?.employeeId??'',
    name: asset?.name || "",
    categoryId: asset?.categoryId || "",
    manufacturer: asset?.manufacturer || "",
    model: asset?.model || "",
    serialNumber: asset?.serialNumber || "",
    macAddress: asset?.macAddress || "",
    ipAddress: asset?.ipAddress || "",
    hostname: asset?.hostname || "",
    locationId: asset?.locationId || initialLocationId || "",
    status: asset?.status || "PREPARATION",
    owner: asset?.owner || "",
    purchasedAt: asset?.purchasedAt?.slice(0, 10) || "",
    purchasePrice: asset?.purchasePrice || "",
    invoiceId: asset?.invoiceId || "",
    warrantyUntil: asset?.warrantyUntil?.slice(0, 10) || "",
    isFixedAsset: asset?.isFixedAsset || false,
    fixedAssetNumber: asset?.fixedAssetNumber || "",
    rfidTag: asset?.rfidTag || "",
    notes: asset?.notes || "",
  });
  const [custom, setCustom] = useState<[string, string][]>(
    Object.entries(asset?.customFields || {}),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const category=lookups?.categories.find(item=>item.id===form.categoryId);
  const visible=(key:StandardFieldKey)=>assetFieldVisible(category,key)&&(!asset||!(['locationId','status','owner','rfidTag','invoiceId'] as string[]).includes(key)||hasPermission(user,({locationId:'asset.move',status:'asset.status',owner:'asset.assign',rfidTag:'rfid.edit',invoiceId:'invoice.edit'} as const)[key as 'locationId'|'status'|'owner'|'rfidTag'|'invoiceId']));
  function update<K extends keyof AssetFormData>(
    key: K,
    value: AssetFormData[K],
  ) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const names = custom.map(([key]) => key.trim());
      if (names.some((key) => !key) || new Set(names).size !== names.length)
        throw new Error("Nazwy pól dodatkowych muszą być niepuste i unikalne.");
      const body = categoryAssetBody({
        ...form,
        purchasePrice: form.purchasePrice.replace(",", "."),
        customFields: Object.fromEntries(
          custom.map(([key, value]) => [key.trim(), value]),
        ),
        ...(asset ? { version: asset.version } : {}),
      },category);
      if(asset){if(!hasPermission(user,'asset.move'))delete body.locationId;if(!hasPermission(user,'asset.status'))delete body.status;if(!hasPermission(user,'asset.assign')){delete body.owner;delete body.employeeId;}if(!hasPermission(user,'rfid.edit'))delete body.rfidTag;if(!hasPermission(user,'invoice.edit'))delete body.invoiceId;}
      const value = await api<Asset>(
        asset ? `/api/assets/${asset.assetId}` : "/api/assets",
        { method: asset ? "PATCH" : "POST", body: JSON.stringify(body) },
        user.csrfToken,
      );
      onSaved(value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const text = (
    key: keyof AssetFormData,
    label: string,
    options?: {
      required?: boolean;
      type?: string;
      placeholder?: string;
      maxLength?: number;
    },
  ) => (key==='fixedAssetNumber'?!visible('isFixedAsset'):standardFieldKeys.includes(key as StandardFieldKey)&&!visible(key as StandardFieldKey))?null:(
    <Field label={label}>
      <input
        type={options?.type || "text"}
        value={String(form[key])}
        required={options?.required}
        placeholder={options?.placeholder}
        maxLength={options?.maxLength || 200}
        onChange={(event) => update(key, event.target.value as never)}
      />
    </Field>
  );
  return (
    <Modal
      title={asset ? `Edytuj ${asset.assetId}` : "Dodaj urządzenie"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit}>
        <p className="required-note">
          Asset ID i data przyjęcia są nadawane automatycznie. Pola oznaczone *
          są wymagane.
        </p>
        <ErrorMessage message={error || lookupError} />
        {lookups && !lookups.categories.length && (
          <div className="notice notice-info">
            Brak kategorii sprzętu. Administrator musi dodać przynajmniej jedną
            kategorię w Administracji.
          </div>
        )}
        <fieldset className="form-section">
          <legend>01 / Urządzenie</legend>
          <div className="form-grid">
            {text("name", "Nazwa urządzenia *", {
              required: true,
              placeholder: "np. Laptop ThinkPad T14",
            })}
            <Field label="Kategoria *">
              <select
                required
                value={form.categoryId}
                onChange={(event) => update("categoryId", event.target.value)}
              >
                <option value="">Wybierz kategorię</option>
                {lookups?.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            {text("manufacturer", "Producent", { maxLength: 120 })}
            {text("model", "Model", { maxLength: 160 })}
            {text("serialNumber", "Numer seryjny", { maxLength: 160 })}
            {text("rfidTag", "Tag RFID", {
              placeholder: "Opcjonalny identyfikator tagu",
            })}
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>02 / Lokalizacja i użytkownik</legend>
          <div className="form-grid">
            {visible('locationId')&&<LocationPicker value={form.locationId} onChange={id=>update('locationId',id)}/>}
            <Field label="Status *">
              <select
                value={form.status}
                onChange={(event) =>
                  update("status", event.target.value as AssetStatus)
                }
              >
                {(Object.keys(statusLabels) as AssetStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {statusLabels[status]}
                  </option>
                ))}
              </select>
            </Field>
            {(visible('owner')||form.status==='ASSIGNED')&&<EmployeePicker employeeId={form.employeeId} owner={form.owner} required={form.status==='ASSIGNED'} onChange={(id,name)=>setForm(previous=>({...previous,employeeId:id,owner:name}))}/>}
          </div>
        </fieldset>
        {['hostname','ipAddress','macAddress'].some(key=>visible(key as StandardFieldKey))&&<fieldset className="form-section">
          <legend>03 / Sieć</legend>
          <div className="form-grid">
            {text("hostname", "Hostname", { maxLength: 160 })}
            {text("ipAddress", "Adres IP", { placeholder: "IPv4 lub IPv6" })}
            {text("macAddress", "Adres MAC", {
              placeholder: "00:1A:2B:3C:4D:5E",
            })}
          </div>
        </fieldset>}
        {['purchasedAt','purchasePrice','invoiceId','warrantyUntil','isFixedAsset'].some(key=>visible(key as StandardFieldKey))&&<fieldset className="form-section">
          <legend>04 / Zakup i ewidencja finansowa</legend>
          <div className="form-grid">
            {text("purchasedAt", "Data zakupu", { type: "date" })}
            {text(
              "purchasePrice",
              "Cena zakupu (waluta faktury; bez faktury PLN)",
              { placeholder: "0.00" },
            )}
            {visible('invoiceId')&&<InvoicePicker value={form.invoiceId} number={form.invoiceId===asset?.invoiceId?asset.invoiceNumber:undefined} onChange={id=>update('invoiceId',id)}/>}
            {text("warrantyUntil", "Gwarancja do", { type: "date" })}
            {visible('isFixedAsset')&&<label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.isFixedAsset}
                onChange={(event) =>
                  update("isFixedAsset", event.target.checked)
                }
              />
              Środek trwały
            </label>}
            {text(
              "fixedAssetNumber",
              `Numer środka trwałego${form.isFixedAsset ? " *" : ""}`,
              { required: form.isFixedAsset, maxLength: 120 },
            )}
          </div>
        </fieldset>}
        <fieldset className="form-section">
          <legend>05 / Uwagi i pola dodatkowe</legend>
          <div className="form-grid">{text('sku','SKU (opcjonalnie)')}{text('productCode','Kod produktu producenta (opcjonalnie)')}</div>
          <CategoryInputs definitions={lookups?.categories.find(c=>c.id===form.categoryId)?.fieldDefinitions??[]} values={Object.fromEntries(custom)} onChange={(key,value)=>setCustom(previous=>previous.some(([k])=>k===key)?previous.map(([k,v])=>k===key?[k,value]:[k,v]):[...previous,[key,value]])}/>
          {visible('notes')&&<Field label="Uwagi">
            <textarea
              value={form.notes}
              onChange={(event) => update("notes", event.target.value)}
              maxLength={4000}
              placeholder="Informacje dla zespołu IT Hardware"
            />
          </Field>}
          <div className="custom-fields" style={{ marginTop: 15 }}>
            {custom.map(([key, value], index) => lookups?.categories.find(c=>c.id===form.categoryId)?.fieldDefinitions.some(f=>f.key===key)?null:(
              <div className="custom-field-row" key={index}>
                <input
                  aria-label={`Nazwa pola ${index + 1}`}
                  placeholder="Nazwa pola"
                  value={key}
                  maxLength={100}
                  onChange={(event) =>
                    setCustom((previous) =>
                      previous.map((pair, i) =>
                        i === index ? [event.target.value, pair[1]] : pair,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Wartość pola ${index + 1}`}
                  placeholder="Wartość"
                  value={value}
                  maxLength={1000}
                  onChange={(event) =>
                    setCustom((previous) =>
                      previous.map((pair, i) =>
                        i === index ? [pair[0], event.target.value] : pair,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Usuń pole"
                  onClick={() =>
                    setCustom((previous) =>
                      previous.filter((_, i) => i !== index),
                    )
                  }
                >
                  <X size={17} />
                </button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={custom.length >= 40}
            onClick={() => setCustom((previous) => [...previous, ["", ""]])}
          >
            <Plus size={14} />
            Dodaj pole dodatkowe
          </Button>
        </fieldset>
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Anuluj
          </Button>
          <Button type="submit" disabled={busy || !lookups?.categories.length}>
            {busy
              ? "Zapisywanie…"
              : asset
                ? "Zapisz zmiany"
                : "Dodaj urządzenie"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function AssetDetailScreen({ assetId }: { assetId: string }) {
  const { user } = useApp();
  const {
    data: asset,
    error,
    loading,
    reload,
  } = useResource<Asset>(`/api/assets/${encodeURIComponent(assetId)}`);
  const history = useResource<History[]>(
    hasPermission(user,'asset.history')?`/api/assets/${encodeURIComponent(assetId)}/history`:null,
  );
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState("");
  if (loading && !asset) return <Loading />;
  return (
    <>
      <Link href="/assets" className="back-link">
        <ArrowLeft size={15} />
        Wróć do urządzeń
      </Link>
      <ErrorMessage message={error} onRetry={reload} />
      <SuccessMessage message={success} />
      {asset && (
        <>
          <div className="page-header">
            <div className="record-heading" style={{ marginBottom: 0 }}>
              <div className="record-icon">
                <Cpu size={32} />
              </div>
              <div>
                <div className="eyebrow">PASZPORT URZĄDZENIA / {asset.categoryName}</div>
                <h1>{asset.name}</h1>
                <div className="record-id">
                  <CopyValue value={asset.assetId} label="Asset ID"/>
                  <StatusBadge status={asset.status} />
                </div>
              </div>
            </div>
            {hasPermission(user,'asset.edit') && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil size={16} />
                Edytuj urządzenie
              </Button>
            )}
          </div>
          <div className="passport-summary"><div><small>LOKALIZACJA</small><strong>{asset.locationName || "Nie przypisano"}</strong></div><div><small>PRZYPISANIE</small><strong>{asset.owner || "Nie przypisano"}</strong></div><div><small>OSTATNIA ZMIANA</small><strong>{formatDate(asset.updatedAt, true)}</strong></div></div>
          {<AssetActions asset={asset} onSaved={()=>{reload();history.reload();setSuccess('Operacja zapisana w historii urządzenia.');}}/>}
          <nav className="passport-nav" aria-label="Sekcje paszportu urządzenia"><a href="#passport-overview">Urządzenie</a><a href="#passport-network">Sieć</a><a href="#passport-purchase">Zakup i gwarancja</a><a href="#passport-files">Dokumenty i QR</a>{hasPermission(user,'config.view')&&<a href="#passport-config">Konfiguracje</a>}{hasPermission(user,'incident.view')&&<a href="#passport-service">Serwis</a>}{hasPermission(user,'asset.history')&&<a href="#passport-history">Historia</a>}</nav>
          <div className="split-grid">
            <div>
              <section id="passport-overview" className="panel passport-section">
                <div className="panel-heading">
                  <h2>Informacje o urządzeniu</h2>
                  <span className="muted mono" style={{ fontSize: 9 }}>
                    v{asset.version}
                  </span>
                </div>
                <DetailsGrid
                  entries={[
                    ["Producent", asset.manufacturer],
                    ["Model", asset.model],
                    ['SKU',asset.sku],['Kod produktu',asset.productCode],
                    [
                      "Numer seryjny",
                      asset.serialNumber ? <CopyValue value={asset.serialNumber} label="numer seryjny"/> : null,
                    ],
                    [
                      "Lokalizacja",
                      <span key="location">
                        <MapPin
                          size={13}
                          style={{
                            verticalAlign: "middle",
                            marginRight: 5,
                            color: "var(--subtle)",
                          }}
                        />
                        {asset.locationName || "Nie przypisano"}
                      </span>,
                    ],
                    ["Użytkownik / właściciel", asset.employeeId ? <Link className="text-link" href={`/employees/${asset.employeeId}`}>{asset.owner}</Link> : asset.owner],
                    ["RFID", asset.rfidTag ? <CopyValue value={asset.rfidTag} label="tag RFID"/> : null],
                    ["Data przyjęcia", formatDate(asset.receivedAt)],
                    ["Data wydania", formatDate(asset.issuedAt)],
                  ]}
                />
              </section>
              <section id="passport-network" className="panel passport-section">
                <div className="panel-heading">
                  <h2>Sieć</h2>
                </div>
                <DetailsGrid
                  entries={[
                    ["Hostname", asset.hostname],
                    [
                      "Adres IP",
                      asset.ipAddress ? <CopyValue value={asset.ipAddress} label="adres IP"/> : null,
                    ],
                    [
                      "Adres MAC",
                      asset.macAddress ? <CopyValue value={asset.macAddress} label="adres MAC"/> : null,
                    ],
                  ]}
                />
              </section>
              <section id="passport-purchase" className="panel passport-section">
                <div className="panel-heading">
                  <h2>Zakup i środki trwałe</h2>
                </div>
                <DetailsGrid
                  entries={[
                    ["Data zakupu", formatDate(asset.purchasedAt)],
                    [
                      "Cena zakupu",
                      formatMoney(
                        asset.purchasePrice,
                        asset.purchaseCurrency || "PLN",
                      ),
                    ],
                    [
                      "Faktura",
                      asset.invoiceId ? (
                        <Link
                          href={`/invoice/${asset.invoiceId}`}
                          className="text-link"
                          key="invoice"
                        >
                          {asset.invoiceNumber}
                          <ArrowUpRight size={13} />
                        </Link>
                      ) : null,
                    ],
                    ["Pozycja faktury", asset.invoiceItemPosition?`${asset.invoiceItemPosition}. ${asset.invoiceItemName}`:null],
                    ["Dostawca", asset.supplierName],
                    ["Gwarancja do", formatDate(asset.warrantyUntil)],
                    ["Środek trwały", asset.isFixedAsset ? "Tak" : "Nie"],
                    ["Numer środka trwałego", asset.fixedAssetNumber],
                  ]}
                />
              </section>
              {(asset.notes || Object.keys(asset.customFields).length > 0) && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Uwagi i informacje dodatkowe</h2>
                  </div>
                  {asset.notes && (
                    <p
                      className="panel-body"
                      style={{ fontSize: 12, whiteSpace: "pre-wrap" }}
                    >
                      {asset.notes}
                    </p>
                  )}
                  {Object.keys(asset.customFields).length > 0 && (
                    <DetailsGrid entries={Object.entries(asset.customFields)} />
                  )}
                </section>
              )}
              {hasPermission(user,'config.view')&&<section id="passport-config" className="panel passport-section"><AssetConfigurationPanel asset={asset} onSaved={()=>{reload();history.reload();}}/></section>}
              {hasPermission(user,'incident.view')&&<section id="passport-service" className="panel passport-section"><AssetServicePanel asset={asset}/></section>}
              {hasPermission(user,'asset.history')&&<section id="passport-history" className="panel passport-section">
                <div className="panel-heading">
                  <div>
                    <h2>Historia urządzenia</h2>
                    <p>Zdarzenia są zapisywane automatycznie.</p>
                  </div>
                  <a className="text-link" href={`/api/assets/${asset.assetId}/history/export`} download>Eksport historii tego urządzenia</a>
                </div>
                <ErrorMessage message={history.error} onRetry={history.reload} />
                {history.loading && !history.data ? (
                  <Loading />
                ) : (
                  !history.error && <HistoryList items={history.data || []} />
                )}
              </section>}
            </div>
            <aside id="passport-files" className="passport-section">
              {hasPermission(user,'label.print') && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Etykieta urządzenia</h2>
                  </div>
                  <QRLabel type="asset" id={asset.assetId} name={asset.name} />
                </section>
              )}
              {hasPermission(user,'document.view')&&<section className="panel"><DocumentsScreen compact assetId={asset.id}/></section>}
              {hasPermission(user,'invoice.view')&&(asset.invoiceId?<InvoiceDocuments key={asset.invoiceId} invoiceId={asset.invoiceId} invoiceNumber={asset.invoiceNumber} allowUpload/>:<section className="panel"><div className="panel-heading"><h2>Faktura zakupu</h2></div><div className="panel-body"><p className="help-note">Nie przypisano faktury do tego urządzenia.</p>{hasPermission(user,'asset.edit')&&<Button variant="secondary" onClick={()=>setEditing(true)}>Przypisz fakturę</Button>}</div></section>)}
              <div className="help-note">
                Ostatnia zmiana: {formatDate(asset.updatedAt, true)}
                <br />
                Asset ID jest stałym identyfikatorem urządzenia.
              </div>
            </aside>
          </div>
          {editing && (
            <AssetForm
              asset={asset}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setSuccess(
                  "Zmiany zapisano. Historia urządzenia została zaktualizowana.",
                );
                reload();
                history.reload();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
