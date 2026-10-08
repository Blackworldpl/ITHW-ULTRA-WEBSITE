import {z} from 'zod';
import type {User} from '@/shared/types';
import {defaultDashboardLayout,type DashboardPreference} from '@/shared/dashboard-layout';
import {query,transaction} from './db';
import {requireRole} from './auth';
import {requirePermission} from './permissions';
import {parse} from './validation';
import {AppError} from './errors';
const layoutSchema=z.object({overview:z.boolean(),incidents:z.boolean(),recentAssets:z.boolean(),activity:z.boolean(),scanner:z.boolean(),shortages:z.boolean(),locations:z.boolean(),shortcuts:z.boolean(),deliveries:z.boolean()}).strict().refine(value=>Object.values(value).some(Boolean),'Pozostaw przynajmniej jedną sekcję dashboardu.');
function allowed(user:User){requireRole(user,['ADMIN']);requirePermission(user,'dashboard.configure');}
export async function getDashboardPreference(user:User):Promise<DashboardPreference>{allowed(user);const row=(await query<{value:DashboardPreference['layout'];version:number}>('SELECT value,version FROM system_settings WHERE key=$1',['dashboard_layout:'+user.id])).rows[0];return row?{layout:row.value,version:row.version}:{layout:defaultDashboardLayout,version:0};}
export async function saveDashboardPreference(body:unknown,user:User):Promise<DashboardPreference>{allowed(user);const input=parse(z.object({layout:layoutSchema,version:z.number().int().nonnegative()}).strict(),body),key='dashboard_layout:'+user.id;
 return transaction(async client=>{await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[key]);const before=(await client.query('SELECT value,version FROM system_settings WHERE key=$1 FOR UPDATE',[key])).rows[0];if((before?.version??0)!==input.version)throw new AppError(409,'Układ dashboardu zmienił się. Otwórz ustawienia ponownie.');const saved=(await client.query<{value:DashboardPreference['layout'];version:number}>('INSERT INTO system_settings(key,value,version,updated_by) VALUES($1,$2,1,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,version=system_settings.version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING value,version',[key,JSON.stringify(input.layout),user.id])).rows[0];await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'DASHBOARD_LAYOUT','user',$2,'Zapisano własny układ dashboardu administratora.',$3,$4)",[user.id,user.id,JSON.stringify(before?.value??defaultDashboardLayout),JSON.stringify(input.layout)]);return {layout:saved.value,version:saved.version};});
}
