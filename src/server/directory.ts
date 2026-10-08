import {z} from 'zod';
import type {Category,Employee,Supplier,User} from '@/shared/types';
import {requireRole} from './auth';
import {hasPermission} from '@/shared/permissions';
import {hashPassword} from './passwords';
import {query,transaction} from './db';
import {AppError} from './errors';
import {categorySchema,employeeSchema,parse,supplierSchema,uuidSchema} from './validation';
const clean=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const maps={categories:{name:'name',description:'description',fieldDefinitions:'field_definitions',standardFields:'standard_fields'},suppliers:{name:'name',taxId:'tax_id',regon:'regon',street:'street',postalCode:'postal_code',city:'city',country:'country',contactName:'contact_name',email:'email',phone:'phone',website:'website',bankAccount:'bank_account',notes:'notes'}};
export const categoryProjection='id,name,description,field_definitions AS "fieldDefinitions",standard_fields AS "standardFields",version';
export const supplierProjection='id,name,tax_id AS "taxId",regon,street,postal_code AS "postalCode",city,country,contact_name AS "contactName",email,phone,website,bank_account AS "bankAccount",notes,version';
export async function listCategories(){return clean((await query<Category>(`SELECT ${categoryProjection} FROM asset_categories ORDER BY name`)).rows);}
export async function listSuppliers(){return clean((await query<Supplier>(`SELECT ${supplierProjection} FROM suppliers ORDER BY name`)).rows);}
export async function saveDictionary(kind:'categories'|'suppliers',id:string|null,body:unknown,user:User){
 requireRole(user,['ADMIN']);if(id)parse(uuidSchema,id);
 const input=parse(kind==='categories'?categorySchema:supplierSchema,body);
 const table=kind==='categories'?'asset_categories':'suppliers',projection=kind==='categories'?categoryProjection:supplierProjection;
 return transaction(async client=>{
  const before=id?(await client.query(`SELECT ${projection} FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0]:null;
  if(id&&!before)throw new AppError(404,'Nie znaleziono wpisu.');
  if(before&&input.version!==undefined&&input.version!==before.version)throw new AppError(409,'Wpis zmienił się. Odśwież formularz.');
  const entries=Object.entries(input).filter(([key,value])=>key!=='version'&&value!==undefined);
  const mapping=maps[kind] as Record<string,string>;
  const values=entries.map(([key,value])=>key==='fieldDefinitions'||key==='standardFields'?JSON.stringify(value):key==='taxId'&&typeof value==='string'?value.replace(/[\s-]/g,'').toUpperCase():value);
  const result=id?await client.query(`UPDATE ${table} SET ${entries.map(([key],i)=>`${mapping[key]}=$${i+2}`).join(',')},version=version+1 WHERE id=$1 RETURNING ${projection}`,[id,...values]):await client.query(`INSERT INTO ${table}(${entries.map(([key])=>mapping[key]).join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING ${projection}`,values);
  const after=result.rows[0],entity=kind==='categories'?'category':'supplier',action=`${id?'UPDATE':'CREATE'}_${kind==='categories'?'CATEGORY':'SUPPLIER'}`;
  await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7)`,[user.id,action,entity,after.id,`${id?'Zmieniono':'Dodano'} ${after.name}.`,before?JSON.stringify(before):null,JSON.stringify(after)]);
  return clean(after);
 });
}
const employeeProjection=`e.id,e.name,e.employee_number AS "employeeNumber",e.email,e.phone,e.department,e.position,e.location_id AS "locationId",l.path AS "locationName",e.user_id AS "userId",u.active AS "userActive",e.active,e.notes,e.version,(SELECT count(*)::integer FROM assets a WHERE a.employee_id=e.id) AS "assetCount"`;
const employeeFrom='FROM employees e LEFT JOIN location_paths l ON l.id=e.location_id LEFT JOIN users u ON u.id=e.user_id';
// Device counts are equipment data: hidden without asset.view, as for locations.
function withoutAssetCounts<T extends Employee>(rows:T[],user?:User):T[]{if(user&&!hasPermission(user,'asset.view'))for(const row of rows)delete row.assetCount;return rows;}
export async function listEmployees(user?:User){return withoutAssetCounts(clean((await query<Employee>(`SELECT ${employeeProjection} ${employeeFrom} ORDER BY e.active DESC,e.name,e.id`)).rows),user);}
export async function getEmployee(id:string,user?:User){parse(uuidSchema,id);const employee=(await query<Employee>(`SELECT ${employeeProjection} ${employeeFrom} WHERE e.id=$1`,[id])).rows[0];if(!employee)throw new AppError(404,'Nie znaleziono pracownika.');return withoutAssetCounts([clean(employee)],user)[0];}
const employeeMap:Record<string,string>={name:'name',employeeNumber:'employee_number',email:'email',phone:'phone',department:'department',position:'position',locationId:'location_id',userId:'user_id',active:'active',notes:'notes'};
export async function saveEmployee(id:string|null,body:unknown,user:User){
 requireRole(user,['IT_ADVANCED','ADMIN']);if(id)parse(uuidSchema,id);const input=parse(employeeSchema,body);
 return transaction(async client=>{
  const before=id?(await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!before)throw new AppError(404,'Nie znaleziono pracownika.');
  if(before&&input.version!==before.version)throw new AppError(409,'Pracownik zmienił się. Odśwież dane.');
  if(input.userId!==undefined&&input.userId!==(before?.user_id??null))requireRole(user,['ADMIN']);
  if(input.userId&&input.userId!==before?.user_id){
   if(input.active===false||input.active===undefined&&before?.active===false)throw new AppError(400,'Konto można połączyć z aktywnym profilem pracownika.');
   const account=await client.query('SELECT id FROM users WHERE id=$1 AND active FOR SHARE',[input.userId]);if(!account.rowCount)throw new AppError(400,'Wybierz aktywne konto użytkownika.');
  }
  if(input.active===false){
   if(id&&(await client.query('SELECT id FROM assets WHERE employee_id=$1 LIMIT 1',[id])).rowCount)throw new AppError(409,'Przed dezaktywacją przekaż lub zwróć sprzęt pracownika.');
   if(before?.user_id){requireRole(user,['ADMIN']);if(before.user_id===user.id)throw new AppError(409,'Nie możesz wyłączyć własnego konta przez profil pracownika.');const linked=(await client.query('SELECT role FROM users WHERE id=$1',[before.user_id])).rows[0];if(linked?.role==='ADMIN')throw new AppError(409,'Konto administratora dezaktywuj w zarządzaniu kontami.');await client.query('UPDATE users SET active=false WHERE id=$1',[before.user_id]);await client.query('DELETE FROM sessions WHERE user_id=$1',[before.user_id]);}
  }
  const entries=Object.entries(input).filter(([key,value])=>key!=='version'&&value!==undefined),values=entries.map(([,v])=>v);
  const result=id?await client.query(`UPDATE employees SET ${entries.map(([key],i)=>`${employeeMap[key]}=$${i+2}`).join(',')},version=version+1,updated_at=now() WHERE id=$1 RETURNING id`,[id,...values]):await client.query(`INSERT INTO employees(${entries.map(([key])=>employeeMap[key]).join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,values);
  const after=(await client.query<Employee>(`SELECT ${employeeProjection} ${employeeFrom} WHERE e.id=$1`,[result.rows[0].id])).rows[0];
  await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,before_data,after_data) VALUES($1,$2,'employee',$3,$4,$5,$6)`,[user.id,id?'UPDATE_EMPLOYEE':'CREATE_EMPLOYEE',after.id,`${id?'Zmieniono':'Dodano'} pracownika ${after.name}.`,before?JSON.stringify(before):null,JSON.stringify(after)]);
  return clean(after);
 });
}
export async function createEmployeeAccount(id:string,body:unknown,user:User){
 requireRole(user,['ADMIN']);parse(uuidSchema,id);
 const input=z.object({email:z.string().trim().toLowerCase().email().max(254),password:z.string().min(12).max(128),role:z.enum(['VIEWER','IT_USER']).default('IT_USER'),mustChangePassword:z.boolean().default(true),version:z.number().int().positive()}).strict().parse(body);
 const hash=await hashPassword(input.password);
 return transaction(async client=>{
  const before=(await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!before)throw new AppError(404,'Nie znaleziono pracownika.');if(before.version!==input.version)throw new AppError(409,'Profil zmienił się. Odśwież dane.');if(before.user_id||!before.active)throw new AppError(409,'Profil ma już konto albo jest nieaktywny.');
  const account=(await client.query<User>('INSERT INTO users(name,email,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,active,must_change_password AS "mustChangePassword"',[before.name,input.email,hash,input.role,input.mustChangePassword])).rows[0];
  await client.query('UPDATE employees SET user_id=$2,version=version+1,updated_at=now() WHERE id=$1',[id,account.id]);
  await client.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,description,after_data) VALUES($1,'CREATE_EMPLOYEE_ACCOUNT','employee',$2,$3,$4)`,[user.id,id,`Utworzono konto pracownika ${before.name}.`,JSON.stringify(account)]);
  return account;
 });
}
