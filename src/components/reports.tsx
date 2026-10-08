'use client';
import {hasPermission} from '@/shared/permissions';
import Link from 'next/link';
import { Download, RefreshCw } from 'lucide-react';
import type { ReportGroup, Reports, AssetStatus } from '@/shared/types';
import { statusLabels } from '@/shared/types';
import { canEdit, useApp } from './context';
import { Button, EmptyState, ErrorMessage, formatMoney, Loading, PageHeader, useResource } from './ui';

function Distribution({title,rows,link}:{title:string;rows:ReportGroup[];link:(row:ReportGroup)=>string}) {
  const max=Math.max(1,...rows.map(row=>row.count));
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2></div>{rows.length?<ul className="report-bars">{rows.map(row=><li key={row.id??row.label}><Link href={link(row)} className="text-link">{row.label}</Link><span className="report-bar" aria-hidden="true"><span style={{width:`${row.count/max*100}%`}}/></span><strong>{row.count}</strong></li>)}</ul>:<div className="small-empty">Brak urządzeń w ewidencji.</div>}</section>;
}

export function ReportsScreen() {
  const {user}=useApp();
  const {data,error,loading,reload}=useResource<Reports>('/api/reports');
  return <>
    <PageHeader eyebrow="ANALIZA EWIDENCJI" title="Raporty" description="Sprzęt, gwarancje, zakupy i zapotrzebowanie magazynu." actions={<><Button variant="secondary" disabled={loading} onClick={reload}><RefreshCw size={16}/>Odśwież</Button>{hasPermission(user,'asset.export')&&<a className="button button-secondary" href="/api/assets/export" download><Download size={16}/>Ewidencja CSV</a>}</>}/>
    <ErrorMessage message={error} onRetry={reload}/>{loading&&!data&&<Loading/>}
    {data&&<>
      <div className="report-summary"><Link href="/assets" className="panel report-stat"><span>Urządzenia</span><strong>{data.totalAssets}</strong></Link><Link href="/assets?fixed=true" className="panel report-stat"><span>Środki trwałe</span><strong>{data.fixedAssets}</strong></Link><Link href="/assets?warranty=soon&active=true" className="panel report-stat"><span>Gwarancja kończy się w 30 dni</span><strong>{data.warranty.soon}</strong></Link></div>
      <section className="panel"><div className="panel-heading"><div><h2>Wartość zakupu sprzętu</h2><p>Kwoty zapisane w ewidencji, osobno dla każdej waluty. Nie są wartością księgową ani wyceną bieżącą.</p></div></div>
        {data.values.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Waluta</th><th>Cała ewidencja</th><th>Aktywny sprzęt</th><th>Aktywne środki trwałe</th></tr></thead><tbody>{data.values.map(row=><tr key={row.currency}><td>{row.currency}</td><td>{formatMoney(row.total,row.currency)}</td><td>{formatMoney(row.active,row.currency)}</td><td>{formatMoney(row.fixed,row.currency)}</td></tr>)}</tbody></table></div>:<div className="small-empty">Brak cen zakupu.</div>}
        <div className="panel-note">Bez ceny zakupu: {data.unpriced} urządzeń. Sprzęt bez powiązanej faktury ma domyślną walutę PLN. Aktywny sprzęt obejmuje wszystkie statusy poza „Zutylizowany”.</div>
      </section>
      <div className="reports-grid">
        <Distribution title="Według kategorii" rows={data.byCategory} link={r=>`/assets?categoryId=${r.id}`}/>
        <Distribution title="Według statusu" rows={data.byStatus.map(r=>({...r,label:statusLabels[r.id as AssetStatus]??r.label}))} link={r=>`/assets?status=${r.id}`}/>
        <Distribution title="Według lokalizacji" rows={data.byLocation} link={r=>r.id?`/assets?locationId=${r.id}`:'/assets?noLocation=true'}/>
        <Distribution title="Gwarancje aktywnego sprzętu" rows={[{id:'expired',label:'Po gwarancji',count:data.warranty.expired},{id:'soon',label:'Kończy się w 30 dni',count:data.warranty.soon},{id:'valid',label:'Ponad 30 dni',count:data.warranty.valid},{id:'none',label:'Brak danych',count:data.warranty.unknown}]} link={r=>`/assets?warranty=${r.id}&active=true`}/>
        <section className="panel"><div className="panel-heading"><h2>Zakupy w ostatnich 12 miesiącach</h2></div>{data.monthly.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Miesiąc</th><th>Sztuk</th><th>Wartość zakupu</th></tr></thead><tbody>{data.monthly.map(r=><tr key={`${r.month}-${r.currency}`}><td><Link className="text-link" href={`/assets?purchasedFrom=${r.month}-01&purchasedTo=${r.month}-${new Date(Number(r.month.slice(0,4)),Number(r.month.slice(5)),0).getDate()}`}>{r.month}</Link></td><td>{r.count}</td><td>{formatMoney(r.value,r.currency)}{r.unpriced>0&&<small>Niepełna wartość · {r.unpriced} bez ceny</small>}</td></tr>)}</tbody></table></div>:<div className="small-empty">Brak dat zakupu w tym okresie.</div>}</section>
        <section className="panel"><div className="panel-heading"><h2>Sprzęt według dostawcy</h2></div>{data.bySupplier.length?<div className="table-wrap"><table className="data-table"><thead><tr><th>Dostawca</th><th>Sztuk</th><th>Wartość zakupu</th></tr></thead><tbody>{data.bySupplier.map(r=><tr key={`${r.id}-${r.currency}`}><td><Link className="text-link" href={`/assets?supplierId=${r.id}`}>{r.label}</Link></td><td>{r.count}</td><td>{formatMoney(r.value,r.currency)}{r.unpriced>0&&<small>Niepełna wartość · {r.unpriced} bez ceny</small>}</td></tr>)}</tbody></table></div>:<div className="small-empty">Brak urządzeń powiązanych z fakturami.</div>}</section>
        <section className="panel"><div className="panel-heading"><div><h2>Najczęściej pobierane produkty</h2><p>Ostatnie 90 dni. Wyłącznie pobrania; korekty nie zwiększają wyniku.</p></div></div>{data.topWithdrawals.length?<ul className="report-ranking">{data.topWithdrawals.map(r=><li key={r.slug}><Link className="text-link" href={`/inventory/${r.slug}`}>{r.label}</Link><strong>{r.quantity.toLocaleString('pl-PL')} {r.unit}</strong></li>)}</ul>:<div className="small-empty">Brak pobrań w tym okresie.</div>}</section>
      </div>
      <section className="panel"><div className="panel-heading"><div><h2>Lista do uzupełnienia</h2><p>Do 50 produktów z największym brakiem do minimum. Produkty na minimum też wymagają uwagi.</p></div>{hasPermission(user,'asset.export')&&<a className="button button-secondary" href="/api/reports/shortages.csv" download><Download size={15}/>Pełna lista CSV</a>}</div>
        {data.shortages.length?<><div className="table-wrap"><table className="data-table"><thead><tr><th>Produkt</th><th>Lokalizacja</th><th>Stan</th><th>Minimum</th><th>Brakuje</th></tr></thead><tbody>{data.shortages.map(r=><tr key={r.slug}><td><Link className="table-title" href={`/inventory/${r.slug}`}>{r.name}</Link><small>{r.sku}</small></td><td>{r.location??'Nie przypisano'}</td><td>{r.stock} {r.unit}</td><td>{r.minimum}</td><td><strong>{r.missing} {r.unit}</strong></td></tr>)}</tbody></table></div><div className="panel-note"><Link className="text-link" href="/inventory?lowStock=true">Zobacz wszystkie produkty z niskim stanem →</Link></div></>:<EmptyState title="Brak produktów do uzupełnienia" description="Produkty z ustawionym minimum i niskim stanem pojawią się tutaj."/>}
      </section>
    </>}
  </>;
}
