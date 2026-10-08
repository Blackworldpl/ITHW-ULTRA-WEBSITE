import type {User,Role} from './types';

export const permissionGroups={
 'Sprzęt':['asset.view','asset.create','asset.edit','asset.assign','asset.move','asset.status','asset.export','asset.history','label.print','rfid.scan','rfid.edit'],
 'Lokalizacje':['location.view','location.manage','location.create','location.edit','location.delete'],
 'Magazyn':['inventory.view','inventory.edit','inventory.move','inventory.run'],
 'Biblioteka':['config.view','config.download','config.edit','document.view','document.upload','invoice.view','invoice.edit'],
 'Serwis':['incident.view','incident.edit'],
 'Zespół':['employee.view','employee.edit','equipment.document','user.view','user.create','user.edit'],
 'Ekrany i terminale':['device.view','device.manage','dashboard.configure'],
 'System':['role.manage','audit.view','settings.manage','import.run'],
} as const;
export type Permission=typeof permissionGroups[keyof typeof permissionGroups][number];
export const permissions=Object.values(permissionGroups).flat() as Permission[];
const read:Permission[]=['asset.view','asset.history','location.view','inventory.view','config.view','config.download','document.view','invoice.view','incident.view','employee.view','rfid.scan','label.print'];
const operator:Permission[]=[...read,'asset.assign','inventory.move','inventory.run','incident.edit','equipment.document'];
const advanced:Permission[]=[...operator,'asset.create','asset.edit','asset.move','asset.status','asset.export','rfid.edit','inventory.edit','config.edit','document.upload','invoice.edit','employee.edit','import.run'];
export const rolePermissions:Record<Role,readonly Permission[]>={VIEWER:read,IT_USER:operator,IT_ADVANCED:advanced,ADMIN:permissions};
export function hasPermission(user:Pick<User,'role'|'permissions'>,permission:Permission){return (user.permissions??rolePermissions[user.role]).includes(permission);}
export function effectivePermissions(role:Role,custom?:readonly Permission[]|null):Permission[]{return [...rolePermissions[role]].filter(p=>!custom||custom.includes(p));}
