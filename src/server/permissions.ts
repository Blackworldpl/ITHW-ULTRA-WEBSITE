import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {User,Role} from '@/shared/types';
import type {PermissionRole} from '@/shared/product';
import {hasPermission,permissions,rolePermissions,type Permission} from '@/shared/permissions';
import {query,transaction} from './db';
import {AppError} from './errors';
import {parse,uuidSchema} from './validation';
import {requireRole,throttle} from './auth';
import {digest,hashPassword} from './passwords';

export function requirePermission(user:User,permission:Permission){if(!hasPermission(user,permission))throw new AppError(403,`Brak uprawnienia: ${permission}.`);}
export function guardEndpoint(user:User,key:string,method:string){
 const read=method==='GET',parts=key.split('/');let permission:Permission|undefined;
 if(parts[0]==='locations'||parts[0]==='admin'&&parts[1]==='locations'){requireRole(user,['ADMIN']);requirePermission(user,'location.manage');}
 if(parts[0]==='assets')permission=read?(parts[1]==='export'?'asset.export':parts.includes('history')?'asset.history':'asset.view'):parts[1]==='bulk'||parts.includes('actions')?undefined:method==='POST'?'asset.create':'asset.edit';
 else if(parts[0]==='inventory')permission=read?'inventory.view':parts[2]==='movements'?'inventory.move':'inventory.edit';
 else if(parts[0]==='employees')permission=parts[2]==='equipment-documents'?(read?'document.view':'equipment.document'):parts[2]==='account'?'user.create':read?'employee.view':'employee.edit';
 else if(parts[0]==='workstations')permission=parts[2]==='equipment-documents'?(read?'document.view':'equipment.document'):read?'location.view':'employee.edit';
 else if(parts[0]==='equipment-documents'||parts[0]==='documents')permission=read?'document.view':'document.upload';
 else if(parts[0]==='invoices'||parts[0]==='deliveries')permission=read?'invoice.view':'invoice.edit';
 else if(parts[0]==='configs')permission=read?(parts.includes('download')?'config.download':'config.view'):'config.edit';
 else if(parts[0]==='stocktakes')permission='inventory.run';
 else if(parts[0]==='incidents')permission=read?'incident.view':'incident.edit';
 else if(parts[0]==='devices')permission=read?'device.view':'device.manage';
 else if(parts[0]==='locations')permission=read?'location.view':method==='POST'?'location.create':method==='DELETE'?'location.delete':'location.edit';
 else if(parts[0]==='qr'||parts[0]==='labels')permission='label.print';
 else if(parts[0]==='imports')permission='import.run';
 else if(parts[0]==='scan')permission='rfid.scan';
 else if(parts[0]==='reports')permission='asset.view';
 else if(parts[0]==='admin'){
  const section=parts[1];permission=section==='permissions'?'role.manage':section==='settings'?'settings.manage':section==='audit'||section==='inventory-export'?'audit.view':section==='users'?read?'user.view':method==='POST'?'user.create':'user.edit':section==='locations'?read?'location.view':method==='POST'?'location.create':method==='DELETE'?'location.delete':'location.edit':'settings.manage';
 }
 if(permission)requirePermission(user,permission);
 if(parts[0]==='stocktakes'||key==='my-equipment'||parts[0]==='employees'&&parts[2]==='equipment'||parts[0]==='workstations'&&parts.length===2&&read)requirePermission(user,'asset.view');
}
export const actionPermission={assign:'asset.assign',return:'asset.assign',move:'asset.move',status:'asset.status',rfid:'rfid.edit',note:'asset.assign'} as const;
const projection='id,name,base_role AS "baseRole",permissions,version';
export async function listPermissionRoles(){return (await query<PermissionRole>(`SELECT ${projection} FROM permission_roles ORDER BY name`)).rows;}
export async function savePermissionRole(id:string|null,body:unknown,user:User){
 requireRole(user,['ADMIN']);requirePermission(user,'role.manage');
 const input=parse(z.object({name:z.string().trim().min(2).max(100),baseRole:z.enum(['VIEWER','IT_USER','IT_ADVANCED']),permissions:z.array(z.enum(permissions as [Permission,...Permission[]])).max(permissions.length),version:z.number().int().positive().optional()}).strict(),body);
 if(input.permissions.some(p=>!rolePermissions[input.baseRole].includes(p)))throw new AppError(400,'Rola własna może zawężać uprawnienia wybranej roli bazowej.');
 return transaction(async client=>{
  let before:PermissionRole|null=null;
  if(id){parse(uuidSchema,id);before=(await client.query<PermissionRole>(`SELECT ${projection} FROM permission_roles WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!before)throw new AppError(404,'Nie znaleziono roli.');if(input.version!==before.version||input.baseRole!==before.baseRole)throw new AppError(409,'Rola zmieniła się lub wybrano inną bazę. Otwórz formularz ponownie.');}
  const result=id?await client.query<PermissionRole>(`UPDATE permission_roles SET name=$2,permissions=$3,version=version+1 WHERE id=$1 RETURNING ${projection}`,[id,input.name,[...new Set(input.permissions)]]):await client.query<PermissionRole>(`INSERT INTO permission_roles(name,base_role,permissions,created_by) VALUES($1,$2,$3,$4) RETURNING ${projection}`,[input.name,input.baseRole,[...new Set(input.permissions)],user.id]);
  const role=result.rows[0];
  if(id)await client.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE permission_role_id=$1)',[id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'CHANGE_PERMISSIONS','role',$2,$3,$4,$5)",[user.id,role.id,`Zapisano uprawnienia roli ${role.name}.`,before?JSON.stringify(before):null,JSON.stringify(role)]);return role;
 });
}
export async function assignPermissionRole(id:string,body:unknown,user:User){
 requireRole(user,['ADMIN']);requirePermission(user,'role.manage');requirePermission(user,'user.edit');parse(uuidSchema,id);
 const {roleId}=parse(z.object({roleId:uuidSchema.nullable()}).strict(),body);if(id===user.id)throw new AppError(409,'Własne uprawnienia musi zmienić inny administrator.');
 return transaction(async client=>{
  const before=(await client.query('SELECT id,role,permission_role_id FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)throw new AppError(404,'Nie znaleziono konta.');if(before.role==='ADMIN')throw new AppError(409,'Rolę administratora zmień w edycji konta.');
  const role=roleId?(await client.query<PermissionRole>(`SELECT ${projection} FROM permission_roles WHERE id=$1`,[roleId])).rows[0]:null;if(roleId&&!role)throw new AppError(404,'Nie znaleziono roli własnej.');
  await client.query('UPDATE users SET permission_role_id=$2,role=COALESCE($3,role),updated_at=now() WHERE id=$1',[id,roleId,role?.baseRole??null]);await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'ASSIGN_PERMISSION_ROLE','user',$2,'Zmieniono profil uprawnień konta.',$3,$4)",[user.id,id,JSON.stringify(before),JSON.stringify({roleId,role:role?.baseRole??before.role})]);return {saved:true};
 });
}
export async function inviteUser(body:unknown,user:User){
 requireRole(user,['ADMIN']);requirePermission(user,'user.create');
 const input=parse(z.object({name:z.string().trim().min(2).max(120),email:z.string().trim().toLowerCase().email().max(254),role:z.enum(['VIEWER','IT_USER','IT_ADVANCED'])}).strict(),body),token=randomBytes(32).toString('hex');
 return transaction(async client=>{
  if((await client.query('SELECT id FROM users WHERE lower(email)=$1',[input.email])).rowCount)throw new AppError(409,'Ten adres ma już konto.');
  await client.query('DELETE FROM user_invitations WHERE lower(email)=$1 AND accepted_at IS NULL AND expires_at<now()',[input.email]);
  const row=(await client.query('INSERT INTO user_invitations(token_hash,name,email,role,created_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'7 days\') RETURNING id,expires_at AS "expiresAt"',[digest(token),input.name,input.email,input.role,user.id])).rows[0];
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1,'INVITE_USER','invitation',$2,$3)",[user.id,row.id,`Przygotowano zaproszenie do systemu dla ${input.name}.`]);return {...row,url:new URL(`/invite?token=${token}`,process.env.APP_URL).toString()};
 });
}
export async function getInvitation(token:string){if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(404,'Zaproszenie jest nieprawidłowe.');const row=(await query('SELECT name,email,role,expires_at AS "expiresAt" FROM user_invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()',[digest(token)])).rows[0];if(!row)throw new AppError(410,'Zaproszenie wygasło lub zostało użyte.');return row;}
export async function acceptInvitation(body:unknown):Promise<User>{
 const input=parse(z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(12).max(128)}).strict(),body);await throttle('invite:'+digest(input.token));const hash=await hashPassword(input.password);
 return transaction(async client=>{const invite=(await client.query('SELECT * FROM user_invitations WHERE token_hash=$1 FOR UPDATE',[digest(input.token)])).rows[0];if(!invite||invite.accepted_at||new Date(invite.expires_at)<new Date())throw new AppError(410,'Zaproszenie wygasło lub zostało użyte.');const user=(await client.query<User>('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,must_change_password AS "mustChangePassword",password_version AS "passwordVersion"',[invite.name,invite.email,hash,invite.role])).rows[0];await client.query('UPDATE user_invitations SET accepted_at=now() WHERE id=$1',[invite.id]);await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1::uuid,'ACCEPT_INVITATION','user',$1::text,'Aktywowano konto przez zaproszenie.')",[user.id]);return user;});
}
