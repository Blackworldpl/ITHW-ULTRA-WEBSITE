import { randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { User, Role, SessionUser } from '@/shared/types';
import { roles } from '@/shared/types';
import { query, transaction } from './db';
import { AppError } from './errors';
import { digest, equalSecret, hashPassword, verifyPassword } from './passwords';
import {effectivePermissions,type Permission} from '@/shared/permissions';

const userColumns = 'id, name, email, role, active, permission_role_id AS "customRoleId", last_login_at AS "lastLoginAt", must_change_password AS "mustChangePassword", password_version AS "passwordVersion", password_changed_at AS "passwordChangedAt"';
const sessionHours = 12;
const cookieName = process.env.NODE_ENV === 'production' ? '__Host-ithw-session' : 'ithw-session';
const credentials = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(128) });
const account = credentials.extend({ name: z.string().trim().min(2).max(120), password: z.string().min(12, 'Hasło musi mieć co najmniej 12 znaków.').max(128) });
const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));

export function requireOrigin(request: NextRequest) {
  const configured = process.env.APP_URL;
  if (!configured) throw new AppError(503, 'Ustaw APP_URL przed uruchomieniem aplikacji.');
  let origin: string;
  try { origin = new URL(configured).origin; } catch { throw new AppError(503, 'Nieprawidłowa konfiguracja APP_URL.'); }
  if (request.headers.get('origin') !== origin) throw new AppError(403, 'Niedozwolone źródło żądania. Odśwież stronę aplikacji.');
}
export function requireRole(user: User, allowed: readonly Role[]) {
  if (!allowed.includes(user.role)) throw new AppError(403, 'Twoja rola nie pozwala na wykonanie tej operacji.');
}
export function checkCsrf(request: NextRequest, user: SessionUser) {
  const token = request.headers.get('x-csrf-token');
  if (!token || !equalSecret(token, user.csrfToken)) throw new AppError(403, 'Sesja formularza wygasła. Odśwież stronę.');
}
export async function getSession(request: NextRequest, allowPasswordChange=false): Promise<SessionUser> {
  const token = request.cookies.get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new AppError(401, 'Zaloguj się, aby kontynuować.');
  // One round trip: the custom role (if any) is joined instead of read separately.
  const result = await query<SessionUser&{customPermissions:Permission[]|null}>(`SELECT u.id,u.name,u.email,u.role,u.active,u.permission_role_id AS "customRoleId",u.last_login_at AS "lastLoginAt",u.must_change_password AS "mustChangePassword",u.password_version AS "passwordVersion",u.password_changed_at AS "passwordChangedAt",s.csrf_token AS "csrfToken",p.name AS "customRoleName",p.permissions AS "customPermissions" FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN permission_roles p ON p.id=u.permission_role_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND s.password_version=u.password_version`, [digest(token)]);
  const row = result.rows[0];
  if (!row) throw new AppError(401, 'Sesja wygasła. Zaloguj się ponownie.');
  if(!allowPasswordChange) requirePasswordReady(row);
  const {customPermissions,...user} = row;
  return applyPermissions(user,row.customRoleId&&customPermissions?{name:row.customRoleName??'',permissions:customPermissions}:null);
}
export function requirePasswordReady(user:User){if(user.mustChangePassword)throw new AppError(403,'Ustaw własne hasło przed rozpoczęciem pracy w systemie.','PASSWORD_CHANGE_REQUIRED');}
function applyPermissions<T extends User>(user:T,custom:{name:string;permissions:Permission[]}|null|undefined):T{
 return {...user,permissions:user.mustChangePassword?[]:effectivePermissions(user.role,custom?.permissions),customRoleName:custom?.name??null};
}
async function withPermissions<T extends User>(user:T):Promise<T>{
 const custom=user.customRoleId?(await query<{name:string;permissions:Permission[]}>('SELECT name,permissions FROM permission_roles WHERE id=$1',[user.customRoleId])).rows[0]:null;
 return applyPermissions(user,custom);
}
export async function issueSession(response: NextResponse, user: User): Promise<SessionUser> {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  await query('DELETE FROM sessions WHERE expires_at<now()');
  const created=await query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,password_version) SELECT $1,id,$3,now()+interval \'12 hours\',password_version FROM users WHERE id=$2 AND active AND password_version=$4 RETURNING user_id', [digest(token), user.id, csrfToken,user.passwordVersion??1]);
  if(!created.rowCount)throw new AppError(401,'Dane logowania zmieniły się. Zaloguj się ponownie.');
  response.cookies.set(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: sessionHours * 3600 });
  return withPermissions({ ...user, csrfToken });
}
export async function revokeSession(request: NextRequest, response: NextResponse) {
  const token = request.cookies.get(cookieName)?.value;
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [digest(token)]);
  response.cookies.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
}
export async function throttle(key: string, limit = 8, seconds = 900) {
  // Windows last at most 15 minutes; occasionally drop rows that can no longer
  // limit anything, so distinct keys do not accumulate forever (F04).
  if (Math.random() < 0.02) await query("DELETE FROM auth_rate_limits WHERE window_start < now() - interval '1 hour'");
  const result = await query<{attempts:number}>(`INSERT INTO auth_rate_limits(key,attempts,window_start) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<now()-($2*interval '1 second') THEN 1 ELSE auth_rate_limits.attempts+1 END, window_start=CASE WHEN auth_rate_limits.window_start<now()-($2*interval '1 second') THEN now() ELSE auth_rate_limits.window_start END RETURNING attempts`, [key,seconds]);
  if (result.rows[0].attempts > limit) throw new AppError(429, 'Zbyt wiele prób. Spróbuj ponownie za 15 minut.');
}
export async function authenticate(body: unknown): Promise<User> {
  const values = credentials.parse(body);
  await throttle('login:global', 300, 60);
  const key = 'login:' + digest(values.email);
  await throttle(key);
  const result = await query<User & {password_hash:string}>(`SELECT ${userColumns},password_hash FROM users WHERE email=$1`, [values.email]);
  const row = result.rows[0];
  // Unknown users incur the same expensive password derivation.
  const fallbackHash = await dummyPasswordHash;
  const encoded = row?.password_hash ?? fallbackHash;
  const valid = await verifyPassword(values.password, encoded);
  if (!row || !row.active || !valid) throw new AppError(401, 'Nieprawidłowy e-mail lub hasło.');
  await query('DELETE FROM auth_rate_limits WHERE key=$1', [key]);
  const {password_hash: _hash, ...user} = row;
  await query('UPDATE users SET last_login_at=now() WHERE id=$1',[user.id]);
  await query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1::uuid,'LOGIN','user',$1::text,'Zalogowano do IT Hardware')`, [user.id]);
  return user;
}
export async function setupAvailable() {
  if ((process.env.SETUP_TOKEN?.length ?? 0) < 32) return { available: false };
  const result = await query<{exists:boolean}>('SELECT EXISTS(SELECT 1 FROM users) AS exists');
  return {available: !result.rows[0].exists};
}
export async function bootstrap(body: unknown): Promise<User> {
  await throttle('setup', 8, 900);
  const values = account.extend({token:z.string().min(1).max(512)}).parse(body);
  const secret = process.env.SETUP_TOKEN;
  if (!secret || secret.length < 32 || !equalSecret(values.token, secret)) throw new AppError(403, 'Nieprawidłowy token inicjalizacji.');
  const hash = await hashPassword(values.password);
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(78491329)');
    const exists = await client.query('SELECT 1 FROM users LIMIT 1');
    if (exists.rowCount) throw new AppError(409, 'Konto administratora zostało już utworzone.');
    const result = await client.query<User>(`INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'ADMIN') RETURNING ${userColumns}`, [values.name,values.email,hash]);
    const user = result.rows[0];
    await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description) VALUES($1::uuid,'CREATE_ADMIN','user',$1::text,'Utworzono pierwszego administratora')`, [user.id]);
    return user;
  });
}
export async function listUsers() { return (await query<User>(`SELECT ${userColumns} FROM users ORDER BY name`)).rows; }
export async function createUser(body: unknown, actor: User) {
  requireRole(actor,['ADMIN']);
  const values = account.extend({role: z.enum(roles),mustChangePassword:z.boolean().default(true)}).strict().parse(body);
  const hash = await hashPassword(values.password);
  return transaction(async client => {
    const result = await client.query<User>(`INSERT INTO users(name,email,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,$5) RETURNING ${userColumns}`, [values.name,values.email,hash,values.role,values.mustChangePassword]);
    const user = result.rows[0];
    await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'CREATE_USER','user',$2,$3,$4)`, [actor.id,user.id,`Utworzono konto: ${user.name}`,JSON.stringify(user)]);
    return user;
  });
}
export async function updateUser(id: string, body: unknown, actor: User) {
  requireRole(actor,['ADMIN']);
  z.uuid().parse(id);
  const values = z.object({name:account.shape.name.optional(),email:account.shape.email.optional(),password:account.shape.password.optional(),role:z.enum(roles).optional(),active:z.boolean().optional(),mustChangePassword:z.boolean().optional()}).strict().refine(v=>Object.values(v).some(value=>value!==undefined), 'Podaj dane do zmiany.').parse(body);
  const hash = values.password ? await hashPassword(values.password) : null;
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(78491329)');
    const before = (await client.query<User>(`SELECT ${userColumns} FROM users WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw new AppError(404, 'Nie znaleziono użytkownika.');
    if(values.mustChangePassword===false&&before.mustChangePassword&&!hash)throw new AppError(409,'Wymaganie zmiany hasła kończy użytkownik, ustawiając własne hasło.');
    const passwordRequired=values.mustChangePassword??(hash?true:before.mustChangePassword??false);
    const accessChanged = (values.role!==undefined && (values.role!==before.role || !!before.customRoleId)) || (values.active!==undefined && values.active!==before.active);
    if (id===actor.id && accessChanged) throw new AppError(409,'Własną rolę i aktywność musi zmienić inny administrator.');
    if (before.role==='ADMIN' && before.active && (values.role && values.role!=='ADMIN' || values.active===false)) {
      const admins = await client.query<{count:string}>(`SELECT count(*) FROM users WHERE active AND role='ADMIN'`);
      if (Number(admins.rows[0].count)<=1) throw new AppError(409, 'W systemie musi pozostać aktywny administrator.');
    }
    const result = await client.query<User>(`UPDATE users SET role=COALESCE($2,role),permission_role_id=CASE WHEN $2 IS NULL THEN permission_role_id ELSE NULL END,active=COALESCE($3,active),name=COALESCE($4,name),email=COALESCE($5,email),password_hash=COALESCE($6,password_hash),must_change_password=$7,password_version=password_version+CASE WHEN $6 IS NULL THEN 0 ELSE 1 END,password_changed_at=CASE WHEN $6 IS NULL THEN password_changed_at ELSE now() END,updated_at=now() WHERE id=$1 RETURNING ${userColumns}`, [id,values.role,values.active,values.name,values.email,hash,passwordRequired]);
    if (accessChanged || hash || passwordRequired!==!!before.mustChangePassword || (values.email!==undefined && values.email!==before.email)) await client.query('DELETE FROM sessions WHERE user_id=$1',[id]);
    await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,'UPDATE_USER','user',$2,$3,$4,$5)`, [actor.id,id,`Zmieniono konto: ${before.name}`,JSON.stringify(before),JSON.stringify(result.rows[0])]);
    return result.rows[0];
  });
}

export async function deleteUser(id: string, actor: User): Promise<User> {
  requireRole(actor,['ADMIN']);
  z.uuid().parse(id);
  if (id===actor.id) throw new AppError(409,'Nie możesz usunąć własnego konta.');
  try {
    return await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(78491329)');
      const before = (await client.query<User>(`SELECT ${userColumns} FROM users WHERE id=$1 FOR UPDATE`,[id])).rows[0];
      if (!before) throw new AppError(404,'Nie znaleziono użytkownika.');
      if (before.role==='ADMIN' && before.active) {
        const admins = await client.query<{count:string}>("SELECT count(*) FROM users WHERE active AND role='ADMIN'");
        if (Number(admins.rows[0].count)<=1) throw new AppError(409,'W systemie musi pozostać aktywny administrator.');
      }
      await client.query('DELETE FROM users WHERE id=$1',[id]);
      await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data) VALUES($1,'DELETE_USER','user',$2,$3,$4)`,[actor.id,id,`Usunięto konto: ${before.name}`,JSON.stringify(before)]);
      return before;
    });
  } catch (error) {
    if ((error as {code?:string}).code==='23503') throw new AppError(409,'Konto ma powiązaną historię lub rekordy i nie może zostać usunięte. Wybierz Edytuj i wyłącz „Konto aktywne”, aby odebrać dostęp.');
    throw error;
  }
}

export async function changeOwnPassword(request:NextRequest,body:unknown,user:SessionUser){
 const values=z.object({currentPassword:credentials.shape.password,newPassword:account.shape.password,confirmation:account.shape.password}).strict().refine(value=>value.newPassword===value.confirmation,{message:'Nowe hasła muszą być identyczne.',path:['confirmation']}).parse(body);
 await throttle('password-change:'+user.id,8,900);
 const token=request.cookies.get(cookieName)?.value;
 if(!token)throw new AppError(401,'Zaloguj się ponownie.');
 const hash=await hashPassword(values.newPassword);
 await transaction(async client=>{
  const current=(await client.query<{password_hash:string;password_version:number;active:boolean;must_change_password:boolean}>('SELECT password_hash,password_version,active,must_change_password FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
  const session=await client.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() AND password_version=$3',[digest(token),user.id,current?.password_version]);
  if(!current?.active||!session.rowCount)throw new AppError(401,'Sesja wygasła. Zaloguj się ponownie.');
  if(!await verifyPassword(values.currentPassword,current.password_hash))throw new AppError(400,'Dotychczasowe hasło jest nieprawidłowe.');
  if(await verifyPassword(values.newPassword,current.password_hash))throw new AppError(400,'Nowe hasło musi różnić się od dotychczasowego.');
  await client.query('UPDATE users SET password_hash=$2,must_change_password=false,password_version=password_version+1,password_changed_at=now(),updated_at=now() WHERE id=$1',[user.id,hash]);
  await client.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
  await client.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1::uuid,'CHANGE_OWN_PASSWORD','user',$1::text,'Użytkownik ustawił własne hasło.',$2)",[user.id,JSON.stringify({firstLogin:current.must_change_password})]);
 });
}
