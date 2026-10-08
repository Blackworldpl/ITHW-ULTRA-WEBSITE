import type {User,AssetStatus} from '@/shared/types';
import {tvDashboard,type DeviceConfig,type DeviceScreenData,type TvMetric} from '@/shared/devices';
import {requirePermission} from './permissions';
import {query} from './db';

const statusMetric:Partial<Record<TvMetric,AssetStatus>>={available:'AVAILABLE',assigned:'ASSIGNED',repair:'REPAIR',preparation:'PREPARATION',damaged:'DAMAGED',disposal:'DISPOSAL'};
type TvData=Pick<DeviceScreenData,'statistics'|'metrics'|'incidents'|'incidentCount'>;
// Screens refresh every few seconds and often share a configuration. Results are
// reused for one refresh interval; only data is cached — the device session and
// the configuring account's permissions are checked on every request (above and
// below), so revoking a device or a permission takes effect immediately.
const cache=new Map<string,{expires:number;value:Promise<TvData>}>();
export async function tvDashboardData(config:DeviceConfig,user:User):Promise<TvData>{
 const options=tvDashboard(config),showStats=config.mode==='OVERVIEW'&&config.showStats,showIncidents=config.mode==='INCIDENTS'||config.mode==='OVERVIEW'&&config.showIncidents;
 if(config.mode==='MESSAGE')return computeTvDashboard(config,user);
 if(showStats&&options.metrics.some(key=>key!=='openIncidents'&&key!=='criticalIncidents'))requirePermission(user,'asset.view');
 if(showIncidents||showStats&&options.metrics.some(key=>key==='openIncidents'||key==='criticalIncidents'))requirePermission(user,'incident.view');
 const key=JSON.stringify(config),now=Date.now(),hit=cache.get(key);
 if(hit&&hit.expires>now)return hit.value;
 for(const [entry,value] of cache)if(value.expires<=now||cache.size>200)cache.delete(entry);
 const value=computeTvDashboard(config,user);
 cache.set(key,{expires:now+Math.min(Math.max(config.refreshSeconds||5,2),60)*1000,value});
 value.catch(()=>cache.delete(key));
 return value;
}
async function computeTvDashboard(config:DeviceConfig,user:User):Promise<TvData>{
 const options=tvDashboard(config),showStats=config.mode==='OVERVIEW'&&config.showStats,showIncidents=config.mode==='INCIDENTS'||config.mode==='OVERVIEW'&&config.showIncidents;
 const statistics:NonNullable<DeviceScreenData['statistics']>={statuses:{}},metrics:DeviceScreenData['metrics']=[],incidents:DeviceScreenData['incidents']=[];
 if(config.mode==='MESSAGE')return {statistics:null,metrics,incidents,incidentCount:0};
 const branch=`WITH RECURSIVE branch AS (SELECT id FROM locations WHERE id=$1::uuid UNION ALL SELECT l.id FROM locations l JOIN branch b ON l.parent_id=b.id WHERE $2::boolean)`;
 const location=`($1::uuid IS NULL OR a.location_id IN(SELECT id FROM branch)) AND ($3::uuid IS NULL OR a.category_id=$3::uuid)`;
 const values=[config.locationId,options.includeChildren,options.categoryId,options.incidentStatuses,options.incidentPriorities];
 const computed:Partial<Record<TvMetric,number>>={};
 if(showStats&&options.metrics.some(key=>key!=='openIncidents'&&key!=='criticalIncidents')){
  requirePermission(user,'asset.view');const rows=(await query<{status:AssetStatus;count:number}>(`${branch} SELECT a.status,count(*)::int AS count FROM assets a WHERE a.status<>'RETIRED' AND ${location} GROUP BY a.status`,values.slice(0,3))).rows;
  if(options.metrics.includes('total')){computed.total=rows.reduce((sum,row)=>sum+row.count,0);statistics.total=computed.total;}
  for(const key of options.metrics){const status=statusMetric[key];if(status){computed[key]=rows.find(row=>row.status===status)?.count??0;statistics.statuses[status]=computed[key];}}
 }
 const needIncidentCounts=showIncidents||showStats&&options.metrics.some(key=>key==='openIncidents'||key==='criticalIncidents');let incidentCount=0;
 const incidentWhere=`${location} AND i.status=ANY($4::text[]) AND i.priority=ANY($5::text[])`;
 if(needIncidentCounts){
  requirePermission(user,'incident.view');const counts=(await query<{total:number;open:number;critical:number}>(`${branch} SELECT count(*)::int AS total,count(*) FILTER(WHERE i.status<>'RESOLVED')::int AS open,count(*) FILTER(WHERE i.status<>'RESOLVED' AND i.priority='CRITICAL')::int AS critical FROM incidents i LEFT JOIN assets a ON a.id=i.asset_id WHERE ${incidentWhere}`,values)).rows[0];
  if(showIncidents)incidentCount=counts.total;
  if(showStats&&options.metrics.includes('openIncidents')){computed.openIncidents=counts.open;statistics.openIncidents=counts.open;}
  if(showStats&&options.metrics.includes('criticalIncidents')){computed.criticalIncidents=counts.critical;statistics.criticalIncidents=counts.critical;}
 }
 if(showIncidents){
  const order={priority:"CASE i.priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 2 ELSE 1 END DESC,i.updated_at DESC,i.id",newest:'i.updated_at DESC,i.id',oldest:'i.updated_at ASC,i.id'}[options.incidentSort];
  const rows=(await query<Required<DeviceScreenData['incidents'][number]>>(`${branch} SELECT i.id,i.number,i.title,i.priority,i.status,a.name AS "assetName",i.updated_at AS "updatedAt" FROM incidents i LEFT JOIN assets a ON a.id=i.asset_id WHERE ${incidentWhere} ORDER BY ${order} LIMIT $6`,[...values,options.incidentLimit])).rows;
  for(const row of rows){const visible:DeviceScreenData['incidents'][number]={id:row.id,title:row.title};for(const field of options.incidentFields)Object.assign(visible,{[field]:row[field]});incidents.push(visible);}
 }
 if(showStats)for(const key of options.metrics)metrics.push({key,value:computed[key]??0});
 return {statistics:showStats?statistics:null,metrics,incidents,incidentCount};
}
