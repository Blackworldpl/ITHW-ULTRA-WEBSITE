'use client';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {useState} from 'react';
import {FolderOpen} from 'lucide-react';
import type {LocationDetail} from '@/shared/product';
import type {Location} from '@/shared/types';
import {hasPermission} from '@/shared/permissions';
import {useApp} from './context';
import {LocationTree} from './location-tree';
import {EmptyState,ErrorMessage,HistoryList,Loading,PageHeader,StatusBadge,SuccessMessage,useResource} from './ui';
export function LocationsScreen(){const {refreshLookups}=useApp(),params=useSearchParams(),[success,setSuccess]=useState('');return <><PageHeader eyebrow="ITH // LOCATIONS" title="Struktura lokalizacji" description="Od obiektu do stanowiska. Lokalizacja, urządzenia i ruchy w jednej przestrzeni."/><SuccessMessage message={success}/><LocationTree initialSelectedId={params.get('selected')??''} startCreating={params.get('create')==='1'} onSaved={message=>{setSuccess(message);refreshLookups(['locations']);}}/></>;}
export function LocationContents({location}:{location:Location}){
 const {user}=useApp(),resource=useResource<LocationDetail>(`/api/locations/${location.id}`),data=resource.data;
 return <div className="location-contents"><ErrorMessage message={resource.error} onRetry={resource.reload}/>{resource.loading&&!data?<Loading compact/>:data&&<><div className="location-metrics">{hasPermission(user,'asset.view')&&<div><strong>{data.location.assetCount??0}</strong><span>Urządzenia w gałęzi</span></div>}<div><strong>{data.children.length}</strong><span>Foldery podrzędne</span></div></div>{data.children.length>0&&<div className="location-child-list">{data.children.map(c=><Link href={`/locations?selected=${c.id}`} key={c.id}><FolderOpen size={15}/>{c.name}<span>{c.assetCount??0}</span></Link>)}</div>}{hasPermission(user,'asset.view')&&<><div className="section-heading"><h3>Urządzenia</h3><Link className="text-link" href={`/assets?locationId=${location.id}&includeChildren=true`}>Cała lista</Link></div>{data.assets.length?<div className="location-device-list">{data.assets.map(a=><Link href={`/asset/${a.assetId}`} key={a.id}><div><strong>{a.name}</strong><small className="mono">{a.assetId} · {a.serialNumber||'Bez numeru seryjnego'}</small></div><StatusBadge status={a.status}/></Link>)}</div>:<EmptyState title="Brak urządzeń w tej lokalizacji" description="Przypisz lokalizację na karcie urządzenia lub przy przyjęciu zakupu."/>}</>}{data.activity.length>0&&<><div className="section-heading"><h3>Zmiany lokalizacji</h3></div><HistoryList items={data.activity}/></>}</>}</div>;
}
