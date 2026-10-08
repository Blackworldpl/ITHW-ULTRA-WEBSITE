"use client";

import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  ArrowRight,
  Box,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";
import type { AssetStatus, History } from "@/shared/types";
import { loginUrl, passwordChangeUrl } from '@/shared/login-return';

export class ApiFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  init?: RequestInit,
  csrf?: string,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...init?.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if(result.code==='PASSWORD_CHANGE_REQUIRED'&&typeof window!=='undefined')window.location.assign(passwordChangeUrl(window.location.pathname+window.location.search+window.location.hash));
    if (
      response.status === 401 &&
      path !== "/api/auth/me" &&
      path !== "/api/auth/login" &&
      !path.startsWith("/api/device/") &&
      typeof window !== "undefined"
    )
      window.location.assign(loginUrl(window.location.pathname + window.location.search + window.location.hash));
    throw new ApiFailure(
      response.status >= 500
        ? "Nie udało się pobrać danych lub zapisać operacji. Spróbuj ponownie za chwilę."
        : result.error || "Nie udało się wykonać operacji. Spróbuj ponownie.",
      response.status,
    );
  }
  return result.data as T;
}
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (current) setData(value);
      })
      .catch((err) => {
        if (current && err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, revision]);
  return { data, error, loading, reload };
}
export const statusLabels: Record<AssetStatus, string> = {
  AVAILABLE: "Dostępny",
  ASSIGNED: "Wydany",
  DAMAGED: "Uszkodzony",
  REPAIR: "W naprawie",
  PREPARATION: "Do przygotowania",
  DISPOSAL: "Do utylizacji",
  RETIRED: "Zutylizowany",
};
export const roleLabels = {
  VIEWER: "Tylko odczyt",
  IT_USER: "IT User",
  IT_ADVANCED: "IT Advanced",
  ADMIN: "Administrator",
};
export function formatDate(value: string | null | undefined, time = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}
export function formatMoney(
  value: string | null | undefined,
  currency = "PLN",
) {
  if (!value) return "—";
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(
    Number(value),
  );
}
export function Button({
  variant,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "danger" | "ghost";
}) {
  return (
    <button
      {...props}
      className={`button ${variant ? `button-${variant}` : ""} ${className}`}
    />
  );
}
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return message ? (
    <div className="notice notice-error" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {onRetry && <Button type="button" variant="secondary" onClick={onRetry}>Spróbuj ponownie</Button>}
    </div>
  ) : null;
}
export function SuccessMessage({ message }: { message: string }) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!message){setVisible(false);return;}setVisible(true);const timer=setTimeout(()=>setVisible(false),4500);return()=>clearTimeout(timer);},[message]);
  return visible&&typeof document!=='undefined' ? createPortal(
    <div className="toast" role="status">
      <Check size={18} />
      <span>{message}</span>
      <button type="button" aria-label="Zamknij powiadomienie" onClick={()=>setVisible(false)}><X size={15}/></button>
    </div>,document.body
  ) : null;
}
export function Loading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`loading skeleton-loading ${compact ? "loading-compact" : ""}`} role="status" aria-label="Trwa wczytywanie danych">
      <span className="sr-only">Trwa wczytywanie danych</span>
      <div className="skeleton-heading" aria-hidden="true"><span className="skeleton"/><span className="skeleton"/></div>
      <div className="skeleton-rows" aria-hidden="true">{Array.from({ length: compact ? 2 : 4 }, (_, index) => <div key={index}><span className="skeleton"/><span className="skeleton"/><span className="skeleton"/></div>)}</div>
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Box size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {Children.map(children,child=>isValidElement<Record<string,unknown>>(child)&&typeof child.type==='string'&&['input','textarea','select'].includes(child.type)&&!child.props['aria-label']&&!child.props['aria-labelledby']?cloneElement(child,{'aria-label':label}):child)}
      {hint && <small>{hint}</small>}
    </label>
  );
}
const modalStack:HTMLElement[]=[];
const modalInert=new Map<HTMLElement,boolean>();
let modalOverflow='';
function applyModalStack(){
 const top=modalStack.at(-1);
 for(const element of Array.from(document.body.children))if(element instanceof HTMLElement){
  if(!modalInert.has(element))modalInert.set(element,element.inert);
  element.inert=top?!element.contains(top):modalInert.get(element)!;
 }
 if(!top){document.body.style.overflow=modalOverflow;modalInert.clear();}
 else document.body.style.overflow='hidden';
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  full = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  full?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!mounted) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog=dialogRef.current!;
    if(!modalStack.length)modalOverflow=document.body.style.overflow;
    modalStack.push(dialog);applyModalStack();
    const first = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") || dialogRef.current?.querySelector<HTMLElement>("input:not(:disabled),select:not(:disabled),textarea:not(:disabled)") || dialogRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
    first?.focus();
    const handler = (event: KeyboardEvent) => {
      if(modalStack.at(-1)!==dialog)return;
      if (event.key === "Escape" && !event.defaultPrevented) {event.preventDefault();closeRef.current();}
      if (event.key === "Tab") {
        const controls = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
          ) || [],
        ).filter((control) => control.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      const index=modalStack.indexOf(dialog);if(index!==-1)modalStack.splice(index,1);applyModalStack();
      if(previousFocus?.isConnected&&!previousFocus.closest('[inert]'))previousFocus.focus();
    };
  }, [mounted]);
  return mounted ? createPortal(
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${full?'modal-full':wide ? "modal-wide" : ""}`}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Zamknij okno"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>, document.body
  ) : null;
}
export function StatusBadge({ status }: { status: AssetStatus }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      <span className="badge-dot" />
      {statusLabels[status]}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
const actionLabels: Record<string, string> = {
  CREATE_ASSET: "Dodano urządzenie",
  UPDATE_ASSET: "Zmieniono urządzenie",
  INVENTORY_MOVEMENT: "Ruch magazynowy",
  RECEIVE_DELIVERY: "Przyjęto dostawę",
  CREATE_INVENTORY: "Dodano produkt",
  CREATE_USER: "Dodano użytkownika",
  UPDATE_USER: "Zmieniono użytkownika",
  LOGIN: "Logowanie",
  CREATE_LOCATION: "Dodano lokalizację",
  CREATE_CATEGORY: "Dodano kategorię",
  CREATE_SUPPLIER: "Dodano dostawcę",
  UPDATE_LOCATION: "Zmieniono lokalizację",
  DELETE_LOCATION: "Usunięto lokalizację",
  UPDATE_CATEGORY: "Zmieniono kategorię",
  DELETE_CATEGORY: "Usunięto kategorię",
  UPDATE_SUPPLIER: "Zmieniono dostawcę",
  DELETE_SUPPLIER: "Usunięto dostawcę",
  DELETE_USER: "Usunięto użytkownika",
  DELETE_DEVICE: "Usunięto ekran / terminal",
  ASSIGN_ASSET: "Wydano urządzenie",
  TRANSFER_ASSET: "Przekazano urządzenie",
  UPLOAD_INVOICE_PDF: "Dołączono PDF faktury",
  RETURN_ASSET: "Przyjęto zwrot urządzenia",
  MOVE_ASSET: "Zmieniono lokalizację",
  CHANGE_ASSET_STATUS: "Zmieniono status",
  ASSIGN_RFID: "Zmieniono RFID",
  ASSET_NOTE: "Notatka do urządzenia",
  UPDATE_INVENTORY: "Zmieniono produkt",
  ADJUSTMENT: "Korekta stanu",
  OPENING_BALANCE: "Stan początkowy z importu",
};
export function HistoryList({ items }: { items: History[] }) {
  if (!items.length)
    return <div className="small-empty">Brak zarejestrowanych zdarzeń.</div>;
  return (
    <ol className="history-list">
      {items.map((item) => (
        <li key={item.id}>
          <span
            className={`history-marker ${item.delta != null && item.delta < 0 ? "negative" : ""}`}
          >
            {item.delta != null ? (
              item.delta > 0 ? (
                "+"
              ) : (
                "−"
              )
            ) : (
              <Check size={12} />
            )}
          </span>
          <div className="history-content">
            <strong>
              {item.description || actionLabels[item.action] || item.action}
            </strong>
            <div className="muted">
              {item.actorName} <span className="dot-separator">·</span>{" "}
              {formatDate(item.createdAt, true)}
              {item.balanceAfter != null && (
                <span className="balance-after">
                  Stan po: {item.balanceAfter.toLocaleString('pl-PL')}
                </span>
              )}
            </div>
          </div>
          {item.delta != null && (
            <span
              className={`history-delta ${item.delta < 0 ? "text-red" : "text-green"}`}
            >
              {item.delta > 0 ? "+" : ""}
              {item.delta.toLocaleString('pl-PL')}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
export function Pagination({
  total,
  page,
  pageSize,
  onChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        {total === 0
          ? "0 wyników"
          : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} z ${total} wyników`}
      </span>
      <div>
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Poprzednia
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Następna
        </Button>
      </div>
    </div>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-link">
      {children}
      <ArrowRight size={14} />
    </Link>
  );
}
export function DetailsGrid({
  entries,
}: {
  entries: [string, React.ReactNode][];
}) {
  return (
    <dl className="details-grid">
      {entries.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
export function QRLabel({
  type,
  id,
  name,
}: {
  type: "asset" | "inventory" | "location";
  id: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const [labelWidth, setLabelWidth] = useState(60);
  const [labelHeight, setLabelHeight] = useState(50);
  const [labelDpi,setLabelDpi]=useState(300);
  const validSize = Number.isInteger(labelWidth) && labelWidth >= 30 && labelWidth <= 120 && Number.isInteger(labelHeight) && labelHeight >= 30 && labelHeight <= 120;
  const preview = useRef<HTMLDivElement>(null);
  async function printLabel() {
    if (!preview.current || !validSize) return;
    document.querySelector(".print-only")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "print-only";
    sheet.appendChild(preview.current.cloneNode(true));
    const style = document.createElement("style");
    const qrSize = Math.max(10, Math.min(labelWidth - 4, labelHeight - 14));
    style.textContent = `@media print { @page { size: ${labelWidth}mm ${labelHeight}mm; margin: 0; } .print-only .qr-preview { box-sizing: border-box; width: ${labelWidth}mm; height: ${labelHeight}mm; padding: 2mm; margin: 0; border: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 1mm; overflow: hidden; } .print-only .qr-preview img { width: ${qrSize}mm; height: ${qrSize}mm; } .print-only .qr-preview strong { font-size: 9pt; } .print-only .qr-preview > span { font-size: 7pt; } }`;
    sheet.appendChild(style);
    document.body.appendChild(sheet);
    const images = Array.from(sheet.querySelectorAll("img"));
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    window.addEventListener("afterprint", () => sheet.remove(), { once: true });
    window.print();
  }
  return (
    <div className="qr-label">
      <div className="qr-preview" ref={preview}>
        {failed ? (
          <span className="muted">Nie udało się wygenerować QR.</span>
        ) : (
          <img
            src={`/api/qr?type=${type}&id=${encodeURIComponent(id)}`}
            alt={`Kod QR: ${name}`}
            width="150"
            height="150"
            onError={() => setFailed(true)}
          />
        )}
        <strong>{name}</strong>
        <span className="mono">{id}</span>
      </div>
      <Button
        variant="secondary"
        disabled={failed || !validSize}
        onClick={() => void printLabel()}
      >
        Drukuj etykietę
      </Button>
      <small>Skan prowadzi do rekordu w tym systemie.</small>
      <a className="button button-ghost" href={`/api/qr?type=${type}&id=${encodeURIComponent(id)}&format=png`}>Pobierz QR (PNG)</a>
      <details className="label-settings">
        <summary>Wymiary etykiety i rozdzielczość Zebra</summary>
        <div className="form-grid">
          <Field label="Szerokość (mm)"><input type="number" min={30} max={120} step={1} value={labelWidth || ''} onChange={e=>setLabelWidth(Number(e.target.value))}/></Field>
          <Field label="Wysokość (mm)"><input type="number" min={30} max={120} step={1} value={labelHeight || ''} onChange={e=>setLabelHeight(Number(e.target.value))}/></Field>
          <Field label="Rozdzielczość drukarki (DPI)"><select value={labelDpi} onChange={e=>setLabelDpi(Number(e.target.value))}>{[203,300,600].map(dpi=><option key={dpi} value={dpi}>{dpi} DPI</option>)}</select></Field>
        </div>
        {validSize ? <a className="button button-secondary" href={`/api/labels/zpl?type=${type}&id=${encodeURIComponent(id)}&width=${labelWidth}&height=${labelHeight}&dpi=${labelDpi}`}>Pobierz etykietę ZPL · {labelDpi} DPI</a> : <small>Wpisz całkowite wymiary od 30 do 120 mm.</small>}
        <small>Ustaw wymiary założonych etykiet i DPI zgodne z drukarką. Pobranie ZPL przygotowuje plik; wydruk uruchamiasz w programie drukarki.</small>
      </details>
    </div>
  );
}
